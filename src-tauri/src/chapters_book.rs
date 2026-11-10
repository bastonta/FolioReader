//! Downloads a Folio `Chapters` book — a book without a file, stored on the server as
//! separate chapters — and assembles it into a local EPUB, so it can be read (offline
//! included) like any other book of the library.
//!
//! Running the command again for a book that is already on disk updates it: only new and
//! changed chapters are downloaded, everything else is copied from the previous build.

use crate::chapters_epub::{self, EpubMeta, EpubWriter, ExistingEpub, ManifestChapter};
use crate::fs_manager::{DownloadProgressInput, get_covers_dir, sanitize_filename_part};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

/// Error returned by `download_chapters_book` when the book has no chapters yet.
/// The frontend matches on this exact string.
pub const BOOK_HAS_NO_CHAPTERS_ERROR: &str = "BOOK_HAS_NO_CHAPTERS";

/// Page size of the chapter list (the server clamps it to 500).
const CHAPTERS_PAGE_SIZE: usize = 500;
/// Chapters and illustrations downloaded at the same time.
const MAX_PARALLEL_REQUESTS: usize = 6;
/// Attempts per request (transport errors, 5xx and 429 are retried).
const MAX_ATTEMPTS: u32 = 3;
/// Internal marker: the EPUB builder stopped, its own error is the one to report.
const BUILDER_STOPPED: &str = "EPUB builder stopped";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaptersDownloadProgress {
    /// `chapters`, `images` or `building`.
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaptersBookDownloadResult {
    pub file_path: String,
    pub local_id: String,
    pub chapters_total: usize,
    /// Chapters downloaded by this run (the rest were reused from the previous build).
    pub chapters_fetched: usize,
    pub images_fetched: usize,
    /// Illustrations the server could not provide; their chapters show the alt text.
    pub images_missing: usize,
    /// Server reading position converted to a CFI of the built EPUB (first download only).
    pub location: Option<String>,
    /// `true` when an existing local copy was updated.
    pub updated: bool,
}

// ================= SERVER TYPES =================

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerBook {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerChapterSummary {
    id: String,
    #[serde(default)]
    volume: f32,
    #[serde(default)]
    chapter: f32,
    #[serde(default)]
    name: String,
    #[serde(default)]
    updated: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerChapterPage {
    #[serde(default)]
    items: Vec<ServerChapterSummary>,
    #[serde(default)]
    more: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerChapter {
    #[serde(default)]
    volume: f32,
    #[serde(default)]
    chapter: f32,
    #[serde(default)]
    name: String,
    #[serde(default)]
    content: Vec<String>,
    #[serde(default)]
    updated: Option<String>,
}

// ================= HTTP =================

#[derive(Clone)]
struct Api {
    client: reqwest::Client,
    base: String,
    token: Option<String>,
}

impl Api {
    fn new(server_url: &str, token: Option<String>) -> Result<Self, String> {
        let base = server_url.trim_end_matches('/').to_string();
        if base.is_empty() {
            return Err("Server URL is empty".to_string());
        }

        let root_certs = webpki_root_certs::TLS_SERVER_ROOT_CERTS
            .iter()
            .filter_map(|der| reqwest::Certificate::from_der(der.as_ref()).ok());

        let client = reqwest::Client::builder()
            .tls_certs_only(root_certs)
            .timeout(std::time::Duration::from_secs(120))
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

        Ok(Self {
            client,
            base,
            token: token.filter(|t| !t.is_empty()),
        })
    }

    /// GET `path` (relative to the server root) and read the whole body.
    /// Transport errors, 5xx and 429 answers are retried a few times.
    async fn fetch(&self, path: &str) -> Result<(reqwest::StatusCode, Vec<u8>), String> {
        let url = format!("{}{path}", self.base);
        let mut attempt = 0;
        loop {
            attempt += 1;
            let mut request = self.client.get(&url);
            if let Some(token) = &self.token {
                request = request.header("Authorization", format!("Bearer {token}"));
            }

            let error = match request.send().await {
                Ok(response) => {
                    let status = response.status();
                    let retryable = status.is_server_error()
                        || status == reqwest::StatusCode::TOO_MANY_REQUESTS;
                    if retryable && attempt < MAX_ATTEMPTS {
                        format!("server returned status {status}")
                    } else {
                        match response.bytes().await {
                            Ok(body) => return Ok((status, body.to_vec())),
                            Err(e) => e.to_string(),
                        }
                    }
                }
                Err(e) => e.to_string(),
            };

            if attempt >= MAX_ATTEMPTS {
                return Err(format!("Request to {path} failed: {error}"));
            }
            tokio::time::sleep(std::time::Duration::from_millis(600 * u64::from(attempt))).await;
        }
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let (status, body) = self.fetch(path).await?;
        if !status.is_success() {
            return Err(format!("Server returned status {status} for {path}"));
        }
        serde_json::from_slice(&body)
            .map_err(|e| format!("Unexpected server response for {path}: {e}"))
    }

    /// Body of a binary resource, `None` when the server has none (any non-success status).
    async fn get_optional_bytes(&self, path: &str) -> Result<Option<Vec<u8>>, String> {
        let (status, body) = self.fetch(path).await?;
        Ok((status.is_success() && !body.is_empty()).then_some(body))
    }
}

// ================= EPUB BUILDER THREAD =================

/// Work for the blocking EPUB builder, in the order it is written to the archive.
enum BuildStep {
    Chapter {
        id: String,
        xhtml: String,
    },
    CopyChapter {
        id: String,
    },
    Image {
        name: String,
        bytes: Vec<u8>,
    },
    CopyImage {
        name: String,
    },
    Cover {
        bytes: Vec<u8>,
    },
    CopyCover {
        name: String,
    },
    Finish {
        meta: EpubMeta,
        chapters: Vec<ManifestChapter>,
    },
}

type SourceArchive = zip::ZipArchive<std::io::BufReader<std::fs::File>>;

fn open_archive(path: &Path) -> Result<SourceArchive, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open '{}': {e}", path.display()))?;
    zip::ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|e| format!("Failed to read '{}': {e}", path.display()))
}

/// Chapter manifest of a previously built EPUB; `None` for any other file.
fn read_existing_epub(path: &Path) -> Option<ExistingEpub> {
    let mut archive = open_archive(path).ok()?;
    chapters_epub::read_existing(&mut archive)
}

/// Writes the EPUB to `tmp_path` from the steps received over `steps`; entries of the
/// previous build (`previous`) are copied without recompression. Runs on a blocking thread
/// so that a book with thousands of chapters never has to be held in memory at once.
fn run_builder(
    tmp_path: PathBuf,
    previous: Option<PathBuf>,
    mut steps: mpsc::Receiver<BuildStep>,
) -> Result<(), String> {
    let file = std::fs::File::create(&tmp_path).map_err(|e| {
        format!(
            "Failed to create temporary file '{}': {e}",
            tmp_path.display()
        )
    })?;
    let mut writer = EpubWriter::new(std::io::BufWriter::new(file))?;
    let mut source = match previous {
        Some(path) => Some(open_archive(&path)?),
        None => None,
    };
    fn previous_build(source: &mut Option<SourceArchive>) -> Result<&mut SourceArchive, String> {
        source
            .as_mut()
            .ok_or_else(|| "No previous EPUB to copy from".to_string())
    }

    while let Some(step) = steps.blocking_recv() {
        match step {
            BuildStep::Chapter { id, xhtml } => writer.add_chapter(&id, &xhtml)?,
            BuildStep::CopyChapter { id } => {
                writer.copy_chapter(previous_build(&mut source)?, &id)?
            }
            BuildStep::Image { name, bytes } => writer.add_image(&name, &bytes)?,
            BuildStep::CopyImage { name } => {
                writer.copy_image(previous_build(&mut source)?, &name)?
            }
            BuildStep::Cover { bytes } => writer.set_cover(&bytes)?,
            BuildStep::CopyCover { name } => {
                writer.copy_cover(previous_build(&mut source)?, &name)?
            }
            BuildStep::Finish { meta, chapters } => {
                let (buffered, _) = writer.finish(&meta, &chapters)?;
                let file = buffered
                    .into_inner()
                    .map_err(|e| format!("Failed to write EPUB: {e}"))?;
                file.sync_all()
                    .map_err(|e| format!("Failed to write EPUB: {e}"))?;
                return Ok(());
            }
        }
    }

    // The sender went away without `Finish`: the download failed or was cancelled.
    Err(BUILDER_STOPPED.to_string())
}

async fn send_step(steps: &mpsc::Sender<BuildStep>, step: BuildStep) -> Result<(), String> {
    steps
        .send(step)
        .await
        .map_err(|_| BUILDER_STOPPED.to_string())
}

// ================= DOWNLOAD =================

/// Receives download progress (the IPC channel of the view that started the download).
type ProgressSink = dyn Fn(ChaptersDownloadProgress) + Send + Sync;

/// What to download and where to put it (the arguments of `download_chapters_book`).
struct ChaptersBookRequest {
    server_url: String,
    token: Option<String>,
    book_id: String,
    file_name: String,
    title: Option<String>,
    author: Option<String>,
    series_name: Option<String>,
    base_dir: String,
    custom_target_dir: Option<String>,
    progress: Option<DownloadProgressInput>,
}

struct BuildSummary {
    chapters_fetched: usize,
    images_fetched: usize,
    images_missing: usize,
    /// Cover downloaded from the server (cached for the library views).
    cover: Option<Vec<u8>>,
}

/// An illustration by file name; `None` when the server does not have it.
type ImageDownload = Result<(String, Option<Vec<u8>>), String>;

/// Downloads everything the previous build cannot provide and feeds the EPUB builder.
/// Dropping `steps` without `Finish` (any early return) makes the builder stop.
async fn feed_builder(
    api: &Api,
    book_id: &str,
    meta: EpubMeta,
    list: Vec<ServerChapterSummary>,
    existing: Option<&ExistingEpub>,
    steps: mpsc::Sender<BuildStep>,
    on_progress: &ProgressSink,
) -> Result<BuildSummary, String> {
    let report = |phase: &'static str, done: usize, total: usize| {
        on_progress(ChaptersDownloadProgress { phase, done, total });
    };

    let total = list.len();
    let language = meta.language.clone();
    let image_url_prefix = format!("/api/books/{book_id}/images/");

    // ---- Chapters: reuse what did not change, download the rest ----
    let mut chapters: Vec<Option<ManifestChapter>> = vec![None; total];
    let mut to_fetch: Vec<(usize, String)> = Vec::new();
    for (index, summary) in list.iter().enumerate() {
        let reusable = existing.and_then(|e| {
            e.reusable_chapter(
                &language,
                &summary.id,
                summary.updated.as_deref(),
                summary.volume,
                summary.chapter,
                &summary.name,
            )
        });
        match reusable {
            Some(stored) => {
                send_step(
                    &steps,
                    BuildStep::CopyChapter {
                        id: summary.id.clone(),
                    },
                )
                .await?;
                chapters[index] = Some(stored.clone());
            }
            None => to_fetch.push((index, summary.id.clone())),
        }
    }

    let chapters_fetched = to_fetch.len();
    let mut done = total - chapters_fetched;
    report("chapters", done, total);

    let mut queue = to_fetch.into_iter();
    let mut tasks: JoinSet<Result<(usize, String, ServerChapter), String>> = JoinSet::new();
    loop {
        while tasks.len() < MAX_PARALLEL_REQUESTS {
            let Some((index, chapter_id)) = queue.next() else {
                break;
            };
            let api = api.clone();
            let path = format!("/api/books/{book_id}/chapters/{chapter_id}");
            tasks.spawn(async move {
                let chapter = api.get_json::<ServerChapter>(&path).await?;
                Ok((index, chapter_id, chapter))
            });
        }
        let Some(joined) = tasks.join_next().await else {
            break;
        };
        let (index, chapter_id, chapter) =
            joined.map_err(|e| format!("Chapter download was interrupted: {e}"))??;

        let (xhtml, images) = chapters_epub::render_chapter(
            &language,
            chapter.chapter,
            &chapter.name,
            &chapter.content,
            &image_url_prefix,
        );
        send_step(
            &steps,
            BuildStep::Chapter {
                id: chapter_id.clone(),
                xhtml,
            },
        )
        .await?;
        chapters[index] = Some(ManifestChapter {
            id: chapter_id,
            updated: chapter.updated,
            volume: chapter.volume,
            chapter: chapter.chapter,
            name: chapter.name,
            images,
        });

        done += 1;
        report("chapters", done, total);
    }

    let chapters: Vec<ManifestChapter> = chapters.into_iter().flatten().collect();
    if chapters.len() != total {
        return Err("Some chapters were not downloaded".to_string());
    }

    // ---- Illustrations: copy the ones already embedded, download the missing ones ----
    let mut seen: HashSet<&str> = HashSet::new();
    let mut to_fetch: Vec<String> = Vec::new();
    for name in chapters.iter().flat_map(|c| c.images.iter()) {
        if !seen.insert(name.as_str()) {
            continue;
        }
        if existing.is_some_and(|e| e.has_image(name)) {
            send_step(&steps, BuildStep::CopyImage { name: name.clone() }).await?;
        } else {
            to_fetch.push(name.clone());
        }
    }

    let images_total = to_fetch.len();
    let mut images_fetched = 0;
    let mut images_missing = 0;
    if images_total > 0 {
        report("images", 0, images_total);
    }

    let mut queue = to_fetch.into_iter();
    let mut tasks: JoinSet<ImageDownload> = JoinSet::new();
    loop {
        while tasks.len() < MAX_PARALLEL_REQUESTS {
            let Some(name) = queue.next() else {
                break;
            };
            let api = api.clone();
            let path = format!("{image_url_prefix}{name}");
            tasks.spawn(async move {
                let bytes = api.get_optional_bytes(&path).await?;
                Ok((name, bytes))
            });
        }
        let Some(joined) = tasks.join_next().await else {
            break;
        };
        let (name, bytes) =
            joined.map_err(|e| format!("Illustration download was interrupted: {e}"))??;
        match bytes {
            Some(bytes) => {
                send_step(&steps, BuildStep::Image { name, bytes }).await?;
                images_fetched += 1;
            }
            // The server no longer has the file: the chapter keeps the alt text.
            None => images_missing += 1,
        }
        report("images", images_fetched + images_missing, images_total);
    }

    // ---- Cover ----
    // Optional: a failed request must not fail the whole book.
    let cover = api
        .get_optional_bytes(&format!("/api/books/{book_id}/cover"))
        .await
        .ok()
        .flatten();
    if let Some(bytes) = &cover {
        send_step(
            &steps,
            BuildStep::Cover {
                bytes: bytes.clone(),
            },
        )
        .await?;
    } else if let Some(name) = existing.and_then(|e| e.cover()) {
        send_step(
            &steps,
            BuildStep::CopyCover {
                name: name.to_string(),
            },
        )
        .await?;
    }

    report("building", total, total);
    send_step(&steps, BuildStep::Finish { meta, chapters }).await?;

    Ok(BuildSummary {
        chapters_fetched,
        images_fetched,
        images_missing,
        cover,
    })
}

/// The whole chapter list of a book, in reading order.
async fn fetch_chapter_list(api: &Api, book_id: &str) -> Result<Vec<ServerChapterSummary>, String> {
    let mut list: Vec<ServerChapterSummary> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut offset = 0;
    loop {
        let page: ServerChapterPage = api
            .get_json(&format!(
                "/api/books/{book_id}/chapters?offset={offset}&limit={CHAPTERS_PAGE_SIZE}"
            ))
            .await?;
        if page.items.is_empty() {
            break;
        }
        offset += page.items.len();
        for item in page.items {
            // The list may shift between pages while chapters are being added.
            if seen.insert(item.id.clone()) {
                list.push(item);
            }
        }
        if !page.more {
            break;
        }
    }
    Ok(list)
}

/// Where the book is (or will be) stored.
struct Target {
    path: PathBuf,
    /// Previous build of the same book at `path`, when there is one.
    existing: Option<ExistingEpub>,
    /// Local id of the already mapped copy.
    local_id: Option<String>,
}

fn is_build_of(existing: &Option<ExistingEpub>, book_id: &str) -> bool {
    existing
        .as_ref()
        .is_some_and(|e| e.manifest.book_id == book_id)
}

/// Picks the file to write: the copy this device already has (it is updated in place) or
/// a new file in the download folder. A file that belongs to another book is never
/// overwritten.
async fn resolve_target(
    db: &crate::db::DbPool,
    book_id: &str,
    file_name: &str,
    series_name: Option<String>,
    base_dir: &str,
    custom_target_dir: Option<String>,
) -> Result<Target, String> {
    // 1. A copy downloaded earlier, wherever it lives now.
    let mappings = crate::db::get_book_mappings_by_server_id(db, book_id)
        .await
        .unwrap_or_default();
    for mapping in mappings {
        let Some(file_path) = mapping.file_path.filter(|p| !p.is_empty()) else {
            continue;
        };
        let path = PathBuf::from(&file_path);
        let probe = path.clone();
        let existing = tokio::task::spawn_blocking(move || read_existing_epub(&probe))
            .await
            .ok()
            .flatten();
        if is_build_of(&existing, book_id) {
            return Ok(Target {
                path,
                existing,
                local_id: Some(mapping.local_id),
            });
        }
    }

    // 2. A new file, placed like a regular download.
    let target_dir = if let Some(custom) = custom_target_dir {
        let trimmed = custom.trim();
        if !trimmed.is_empty() && !trimmed.contains("..") {
            PathBuf::from(trimmed)
        } else {
            PathBuf::from(base_dir)
        }
    } else if let Some(series) = series_name {
        let mut dir = PathBuf::from(base_dir);
        for part in series.split(['/', '\\']).filter(|p| !p.trim().is_empty()) {
            dir = dir.join(sanitize_filename_part(part));
        }
        dir
    } else {
        PathBuf::from(base_dir)
    };

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir)
            .await
            .map_err(|e| format!("Failed to create directory '{:?}': {e}", target_dir))?;
    }

    let clean_name = sanitize_filename_part(file_name);
    let stem = if clean_name.to_lowercase().ends_with(".epub") {
        clean_name[..clean_name.len() - 5].to_string()
    } else {
        clean_name
    };
    let short_id: String = book_id.chars().take(8).collect();
    let candidates = [
        target_dir.join(format!("{stem}.epub")),
        // Another book already uses the plain name
        target_dir.join(format!("{stem} ({short_id}).epub")),
    ];

    for path in candidates {
        if !path.exists() {
            return Ok(Target {
                path,
                existing: None,
                local_id: None,
            });
        }
        let probe = path.clone();
        let existing = tokio::task::spawn_blocking(move || read_existing_epub(&probe))
            .await
            .ok()
            .flatten();
        if is_build_of(&existing, book_id) {
            return Ok(Target {
                path,
                existing,
                local_id: None,
            });
        }
    }

    Err(format!(
        "Another file named '{stem}.epub' already exists in '{}'",
        target_dir.display()
    ))
}

/// Downloads (or updates) a `Chapters` book as a local EPUB.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn download_chapters_book(
    app: tauri::AppHandle,
    server_url: String,
    token: Option<String>,
    book_id: String,
    file_name: String,
    title: Option<String>,
    author: Option<String>,
    series_name: Option<String>,
    base_dir: String,
    custom_target_dir: Option<String>,
    progress: Option<DownloadProgressInput>,
    on_progress: tauri::ipc::Channel<ChaptersDownloadProgress>,
    db: tauri::State<'_, crate::db::DbPool>,
) -> Result<ChaptersBookDownloadResult, String> {
    let request = ChaptersBookRequest {
        server_url,
        token,
        book_id,
        file_name,
        title,
        author,
        series_name,
        base_dir,
        custom_target_dir,
        progress,
    };
    let covers_dir = get_covers_dir(&app).ok();
    download_book(&db, covers_dir, request, &move |event| {
        // Progress is best effort: the view may already be gone.
        let _ = on_progress.send(event);
    })
    .await
}

async fn download_book(
    db: &crate::db::DbPool,
    covers_dir: Option<PathBuf>,
    request: ChaptersBookRequest,
    on_progress: &ProgressSink,
) -> Result<ChaptersBookDownloadResult, String> {
    let ChaptersBookRequest {
        server_url,
        token,
        book_id,
        file_name,
        title,
        author,
        series_name,
        base_dir,
        custom_target_dir,
        progress,
    } = request;

    // The id ends up in request paths and in the EPUB itself.
    if uuid::Uuid::parse_str(&book_id).is_err() {
        return Err(format!("'{book_id}' is not a Folio book id"));
    }

    let api = Api::new(&server_url, token)?;

    let list = fetch_chapter_list(&api, &book_id).await?;
    if list.is_empty() {
        return Err(BOOK_HAS_NO_CHAPTERS_ERROR.to_string());
    }
    // Book details only refine the metadata; the catalog already gave us the basics.
    let details: ServerBook = api
        .get_json(&format!("/api/books/{book_id}"))
        .await
        .unwrap_or_default();

    let fallback_title = file_name.trim_end_matches(".epub").replace('_', " ");
    let resolved_title = details
        .title
        .filter(|t| !t.trim().is_empty())
        .or(title.filter(|t| !t.trim().is_empty()))
        .unwrap_or(fallback_title);
    let resolved_author = details
        .author
        .filter(|a| !a.trim().is_empty())
        .or(author.filter(|a| !a.trim().is_empty()))
        .unwrap_or_else(|| "Unknown Author".to_string());

    let target = resolve_target(
        db,
        &book_id,
        &file_name,
        series_name,
        &base_dir,
        custom_target_dir,
    )
    .await?;
    let final_path = target.path;
    let updated = target.existing.is_some();

    let meta = EpubMeta {
        book_id: book_id.clone(),
        title: resolved_title.clone(),
        author: resolved_author.clone(),
        language: chapters_epub::normalize_language(details.language.as_deref()),
        description: details.description,
    };
    let chapter_ids: Vec<String> = list.iter().map(|c| c.id.clone()).collect();
    let chapters_total = chapter_ids.len();

    let target_dir = final_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(&base_dir));
    let target_name = final_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "book.epub".to_string());
    let tmp_path = target_dir.join(format!(".{target_name}.tmp_{}", uuid::Uuid::now_v7()));

    // The archive is written on a blocking thread; the bounded channel keeps downloads
    // from running far ahead of the disk.
    let (steps_tx, steps_rx) = mpsc::channel::<BuildStep>(8);
    let builder = {
        let tmp_path = tmp_path.clone();
        let previous = updated.then(|| final_path.clone());
        tokio::task::spawn_blocking(move || run_builder(tmp_path, previous, steps_rx))
    };

    let fed = feed_builder(
        &api,
        &book_id,
        meta,
        list,
        target.existing.as_ref(),
        steps_tx,
        on_progress,
    )
    .await;
    let built = builder
        .await
        .unwrap_or_else(|e| Err(format!("EPUB builder failed: {e}")));

    let summary = match (fed, built) {
        (Ok(summary), Ok(())) => summary,
        (fed, built) => {
            let _ = fs::remove_file(&tmp_path).await;
            // When the builder failed first, the feeder only saw a closed channel.
            let error = match (fed.err(), built.err()) {
                (Some(feed_error), Some(build_error)) => {
                    if feed_error == BUILDER_STOPPED {
                        build_error
                    } else {
                        feed_error
                    }
                }
                (Some(error), None) | (None, Some(error)) => error,
                (None, None) => "Failed to build the book".to_string(),
            };
            return Err(error);
        }
    };

    if let Err(e) = fs::rename(&tmp_path, &final_path).await {
        let _ = fs::remove_file(&tmp_path).await;
        return Err(format!("Failed to finalize the book file: {e}"));
    }

    // ---- Local bookkeeping (best effort, like a regular download) ----
    let final_path_str = final_path.to_string_lossy().to_string();
    let local_id = target.local_id.unwrap_or_else(|| {
        let rel_path = final_path
            .strip_prefix(Path::new(&base_dir))
            .unwrap_or(&final_path)
            .to_string_lossy()
            .replace('\\', "/");
        format!("local-{}", rel_path.replace(['/', '\\', ' ', '.'], "_"))
    });

    let _ = crate::db::save_book_mapping(db, &local_id, &book_id, Some(&final_path_str)).await;

    // Chapters that changed their place in the book take the stored positions with them.
    match crate::db::replace_chapter_positions(db, &book_id, &chapter_ids).await {
        Ok(moved) => {
            let _ = crate::db::remap_book_cfis(db, &local_id, &book_id, &moved).await;
        }
        Err(e) => return Err(format!("Failed to save the chapter layout: {e}")),
    }

    let local_cover_path = covers_dir
        .as_ref()
        .map(|d| d.join(format!("{}.jpg", sanitize_filename_part(&local_id))));
    if let (Some(bytes), Some(covers_dir), Some(local_cover_path)) =
        (&summary.cover, &covers_dir, &local_cover_path)
    {
        let server_cover_path =
            covers_dir.join(format!("{}.jpg", sanitize_filename_part(&book_id)));
        let _ = fs::write(local_cover_path, bytes).await;
        let _ = fs::write(&server_cover_path, bytes).await;

        let _ = crate::db::save_local_book_meta(
            db,
            &local_id,
            &final_path_str,
            &resolved_title,
            &resolved_author,
            Some(&local_cover_path.to_string_lossy()),
            true,
        )
        .await;
    }

    // Reading position from the catalog: only for a fresh download, an existing copy has
    // its own progress which the regular sync reconciles.
    let mut location: Option<String> = None;
    if !updated && let Some(prog) = progress {
        let server_location = prog.location.unwrap_or_default();
        let progress_percent = prog.progress_percent.unwrap_or(0.0);
        let is_read = prog.is_read.unwrap_or(false);
        let updated_at = prog
            .updated_at
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

        // The server keeps the position of such books as `ch:<chapterId>`.
        let cfi = match server_location.strip_prefix("ch:") {
            Some(chapter_id) => chapter_ids
                .iter()
                .position(|id| id == chapter_id)
                .map(chapters_epub::chapter_start_cfi),
            None => chapters_epub::cfi_spine_index(&server_location).map(|_| server_location),
        };

        if cfi.is_some() || progress_percent > 0.0 || is_read {
            let stored_location = cfi.clone().unwrap_or_default();
            let _ = crate::db::save_progress(
                db,
                &local_id,
                &stored_location,
                progress_percent,
                is_read,
                false,
            )
            .await;
            let _ = crate::db::save_progress(
                db,
                &book_id,
                &stored_location,
                progress_percent,
                is_read,
                false,
            )
            .await;

            let file_size = fs::metadata(&final_path).await.ok().map(|m| m.len() as i64);
            let disk_cover = local_cover_path
                .as_ref()
                .filter(|p| p.is_file())
                .map(|p| p.to_string_lossy().to_string());

            let recent_book = crate::db::DbRecentBook {
                id: local_id.clone(),
                title: resolved_title,
                author: resolved_author,
                cover_path: disk_cover,
                cover_url: None,
                file_path: Some(final_path_str.clone()),
                file_name: Some(target_name),
                file_size,
                last_location: cfi.clone(),
                progress_fraction: progress_percent / 100.0,
                last_opened_at: updated_at,
            };
            let _ = crate::db::save_recent_book(db, &recent_book).await;
        }
        location = cfi;
    }

    Ok(ChaptersBookDownloadResult {
        file_path: final_path_str,
        local_id,
        chapters_total,
        chapters_fetched: summary.chapters_fetched,
        images_fetched: summary.images_fetched,
        images_missing: summary.images_missing,
        location,
        updated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::Read;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const BOOK_ID: &str = "0198c0de-0000-7000-8000-00000000000a";
    const OTHER_BOOK_ID: &str = "0198c0de-1111-7000-8000-00000000000b";
    const EMPTY_BOOK_ID: &str = "0198c0de-2222-7000-8000-00000000000c";
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];

    #[derive(Clone)]
    struct MockChapter {
        id: &'static str,
        chapter: f32,
        name: &'static str,
        content: Vec<String>,
        updated: Option<&'static str>,
    }

    /// The parts of the Folio API the download uses, served from memory.
    #[derive(Default)]
    struct MockServer {
        chapters: Vec<MockChapter>,
        images: HashMap<String, Vec<u8>>,
        cover: Option<Vec<u8>>,
        requests: Vec<String>,
    }

    fn chapter(id: &'static str, number: f32, name: &'static str, text: &str) -> MockChapter {
        MockChapter {
            id,
            chapter: number,
            name,
            content: vec![text.to_string()],
            updated: None,
        }
    }

    fn respond(state: &Mutex<MockServer>, target: &str) -> (u16, &'static str, Vec<u8>) {
        let mut state = state.lock().unwrap();
        state.requests.push(target.to_string());

        let (path, query) = target.split_once('?').unwrap_or((target, ""));
        let Some(rest) = path.strip_prefix("/api/books/") else {
            return (404, "text/plain", Vec::new());
        };
        let mut parts = rest.split('/');
        let book_id = parts.next().unwrap_or_default();
        let json =
            |value: serde_json::Value| (200, "application/json", value.to_string().into_bytes());
        let chapters: &[MockChapter] = if book_id == EMPTY_BOOK_ID {
            &[]
        } else {
            &state.chapters
        };

        match (parts.next(), parts.next()) {
            (None, _) => json(serde_json::json!({
                "id": book_id,
                "kind": "Chapters",
                "title": "Server Title",
                "author": "Server Author",
                "language": "ru",
                "description": "About <the> book",
                "series": [],
            })),
            (Some("chapters"), None) => {
                let param = |name: &str| {
                    query
                        .split('&')
                        .filter_map(|pair| pair.split_once('='))
                        .find(|(key, _)| *key == name)
                        .and_then(|(_, value)| value.parse::<usize>().ok())
                };
                let offset = param("offset").unwrap_or(0);
                // A tiny page forces the client to walk several pages
                let limit = param("limit").unwrap_or(100).min(2);
                let items: Vec<serde_json::Value> = chapters
                    .iter()
                    .skip(offset)
                    .take(limit)
                    .map(|c| {
                        serde_json::json!({
                            "id": c.id,
                            "bookId": book_id,
                            "volume": 1.0,
                            "chapter": c.chapter,
                            "name": c.name,
                            "created": "2026-01-01T00:00:00Z",
                            "updated": c.updated,
                        })
                    })
                    .collect();
                json(serde_json::json!({
                    "offset": offset,
                    "limit": limit,
                    "more": offset + items.len() < chapters.len(),
                    "items": items,
                }))
            }
            (Some("chapters"), Some(chapter_id)) => {
                match chapters.iter().find(|c| c.id == chapter_id) {
                    Some(c) => json(serde_json::json!({
                        "id": c.id,
                        "bookId": book_id,
                        "volume": 1.0,
                        "chapter": c.chapter,
                        "name": c.name,
                        "content": c.content,
                        "glossary": [],
                        "created": "2026-01-01T00:00:00Z",
                        "updated": c.updated,
                    })),
                    None => (404, "text/plain", Vec::new()),
                }
            }
            (Some("images"), Some(name)) => match state.images.get(name) {
                Some(bytes) => (200, "image/png", bytes.clone()),
                None => (404, "text/plain", Vec::new()),
            },
            (Some("cover"), None) => match &state.cover {
                Some(bytes) => (200, "image/png", bytes.clone()),
                None => (404, "text/plain", Vec::new()),
            },
            _ => (404, "text/plain", Vec::new()),
        }
    }

    async fn start_mock_server(state: Arc<Mutex<MockServer>>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let state = state.clone();
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut chunk = [0u8; 1024];
                    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                        match socket.read(&mut chunk).await {
                            Ok(0) | Err(_) => return,
                            Ok(n) => head.extend_from_slice(&chunk[..n]),
                        }
                    }
                    let head = String::from_utf8_lossy(&head).to_string();
                    let target = head.split_whitespace().nth(1).unwrap_or("/");
                    let (status, content_type, body) = respond(&state, target);
                    let header = format!(
                        "HTTP/1.1 {status} Mock\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = socket.write_all(header.as_bytes()).await;
                    let _ = socket.write_all(&body).await;
                    let _ = socket.shutdown().await;
                });
            }
        });
        format!("http://{address}")
    }

    fn request(server_url: &str, book_id: &str, base_dir: &Path) -> ChaptersBookRequest {
        ChaptersBookRequest {
            server_url: server_url.to_string(),
            token: Some("token".to_string()),
            book_id: book_id.to_string(),
            file_name: "My Book".to_string(),
            title: Some("Catalog Title".to_string()),
            author: None,
            series_name: None,
            base_dir: base_dir.to_string_lossy().to_string(),
            custom_target_dir: None,
            progress: None,
        }
    }

    fn read_entry(path: &Path, name: &str) -> Option<String> {
        let mut archive = open_archive(path).ok()?;
        let mut entry = archive.by_name(name).ok()?;
        let mut text = String::new();
        entry.read_to_string(&mut text).ok()?;
        Some(text)
    }

    #[tokio::test]
    async fn test_download_and_update_chapters_book() {
        let state = Arc::new(Mutex::new(MockServer {
            chapters: vec![
                chapter("ch-a", 1.0, "Start", "First chapter"),
                chapter(
                    "ch-b",
                    2.0,
                    "",
                    &format!(
                        "![pic](/api/books/{BOOK_ID}/images/pic.png) and ![lost](/api/books/{BOOK_ID}/images/gone.png)"
                    ),
                ),
                chapter("ch-c", 3.0, "End", "Third chapter"),
            ],
            images: HashMap::from([("pic.png".to_string(), PNG.to_vec())]),
            cover: Some(PNG.to_vec()),
            requests: Vec::new(),
        }));
        let server_url = start_mock_server(state.clone()).await;
        let pool = crate::db::init_db(Path::new(":memory:")).await.unwrap();
        let root = std::env::temp_dir().join(format!("folioreader-test-{}", uuid::Uuid::now_v7()));
        let books_dir = root.join("books");
        let covers_dir = root.join("covers");
        std::fs::create_dir_all(&books_dir).unwrap();
        std::fs::create_dir_all(&covers_dir).unwrap();

        let events: Arc<Mutex<Vec<ChaptersDownloadProgress>>> = Arc::default();
        let sink = {
            let events = events.clone();
            move |event: ChaptersDownloadProgress| events.lock().unwrap().push(event)
        };

        // ---- First download ----
        let mut first = request(&server_url, BOOK_ID, &books_dir);
        first.progress = Some(DownloadProgressInput {
            location: Some("ch:ch-b".to_string()),
            progress_percent: Some(66.0),
            is_read: Some(false),
            updated_at: None,
        });
        let result = download_book(&pool, Some(covers_dir.clone()), first, &sink)
            .await
            .unwrap();

        let book_path = books_dir.join("My Book.epub");
        assert_eq!(result.file_path, book_path.to_string_lossy());
        assert_eq!(result.local_id, "local-My_Book_epub");
        assert_eq!(result.chapters_total, 3);
        assert_eq!(result.chapters_fetched, 3);
        assert_eq!(result.images_fetched, 1);
        assert_eq!(result.images_missing, 1);
        assert!(!result.updated);
        // The server position (`ch:<id>`) became the start of the second spine item
        assert_eq!(result.location.as_deref(), Some("epubcfi(/6/4!/4)"));

        let existing = read_existing_epub(&book_path).unwrap();
        assert_eq!(existing.manifest.book_id, BOOK_ID);
        assert_eq!(existing.manifest.language, "ru");
        let ids: Vec<&str> = existing
            .manifest
            .chapters
            .iter()
            .map(|c| c.id.as_str())
            .collect();
        assert_eq!(ids, ["ch-a", "ch-b", "ch-c"]);
        assert!(existing.has_image("pic.png"));
        assert!(!existing.has_image("gone.png"));
        assert!(existing.cover().is_some());
        let opf = read_entry(
            &book_path,
            &chapters_epub::content_entry_name("content.opf"),
        )
        .unwrap();
        assert!(opf.contains("Server Title"));
        assert!(opf.contains("Server Author"));
        let first_chapter =
            read_entry(&book_path, &chapters_epub::chapter_entry_name("ch-a")).unwrap();
        assert!(first_chapter.contains("First chapter"));

        assert_eq!(
            crate::db::get_server_book_id(&pool, &result.local_id)
                .await
                .unwrap()
                .as_deref(),
            Some(BOOK_ID)
        );
        assert_eq!(
            crate::db::get_chapter_position(&pool, BOOK_ID, "ch-c")
                .await
                .unwrap(),
            Some(2)
        );
        let progress = crate::db::get_progress(&pool, &result.local_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(progress.location, "epubcfi(/6/4!/4)");
        assert_eq!(progress.sync_status, "synced");
        assert!(covers_dir.join("local-My_Book_epub.jpg").is_file());
        {
            let events = events.lock().unwrap();
            assert!(
                events
                    .iter()
                    .any(|e| e.phase == "chapters" && e.done == 3 && e.total == 3)
            );
            assert_eq!(events.last().map(|e| e.phase), Some("building"));
        }
        // No temporary files are left next to the book
        assert_eq!(std::fs::read_dir(&books_dir).unwrap().count(), 1);

        // ---- The reader moved into the last chapter; the server got a new chapter in the
        // middle and an edit of the last one ----
        crate::db::save_progress(
            &pool,
            &result.local_id,
            "epubcfi(/6/6!/4/2/1:5)",
            90.0,
            false,
            true,
        )
        .await
        .unwrap();
        {
            let mut state = state.lock().unwrap();
            state
                .chapters
                .insert(1, chapter("ch-a2", 1.5, "Interlude", "Inserted chapter"));
            state.chapters[3].content = vec!["Third chapter, edited".to_string()];
            state.chapters[3].updated = Some("2026-02-02T00:00:00Z");
            state.requests.clear();
        }

        let result = download_book(
            &pool,
            Some(covers_dir.clone()),
            request(&server_url, BOOK_ID, &books_dir),
            &sink,
        )
        .await
        .unwrap();
        assert!(result.updated);
        assert_eq!(result.file_path, book_path.to_string_lossy());
        assert_eq!(result.local_id, "local-My_Book_epub");
        assert_eq!(result.chapters_total, 4);
        assert_eq!(result.chapters_fetched, 2);
        assert_eq!(result.images_fetched, 0);
        assert_eq!(result.images_missing, 1);
        assert_eq!(result.location, None);
        {
            let state = state.lock().unwrap();
            let fetched = |id: &str| {
                state
                    .requests
                    .iter()
                    .any(|r| r.ends_with(&format!("/chapters/{id}")))
            };
            assert!(fetched("ch-a2") && fetched("ch-c"));
            // Unchanged chapters and the embedded illustration come from the previous build
            assert!(!fetched("ch-a") && !fetched("ch-b"));
            assert!(
                !state
                    .requests
                    .iter()
                    .any(|r| r.ends_with("/images/pic.png"))
            );
        }

        let existing = read_existing_epub(&book_path).unwrap();
        let ids: Vec<&str> = existing
            .manifest
            .chapters
            .iter()
            .map(|c| c.id.as_str())
            .collect();
        assert_eq!(ids, ["ch-a", "ch-a2", "ch-b", "ch-c"]);
        assert!(existing.has_image("pic.png"));
        let last_chapter =
            read_entry(&book_path, &chapters_epub::chapter_entry_name("ch-c")).unwrap();
        assert!(last_chapter.contains("Third chapter, edited"));
        let kept_chapter =
            read_entry(&book_path, &chapters_epub::chapter_entry_name("ch-b")).unwrap();
        assert!(kept_chapter.contains("images/pic.png"));

        // The reading position followed its chapter to the new place and still waits for sync
        let progress = crate::db::get_progress(&pool, &result.local_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(progress.location, "epubcfi(/6/8!/4/2/1:5)");
        assert_eq!(progress.sync_status, "pending");
        assert_eq!(
            crate::db::get_chapter_position(&pool, BOOK_ID, "ch-c")
                .await
                .unwrap(),
            Some(3)
        );
        assert_eq!(std::fs::read_dir(&books_dir).unwrap().count(), 1);

        // ---- Another book with the same file name never overwrites this one ----
        let other = download_book(
            &pool,
            None,
            request(&server_url, OTHER_BOOK_ID, &books_dir),
            &sink,
        )
        .await
        .unwrap();
        assert_eq!(
            other.file_path,
            books_dir.join("My Book (0198c0de).epub").to_string_lossy()
        );
        assert_eq!(
            read_existing_epub(&book_path).unwrap().manifest.book_id,
            BOOK_ID
        );

        // ---- A book without chapters cannot be built ----
        let error = download_book(
            &pool,
            None,
            request(&server_url, EMPTY_BOOK_ID, &books_dir),
            &sink,
        )
        .await
        .unwrap_err();
        assert_eq!(error, BOOK_HAS_NO_CHAPTERS_ERROR);
        let error = download_book(
            &pool,
            None,
            request(&server_url, "../etc", &books_dir),
            &sink,
        )
        .await
        .unwrap_err();
        assert!(error.contains("not a Folio book id"));
        assert_eq!(std::fs::read_dir(&books_dir).unwrap().count(), 2);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn test_failed_download_leaves_nothing_behind() {
        // The list names a chapter the server then fails to deliver
        let state = Arc::new(Mutex::new(MockServer {
            chapters: vec![chapter("ch-a", 1.0, "Start", "First chapter")],
            ..MockServer::default()
        }));
        let server_url = start_mock_server(state.clone()).await;
        let pool = crate::db::init_db(Path::new(":memory:")).await.unwrap();
        let root = std::env::temp_dir().join(format!("folioreader-test-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&root).unwrap();

        let api = Api::new(&server_url, None).unwrap();
        let list = fetch_chapter_list(&api, BOOK_ID).await.unwrap();
        state.lock().unwrap().chapters.clear();

        let tmp_path = root.join(".book.epub.tmp");
        let (steps_tx, steps_rx) = mpsc::channel::<BuildStep>(8);
        let builder = {
            let tmp_path = tmp_path.clone();
            tokio::task::spawn_blocking(move || run_builder(tmp_path, None, steps_rx))
        };
        let meta = EpubMeta {
            book_id: BOOK_ID.to_string(),
            title: "Title".to_string(),
            author: "Author".to_string(),
            language: "en".to_string(),
            description: None,
        };
        let fed = feed_builder(&api, BOOK_ID, meta, list, None, steps_tx, &|_| {}).await;
        assert!(fed.is_err_and(|e| e.contains("404")));
        assert_eq!(builder.await.unwrap(), Err(BUILDER_STOPPED.to_string()));

        // ...and the command as a whole reports the error without leaving files
        state.lock().unwrap().chapters = vec![chapter("ch-a", 1.0, "Start", "First chapter")];
        state.lock().unwrap().images.clear();
        let _ = std::fs::remove_file(&tmp_path);
        let result = download_book(
            &pool,
            None,
            request("http://127.0.0.1:1", BOOK_ID, &root),
            &|_| {},
        )
        .await;
        assert!(result.is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);

        let _ = std::fs::remove_dir_all(&root);
    }
}
