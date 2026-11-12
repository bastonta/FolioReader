use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomFontInfo {
    pub id: String,
    pub name: String,
    pub font_family: String,
    pub file_path: String,
    pub file_name: String,
    pub format: String,
    pub file_size: u64,
}

pub fn get_fonts_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base_dir = crate::get_app_base_dir(app)?;

    let fonts_dir = base_dir.join("fonts");
    if !fonts_dir.exists() {
        std::fs::create_dir_all(&fonts_dir)
            .map_err(|e| format!("Failed to create fonts directory: {e}"))?;
    }
    Ok(fonts_dir)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBookFile {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub relative_path: String,
    pub folder_name: Option<String>,
    pub file_size: u64,
    pub modified_at: Option<String>,
}

pub(crate) fn sanitize_filename_part(name: &str) -> String {
    let invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let mut clean: String = name
        .chars()
        .map(|c| {
            if invalid_chars.contains(&c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();

    clean = clean.trim().trim_matches('.').to_string();
    if clean.is_empty() {
        "untitled".to_string()
    } else {
        clean
    }
}

/// Local library id of a file: its path relative to the download folder.
pub(crate) fn local_id_for_path(path: &Path, base_dir: &str) -> String {
    let rel_path = path
        .strip_prefix(Path::new(base_dir))
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    format!("local-{}", rel_path.replace(['/', '\\', ' ', '.'], "_"))
}

/// Local id of the file at `path`: the one it was recorded under, or else the one its
/// path gives it.
pub(crate) async fn local_id_of_file(
    db: &crate::db::DbPool,
    path: &Path,
    base_dir: &str,
) -> String {
    crate::db::get_local_id_for_file(db, &path.to_string_lossy())
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| local_id_for_path(path, base_dir))
}

/// HTTP client for downloads. There is no limit on the whole transfer — a large book on a
/// slow connection takes as long as it takes — only on connecting and on silence.
pub(crate) fn download_client() -> Result<reqwest::Client, String> {
    let root_certs = webpki_root_certs::TLS_SERVER_ROOT_CERTS
        .iter()
        .filter_map(|der| reqwest::Certificate::from_der(der.as_ref()).ok());

    reqwest::Client::builder()
        .tls_certs_only(root_certs)
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// Prefix of the error a command returns when the server rejected the access token.
pub const UNAUTHORIZED_ERROR: &str = "UNAUTHORIZED";

pub(crate) fn unauthorized_error(what: &str) -> String {
    format!("{UNAUTHORIZED_ERROR}: the server rejected the access token ({what})")
}

/// Temporary files of downloads (`.{name}.tmp_{uuid}`) are removed when a download ends,
/// unless the application was killed. One that has not been written to for an hour is
/// such a leftover (a download in progress keeps writing to its file).
fn is_stale_download_leftover(name: &str, modified: Option<std::time::SystemTime>) -> bool {
    const MAX_AGE: std::time::Duration = std::time::Duration::from_secs(60 * 60);

    let is_download_tmp = name.starts_with('.')
        && name
            .rsplit_once(".tmp_")
            .is_some_and(|(_, id)| uuid::Uuid::parse_str(id).is_ok());
    is_download_tmp
        && modified
            .and_then(|time| time.elapsed().ok())
            .is_some_and(|age| age > MAX_AGE)
}

#[tauri::command]
pub async fn get_default_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let base_dir = if cfg!(debug_assertions) {
        app.path()
            .download_dir()
            .or_else(|_| app.path().document_dir())
            .or_else(|_| app.path().app_local_data_dir())
            .or_else(|_| app.path().app_data_dir())
            .map_err(|e| format!("Failed to resolve default directory: {e}"))?
    } else {
        app.path()
            .document_dir()
            .or_else(|_| app.path().download_dir())
            .or_else(|_| app.path().app_local_data_dir())
            .or_else(|_| app.path().app_data_dir())
            .map_err(|e| format!("Failed to resolve default directory: {e}"))?
    };

    let folio_dir = base_dir.join("FolioBooks");
    if !folio_dir.exists() {
        fs::create_dir_all(&folio_dir)
            .await
            .map_err(|e| format!("Failed to create default folder: {e}"))?;
    }

    Ok(folio_dir.to_string_lossy().to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn pick_folder(default_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_title("Select Books Folder");

    if let Some(path_str) = default_path {
        let p = PathBuf::from(path_str);
        if p.exists() {
            dialog = dialog.set_directory(&p);
        }
    }

    let folder = dialog.pick_folder().await;
    Ok(folder.map(|f| f.path().to_string_lossy().to_string()))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub async fn pick_folder(_default_path: Option<String>) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub async fn scan_local_books(
    dir_path: String,
    db: tauri::State<'_, crate::db::DbPool>,
) -> Result<Vec<LocalBookFile>, String> {
    let base = PathBuf::from(&dir_path);
    if !base.exists() || !base.is_dir() {
        return Ok(Vec::new());
    }

    // A file keeps the id it was recorded under: the id is derived from the path relative
    // to the download folder, and that folder may have been changed since.
    let recorded_ids = crate::db::get_local_ids_by_file(&db)
        .await
        .unwrap_or_default();

    let mut books = Vec::new();
    let mut stack = vec![base.clone()];

    while let Some(current_dir) = stack.pop() {
        let mut entries = match fs::read_dir(&current_dir).await {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                // Avoid hidden directories
                if let Some(name) = path.file_name().and_then(|n| n.to_str())
                    && !name.starts_with('.')
                {
                    stack.push(path);
                }
            } else if path.is_file() {
                // Leftovers of downloads that were killed half way
                if let Some(name) = path.file_name().and_then(|n| n.to_str())
                    && name.starts_with('.')
                    && is_stale_download_leftover(
                        name,
                        entry.metadata().await.ok().and_then(|m| m.modified().ok()),
                    )
                {
                    let _ = fs::remove_file(&path).await;
                    continue;
                }
                // Scan ONLY .epub files as requested
                if let Some(ext) = path.extension().and_then(|e| e.to_str())
                    && ext.eq_ignore_ascii_case("epub")
                {
                    let file_name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("book.epub")
                        .to_string();

                    let rel_path = path
                        .strip_prefix(&base)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .replace('\\', "/");

                    let folder_name = if let Some(parent) = path.parent() {
                        if parent != base {
                            parent
                                .strip_prefix(&base)
                                .ok()
                                .and_then(|p| p.to_str())
                                .map(|s| s.replace('\\', "/"))
                                .or_else(|| {
                                    parent
                                        .file_name()
                                        .and_then(|n| n.to_str())
                                        .map(|s| s.to_string())
                                })
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let metadata = entry.metadata().await.ok();
                    let file_size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                    let modified_at = metadata.and_then(|m| m.modified().ok()).map(|time| {
                        let datetime: chrono::DateTime<chrono::Utc> = time.into();
                        datetime.to_rfc3339()
                    });

                    let file_path = path.to_string_lossy().to_string();
                    let id = recorded_ids.get(&file_path).cloned().unwrap_or_else(|| {
                        format!("local-{}", rel_path.replace(['/', '\\', ' ', '.'], "_"))
                    });

                    books.push(LocalBookFile {
                        id,
                        file_path,
                        file_name,
                        relative_path: rel_path,
                        folder_name,
                        file_size,
                        modified_at,
                    });
                }
            }
        }
    }

    // Sort by file_name ascending
    books.sort_by_key(|a| a.file_name.to_lowercase());

    Ok(books)
}

#[tauri::command]
pub async fn read_book_file(file_path: String) -> Result<tauri::ipc::Response, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }

    let bytes = fs::read(path)
        .await
        .map_err(|e| format!("Failed to read file '{file_path}': {e}"))?;

    Ok(tauri::ipc::Response::new(bytes))
}

/// Size of a book file, for reading it in ranges with `read_book_file_range`.
#[tauri::command]
pub async fn get_book_file_size(file_path: String) -> Result<u64, String> {
    fs::metadata(Path::new(&file_path))
        .await
        .map(|m| m.len())
        .map_err(|e| format!("Failed to read file '{file_path}': {e}"))
}

/// Largest range `read_book_file_range` returns in one call.
const MAX_FILE_RANGE: u64 = 16 * 1024 * 1024;

/// Bytes `offset..offset + length` of a book file (less at the end of the file). An EPUB
/// is a ZIP archive that is read entry by entry: with ranges the WebView never has to
/// hold a whole book of several hundred megabytes, as `read_book_file` makes it do.
#[tauri::command]
pub async fn read_book_file_range(
    file_path: String,
    offset: u64,
    length: u64,
) -> Result<tauri::ipc::Response, String> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let mut file = fs::File::open(Path::new(&file_path))
        .await
        .map_err(|e| format!("Failed to read file '{file_path}': {e}"))?;
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|e| format!("Failed to read file '{file_path}': {e}"))?;

    let mut bytes = Vec::new();
    file.take(length.min(MAX_FILE_RANGE))
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| format!("Failed to read file '{file_path}': {e}"))?;

    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressInput {
    pub location: Option<String>,
    pub progress_percent: Option<f32>,
    pub is_read: Option<bool>,
    pub updated_at: Option<String>,
}

/// Error returned by `download_book_file` when the server has no file for the book
/// (`Chapters` kind, HTTP 409). The frontend matches on this exact string.
pub const BOOK_HAS_NO_FILE_ERROR: &str = "BOOK_HAS_NO_FILE";

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn download_book_file(
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
    db: tauri::State<'_, crate::db::DbPool>,
) -> Result<String, String> {
    let target_dir = if let Some(custom) = custom_target_dir {
        let trimmed = custom.trim();
        if !trimmed.is_empty() && !trimmed.contains("..") {
            PathBuf::from(trimmed)
        } else {
            PathBuf::from(&base_dir)
        }
    } else if let Some(series) = series_name {
        let mut dir = PathBuf::from(&base_dir);
        let parts: Vec<&str> = series
            .split(['/', '\\'])
            .filter(|p| !p.trim().is_empty())
            .collect();
        if parts.is_empty() {
            dir
        } else {
            for part in parts {
                let clean_part = sanitize_filename_part(part);
                if !clean_part.is_empty() {
                    dir = dir.join(clean_part);
                }
            }
            dir
        }
    } else {
        PathBuf::from(&base_dir)
    };

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir)
            .await
            .map_err(|e| format!("Failed to create directory '{:?}': {e}", target_dir))?;
    }

    let mut clean_name = sanitize_filename_part(&file_name);
    if !clean_name.to_lowercase().ends_with(".epub") {
        clean_name = format!("{clean_name}.epub");
    }

    let client = download_client()?;

    let url = format!(
        "{}/api/books/{}/download",
        server_url.trim_end_matches('/'),
        book_id
    );

    let mut request = client.get(&url);
    if let Some(t) = token.as_ref()
        && !t.is_empty()
    {
        request = request.header("Authorization", format!("Bearer {t}"));
    }

    let mut response = request
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if response.status() == reqwest::StatusCode::CONFLICT {
        // Folio answers 409 for books assembled from chapters: they have no EPUB file.
        return Err(BOOK_HAS_NO_FILE_ERROR.to_string());
    }

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(unauthorized_error("book download"));
    }

    if !response.status().is_success() {
        return Err(format!(
            "Server returned status {} when downloading book",
            response.status()
        ));
    }

    let tmp_path = target_dir.join(format!(".{clean_name}.tmp_{}", uuid::Uuid::now_v7()));

    let write_res: Result<(), String> = async {
        let mut file = tokio::fs::File::create(&tmp_path).await.map_err(|e| {
            format!(
                "Failed to create temporary download file '{:?}': {e}",
                tmp_path
            )
        })?;

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("Failed to read chunk from server: {e}"))?
        {
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Failed to write chunk to file: {e}"))?;
        }

        file.flush()
            .await
            .map_err(|e| format!("Failed to flush file '{:?}': {e}", tmp_path))?;

        Ok(())
    }
    .await;

    if let Err(e) = write_res {
        let _ = fs::remove_file(&tmp_path).await;
        return Err(e);
    }

    let (final_path, local_id) = match pick_download_target(
        &db,
        &target_dir,
        &clean_name,
        &base_dir,
        &book_id,
        &tmp_path,
    )
    .await
    {
        Ok(target) => target,
        Err(e) => {
            let _ = fs::remove_file(&tmp_path).await;
            return Err(e);
        }
    };

    if let Err(e) = fs::rename(&tmp_path, &final_path).await {
        let _ = fs::remove_file(&tmp_path).await;
        return Err(format!("Failed to finalize downloaded book file: {e}"));
    }

    let final_path_str = final_path.to_string_lossy().to_string();

    let resolved_title =
        title.unwrap_or_else(|| file_name.trim_end_matches(".epub").replace('_', " "));
    let resolved_author = author.unwrap_or_else(|| "Unknown Author".to_string());

    match crate::db::save_book_mapping(&db, &local_id, &book_id, Some(&final_path_str)).await {
        Ok(true) => {}
        Ok(false) => {
            return Err(format!(
                "'{final_path_str}' is already bound to another server book"
            ));
        }
        Err(e) => return Err(format!("Failed to record the downloaded book: {e}")),
    }
    // The book has a real file now: copies assembled from chapters earlier (if any) are no
    // longer what the reading position refers to.
    let _ = crate::db::delete_chapter_copies_of_book(&db, &book_id, Some(&local_id)).await;

    // Auto-fetch book cover from server and cache locally
    if let Ok(covers_dir) = get_covers_dir(&app) {
        let cover_url = format!(
            "{}/api/books/{}/cover",
            server_url.trim_end_matches('/'),
            book_id
        );
        let mut cover_req = client.get(&cover_url);
        if let Some(t) = &token
            && !t.is_empty()
        {
            cover_req = cover_req.header("Authorization", format!("Bearer {t}"));
        }
        if let Ok(cover_resp) = cover_req.send().await
            && cover_resp.status().is_success()
            && let Ok(bytes) = cover_resp.bytes().await
        {
            let local_cover_file = format!("{}.jpg", sanitize_filename_part(&local_id));
            let server_cover_file = format!("{}.jpg", sanitize_filename_part(&book_id));
            let local_cover_path = covers_dir.join(&local_cover_file);
            let server_cover_path = covers_dir.join(&server_cover_file);
            let _ = fs::write(&local_cover_path, &bytes).await;
            let _ = fs::write(&server_cover_path, &bytes).await;

            let _ = crate::db::save_local_book_meta(
                &db,
                &local_id,
                &final_path_str,
                &resolved_title,
                &resolved_author,
                Some(&local_cover_path.to_string_lossy()),
                true,
            )
            .await;
        }
    }

    // Save reading progress from passed metadata if available (no extra request needed)
    if let Some(prog) = progress {
        let location = prog.location.unwrap_or_default();
        let progress_percent = prog.progress_percent.unwrap_or(0.0);
        let is_read = prog.is_read.unwrap_or(false);
        let updated_at = prog
            .updated_at
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

        // A book that is downloaded again keeps the position it already has here: the
        // regular sync decides between it and the server by their change times.
        let has_local_progress = crate::db::get_progress(&db, &local_id)
            .await
            .ok()
            .flatten()
            .is_some();
        if !has_local_progress && (!location.is_empty() || progress_percent > 0.0 || is_read) {
            for id in [&local_id, &book_id] {
                let _ = crate::db::save_progress_at(
                    &db,
                    id,
                    &location,
                    progress_percent,
                    is_read,
                    false,
                    Some(&updated_at),
                )
                .await;
            }

            let file_size = match tokio::fs::metadata(&final_path).await {
                Ok(m) => Some(m.len() as i64),
                Err(_) => None,
            };
            let disk_cover = get_covers_dir(&app).ok().map(|d| {
                d.join(format!("{}.jpg", sanitize_filename_part(&local_id)))
                    .to_string_lossy()
                    .to_string()
            });

            let recent_book = crate::db::DbRecentBook {
                id: local_id.clone(),
                title: resolved_title,
                author: resolved_author,
                cover_path: disk_cover,
                cover_url: None,
                file_path: Some(final_path_str.clone()),
                file_name: final_path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string()),
                file_size,
                last_location: if location.is_empty() {
                    None
                } else {
                    Some(location)
                },
                progress_fraction: progress_percent / 100.0,
                last_opened_at: updated_at,
            };
            let _ = crate::db::save_recent_book(&db, &recent_book).await;
        }
    }

    Ok(final_path_str)
}

/// Where a downloaded book goes: `{name}.epub`, or `{name} ({id}).epub` when the plain
/// name belongs to another book. A file — and the local id that comes with its path — is
/// reused only for the same server book or for a file with the very same content;
/// overwriting the file of another book would hand its reading state, bookmarks and
/// annotations to this one. Returns the path and the local id of the file.
async fn pick_download_target(
    db: &crate::db::DbPool,
    target_dir: &Path,
    clean_name: &str,
    base_dir: &str,
    book_id: &str,
    downloaded: &Path,
) -> Result<(PathBuf, String), String> {
    let stem = &clean_name[..clean_name.len() - ".epub".len()];
    let short_id: String = book_id.chars().take(8).collect();
    let candidates = [
        target_dir.join(clean_name),
        target_dir.join(format!("{stem} ({short_id}).epub")),
    ];

    for path in candidates {
        let local_id = local_id_of_file(db, &path, base_dir).await;
        let bound = crate::db::get_bound_server_book_id(db, &local_id)
            .await
            .map_err(|e| format!("Failed to look up the local book: {e}"))?;

        let usable = match bound {
            Some(bound) => bound == book_id,
            None if !path.exists() => true,
            // A file nothing is known about: the same book only if it is the same bytes
            None => {
                let existing = crate::sync_manager::file_sha256(&path).await;
                existing.is_some() && existing == crate::sync_manager::file_sha256(downloaded).await
            }
        };
        if usable {
            return Ok((path, local_id));
        }
    }

    Err(format!(
        "Another book named '{clean_name}' already exists in '{}'",
        target_dir.display()
    ))
}

/// Finds the file of a server book that was downloaded before this device recorded what
/// it downloads. A file is the book only if the server knows its content (`by-hash`) as
/// this very book: a file that merely has the name the book would be saved under belongs
/// to some other book ("Volume 1" of another series), and binding it would send that
/// book's reading progress and annotations into this one. The binding of a file that is
/// already bound is never changed.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn find_downloaded_book(
    server_url: String,
    token: Option<String>,
    book_id: String,
    file_name: String,
    series_name: Option<String>,
    base_dir: String,
    db: tauri::State<'_, crate::db::DbPool>,
) -> Result<Option<String>, String> {
    let Some(named) = check_book_downloaded(base_dir.clone(), file_name, series_name).await? else {
        return Ok(None);
    };
    let path = PathBuf::from(&named);

    let local_id = local_id_of_file(&db, &path, &base_dir).await;
    match crate::db::get_bound_server_book_id(&db, &local_id)
        .await
        .map_err(|e| e.to_string())?
    {
        Some(bound) if bound == book_id => return Ok(Some(named)),
        Some(_) => return Ok(None),
        None => {}
    }

    let Some(hash) = crate::sync_manager::file_sha256(&path).await else {
        return Ok(None);
    };
    let client = download_client()?;
    let url = format!(
        "{}/api/books/by-hash/{hash}",
        server_url.trim_end_matches('/')
    );
    let mut request = client.get(&url);
    if let Some(t) = token.as_ref()
        && !t.is_empty()
    {
        request = request.header("Authorization", format!("Bearer {t}"));
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Failed to look up the book by its content: {e}"))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(unauthorized_error("book lookup"));
    }
    if !response.status().is_success() {
        return Ok(None);
    }
    let found = response
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|book| {
            book.get("id")
                .and_then(|id| id.as_str())
                .map(str::to_string)
        });
    if found.as_deref() != Some(book_id.as_str()) {
        return Ok(None);
    }

    match crate::db::save_book_mapping(&db, &local_id, &book_id, Some(&named)).await {
        Ok(true) => Ok(Some(named)),
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn delete_book_file(file_path: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    if path.exists() && path.is_file() {
        fs::remove_file(path)
            .await
            .map_err(|e| format!("Failed to delete file '{file_path}': {e}"))?;
        // What the application knows about the file stays, as for any other book: its
        // binding, its reading state and — for a copy built from server chapters — which
        // chapters it held. A copy without that record would sync what is still pending
        // as a regular book: percentages of a volume as those of the whole book, CFIs of
        // the built file in place of `ch:` positions.
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn check_book_downloaded(
    base_dir: String,
    file_name: String,
    series_name: Option<String>,
) -> Result<Option<String>, String> {
    let mut clean_name = sanitize_filename_part(&file_name);
    if !clean_name.to_lowercase().ends_with(".epub") {
        clean_name = format!("{clean_name}.epub");
    }

    // 1. Check in series directory (including nested series path) if specified
    if let Some(series) = series_name {
        let mut series_dir = PathBuf::from(&base_dir);
        let parts: Vec<&str> = series
            .split(['/', '\\'])
            .filter(|p| !p.trim().is_empty())
            .collect();
        for part in parts {
            let clean_part = sanitize_filename_part(part);
            if !clean_part.is_empty() {
                series_dir = series_dir.join(clean_part);
            }
        }
        let series_file = series_dir.join(&clean_name);
        if series_file.exists() && series_file.is_file() {
            return Ok(Some(series_file.to_string_lossy().to_string()));
        }
    }

    // 2. Check directly in base directory
    let root_file = PathBuf::from(&base_dir).join(&clean_name);
    if root_file.exists() && root_file.is_file() {
        return Ok(Some(root_file.to_string_lossy().to_string()));
    }

    // 3. Fallback: recursive search under base_dir
    let base = PathBuf::from(&base_dir);
    if base.exists() && base.is_dir() {
        let mut stack = vec![base];
        while let Some(current_dir) = stack.pop() {
            if let Ok(mut entries) = fs::read_dir(&current_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if path.is_dir() {
                        if let Some(name) = path.file_name().and_then(|n| n.to_str())
                            && !name.starts_with('.')
                        {
                            stack.push(path);
                        }
                    } else if path.is_file()
                        && let Some(name) = path.file_name().and_then(|n| n.to_str())
                        && name.eq_ignore_ascii_case(&clean_name)
                    {
                        return Ok(Some(path.to_string_lossy().to_string()));
                    }
                }
            }
        }
    }

    Ok(None)
}

#[tauri::command]
pub async fn save_custom_font(
    app: tauri::AppHandle,
    file_name: String,
    base64_data: String,
) -> Result<CustomFontInfo, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64 font data: {e}"))?;

    let fonts_dir = get_fonts_dir(&app)?;
    let clean_file_name = sanitize_filename_part(&file_name);
    let target_path = fonts_dir.join(&clean_file_name);

    fs::write(&target_path, &bytes)
        .await
        .map_err(|e| format!("Failed to save font file '{clean_file_name}': {e}"))?;

    let ext = target_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("ttf")
        .to_lowercase();

    let format = match ext.as_str() {
        "woff2" => "woff2",
        "woff" => "woff",
        "otf" => "opentype",
        _ => "truetype",
    }
    .to_string();

    let stem = target_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("font")
        .to_string();

    let name = stem.replace(['_', '-'], " ");
    let font_family = format!("CustomFont_{}", stem.replace([' ', '-'], "_"));
    let id = format!("font-{}", stem.replace([' ', '-'], "_"));

    Ok(CustomFontInfo {
        id,
        name,
        font_family,
        file_path: target_path.to_string_lossy().to_string(),
        file_name: clean_file_name,
        format,
        file_size: bytes.len() as u64,
    })
}

#[tauri::command]
pub async fn list_custom_fonts(app: tauri::AppHandle) -> Result<Vec<CustomFontInfo>, String> {
    let fonts_dir = get_fonts_dir(&app)?;
    let mut fonts = Vec::new();

    let mut entries = match fs::read_dir(&fonts_dir).await {
        Ok(e) => e,
        Err(_) => return Ok(fonts),
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.is_file()
            && let Some(ext) = path.extension().and_then(|e| e.to_str())
        {
            let ext_lower = ext.to_lowercase();
            if ["ttf", "otf", "woff", "woff2"].contains(&ext_lower.as_str()) {
                let file_name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("font")
                    .to_string();

                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("font")
                    .to_string();

                let name = stem.replace(['_', '-'], " ");
                let font_family = format!("CustomFont_{}", stem.replace([' ', '-'], "_"));
                let id = format!("font-{}", stem.replace([' ', '-'], "_"));

                let format = match ext_lower.as_str() {
                    "woff2" => "woff2",
                    "woff" => "woff",
                    "otf" => "opentype",
                    _ => "truetype",
                }
                .to_string();

                let metadata = entry.metadata().await.ok();
                let file_size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);

                fonts.push(CustomFontInfo {
                    id,
                    name,
                    font_family,
                    file_path: path.to_string_lossy().to_string(),
                    file_name,
                    format,
                    file_size,
                });
            }
        }
    }

    fonts.sort_by_key(|a| a.name.to_lowercase());
    Ok(fonts)
}

#[tauri::command]
pub async fn delete_custom_font(app: tauri::AppHandle, file_name: String) -> Result<bool, String> {
    let fonts_dir = get_fonts_dir(&app)?;
    let target_path = fonts_dir.join(&file_name);
    if target_path.exists() && target_path.is_file() {
        fs::remove_file(&target_path)
            .await
            .map_err(|e| format!("Failed to delete font '{file_name}': {e}"))?;
        Ok(true)
    } else {
        let path = PathBuf::from(&file_name);
        if path.exists() && path.is_file() {
            fs::remove_file(&path)
                .await
                .map_err(|e| format!("Failed to delete font '{file_name}': {e}"))?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

#[tauri::command]
pub async fn read_font_file(file_path: String) -> Result<Vec<u8>, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("Font file not found: {file_path}"));
    }

    fs::read(path)
        .await
        .map_err(|e| format!("Failed to read font file '{file_path}': {e}"))
}

#[cfg(target_os = "linux")]
fn configure_linux_command(cmd: &mut std::process::Command) {
    if let Ok(orig_ld) = std::env::var("LD_LIBRARY_PATH_ORIG")
        .or_else(|_| std::env::var("ORIG_LD_LIBRARY_PATH"))
        .or_else(|_| std::env::var("SAVED_LD_LIBRARY_PATH"))
    {
        if !orig_ld.trim().is_empty() {
            cmd.env("LD_LIBRARY_PATH", orig_ld);
        } else {
            cmd.env_remove("LD_LIBRARY_PATH");
        }
    } else {
        cmd.env_remove("LD_LIBRARY_PATH");
    }

    if let Ok(orig_preload) =
        std::env::var("LD_PRELOAD_ORIG").or_else(|_| std::env::var("ORIG_LD_PRELOAD"))
    {
        if !orig_preload.trim().is_empty() {
            cmd.env("LD_PRELOAD", orig_preload);
        } else {
            cmd.env_remove("LD_PRELOAD");
        }
    } else {
        cmd.env_remove("LD_PRELOAD");
    }

    cmd.env_remove("GSETTINGS_SCHEMA_DIR");
    cmd.env_remove("APPDIR");
    cmd.env_remove("APPIMAGE");
    cmd.env_remove("PYTHONHOME");
    cmd.env_remove("PYTHONPATH");
    cmd.env_remove("PERLLIB");

    if let Ok(orig_xdg) =
        std::env::var("XDG_DATA_DIRS_ORIG").or_else(|_| std::env::var("ORIG_XDG_DATA_DIRS"))
        && !orig_xdg.trim().is_empty()
    {
        cmd.env("XDG_DATA_DIRS", orig_xdg);
    }

    if let Ok(home) = std::env::var("HOME")
        && !home.trim().is_empty()
    {
        cmd.current_dir(home);
    }
}

#[tauri::command]
pub async fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let clean_url = url.trim().to_string();
    if clean_url.is_empty() {
        return Err("URL is empty".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        // 1. Try DBus XDG Desktop Portal via gdbus or busctl
        let mut portal_gdbus = std::process::Command::new("gdbus");
        portal_gdbus.args([
            "call",
            "--session",
            "--dest",
            "org.freedesktop.portal.Desktop",
            "--object-path",
            "/org/freedesktop/portal/desktop",
            "--method",
            "org.freedesktop.portal.OpenURI.OpenURI",
            "",
            &clean_url,
            "{}",
        ]);
        configure_linux_command(&mut portal_gdbus);
        if let Ok(status) = portal_gdbus.status()
            && status.success()
        {
            return Ok(());
        }

        let mut portal_busctl = std::process::Command::new("busctl");
        portal_busctl.args([
            "call",
            "--user",
            "org.freedesktop.portal.Desktop",
            "/org/freedesktop/portal/desktop",
            "org.freedesktop.portal.OpenURI",
            "OpenURI",
            "ssa{sv}",
            "",
            &clean_url,
            "0",
        ]);
        configure_linux_command(&mut portal_busctl);
        if let Ok(status) = portal_busctl.status()
            && status.success()
        {
            return Ok(());
        }

        // 2. Try xdg-open with sanitized environment
        let mut xdg_cmd = std::process::Command::new("xdg-open");
        xdg_cmd.arg(&clean_url);
        configure_linux_command(&mut xdg_cmd);
        if let Ok(mut child) = xdg_cmd.spawn() {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            if let Ok(Some(status)) = child.try_wait() {
                if status.success() {
                    return Ok(());
                }
            } else {
                return Ok(());
            }
        }

        // 3. Try gio open with sanitized environment
        let mut gio_cmd = std::process::Command::new("gio");
        gio_cmd.args(["open", &clean_url]);
        configure_linux_command(&mut gio_cmd);
        if let Ok(mut child) = gio_cmd.spawn() {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            if let Ok(Some(status)) = child.try_wait() {
                if status.success() {
                    return Ok(());
                }
            } else {
                return Ok(());
            }
        }

        // 4. Try kde-open5 / kde-open / wslview
        for helper in &["kde-open5", "kde-open", "wslview"] {
            let mut cmd = std::process::Command::new(helper);
            cmd.arg(&clean_url);
            configure_linux_command(&mut cmd);
            if let Ok(mut child) = cmd.spawn() {
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                if let Ok(Some(status)) = child.try_wait() {
                    if status.success() {
                        return Ok(());
                    }
                } else {
                    return Ok(());
                }
            }
        }
    }

    // 5. Try Tauri Opener Plugin (uses native Windows ShellExecuteW / macOS NSWorkspace)
    use tauri_plugin_opener::OpenerExt;
    if app.opener().open_url(&clean_url, None::<&str>).is_ok() {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "start", "", &clean_url]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(mut child) = cmd.spawn() {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            if let Ok(Some(status)) = child.try_wait() {
                if status.success() {
                    return Ok(());
                }
            } else {
                return Ok(());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        cmd.arg(&clean_url);
        if let Ok(status) = cmd.status() {
            if status.success() {
                return Ok(());
            }
        }
    }

    Err("Failed to open URL".to_string())
}

#[tauri::command]
pub async fn open_external_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let clean_path = path.trim().to_string();
    if clean_path.is_empty() {
        return Err("Path is empty".to_string());
    }

    let target_path = PathBuf::from(&clean_path);
    if !target_path.exists() {
        let _ = std::fs::create_dir_all(&target_path);
    }

    let canonical = target_path
        .canonicalize()
        .unwrap_or_else(|_| target_path.clone());
    let raw_canonical_str = canonical.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    let canonical_str = raw_canonical_str
        .strip_prefix(r"\\?\")
        .unwrap_or(&raw_canonical_str)
        .to_string();
    #[cfg(not(target_os = "windows"))]
    let canonical_str = raw_canonical_str;

    #[cfg(target_os = "linux")]
    let file_uri = if canonical_str.starts_with('/') {
        format!("file://{canonical_str}")
    } else {
        format!("file:///{canonical_str}")
    };

    #[cfg(target_os = "linux")]
    {
        // 1. Try org.freedesktop.FileManager1 via gdbus / busctl
        let mut fm_gdbus = std::process::Command::new("gdbus");
        fm_gdbus.args([
            "call",
            "--session",
            "--dest",
            "org.freedesktop.FileManager1",
            "--object-path",
            "/org/freedesktop/FileManager1",
            "--method",
            "org.freedesktop.FileManager1.ShowFolders",
            &format!("['{file_uri}']"),
            "",
        ]);
        configure_linux_command(&mut fm_gdbus);
        if let Ok(status) = fm_gdbus.status()
            && status.success()
        {
            return Ok(());
        }

        let mut fm_busctl = std::process::Command::new("busctl");
        fm_busctl.args([
            "call",
            "--user",
            "org.freedesktop.FileManager1",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1",
            "ShowFolders",
            "ass",
            "1",
            &file_uri,
            "",
        ]);
        configure_linux_command(&mut fm_busctl);
        if let Ok(status) = fm_busctl.status()
            && status.success()
        {
            return Ok(());
        }

        // 2. Try xdg-open with sanitized environment
        let mut xdg_cmd = std::process::Command::new("xdg-open");
        xdg_cmd.arg(&canonical_str);
        configure_linux_command(&mut xdg_cmd);
        if let Ok(mut child) = xdg_cmd.spawn() {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            if let Ok(Some(status)) = child.try_wait() {
                if status.success() {
                    return Ok(());
                }
            } else {
                return Ok(());
            }
        }

        // 3. Try gio open with sanitized environment
        let mut gio_cmd = std::process::Command::new("gio");
        gio_cmd.args(["open", &canonical_str]);
        configure_linux_command(&mut gio_cmd);
        if let Ok(mut child) = gio_cmd.spawn() {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            if let Ok(Some(status)) = child.try_wait() {
                if status.success() {
                    return Ok(());
                }
            } else {
                return Ok(());
            }
        }

        // 4. Try common Linux file managers directly
        for fm in &["nautilus", "dolphin", "thunar", "nemo", "pcmanfm", "caja"] {
            let mut fm_cmd = std::process::Command::new(fm);
            fm_cmd.arg(&canonical_str);
            configure_linux_command(&mut fm_cmd);
            if let Ok(mut child) = fm_cmd.spawn() {
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                if let Ok(Some(status)) = child.try_wait() {
                    if status.success() {
                        return Ok(());
                    }
                } else {
                    return Ok(());
                }
            }
        }
    }

    // Try Tauri Opener Plugin (uses native Windows ShellExecuteW / macOS NSWorkspace)
    use tauri_plugin_opener::OpenerExt;
    if app.opener().open_path(&canonical_str, None::<&str>).is_ok() {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(&canonical_str);
        cmd.creation_flags(CREATE_NO_WINDOW);
        if cmd.spawn().is_ok() {
            return Ok(());
        }
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        cmd.arg(&canonical_str);
        if let Ok(status) = cmd.status() {
            if status.success() {
                return Ok(());
            }
        }
    }

    Err("Failed to open path".to_string())
}

#[tauri::command]
pub async fn open_fonts_folder(app: tauri::AppHandle) -> Result<(), String> {
    let fonts_dir = get_fonts_dir(&app)?;
    if !fonts_dir.exists() {
        let _ = std::fs::create_dir_all(&fonts_dir);
    }
    open_external_path(app, fonts_dir.to_string_lossy().to_string()).await
}

// ================= BOOK COVERS MANAGEMENT =================

pub fn get_covers_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base_dir = crate::get_app_base_dir(app)?;
    let covers_dir = base_dir.join("covers");
    if !covers_dir.exists() {
        std::fs::create_dir_all(&covers_dir)
            .map_err(|e| format!("Failed to create covers directory: {e}"))?;
    }
    Ok(covers_dir)
}

#[tauri::command]
pub async fn save_book_cover(
    app: tauri::AppHandle,
    book_id: String,
    base64_data: String,
) -> Result<String, String> {
    let clean_base64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(clean_base64.trim())
        .map_err(|e| format!("Failed to decode base64 cover data: {e}"))?;

    let covers_dir = get_covers_dir(&app)?;
    let file_name = format!("{}.jpg", sanitize_filename_part(&book_id));
    let target_path = covers_dir.join(&file_name);

    fs::write(&target_path, &bytes)
        .await
        .map_err(|e| format!("Failed to save cover file '{file_name}': {e}"))?;

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_book_cover_path(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<Option<String>, String> {
    let covers_dir = get_covers_dir(&app)?;
    let file_name = format!("{}.jpg", sanitize_filename_part(&book_id));
    let target_path = covers_dir.join(&file_name);

    if target_path.exists() && target_path.is_file() {
        Ok(Some(target_path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn delete_book_cover(app: tauri::AppHandle, book_id: String) -> Result<bool, String> {
    let covers_dir = get_covers_dir(&app)?;
    let file_name = format!("{}.jpg", sanitize_filename_part(&book_id));
    let target_path = covers_dir.join(&file_name);

    if target_path.exists() && target_path.is_file() {
        fs::remove_file(&target_path)
            .await
            .map_err(|e| format!("Failed to delete cover file '{file_name}': {e}"))?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn clear_covers_cache(app: tauri::AppHandle) -> Result<(), String> {
    let covers_dir = get_covers_dir(&app)?;
    if let Ok(mut entries) = fs::read_dir(&covers_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_file() {
                let _ = fs::remove_file(path).await;
            }
        }
    }
    Ok(())
}

// ================= APP SETTINGS MANAGEMENT =================

#[tauri::command]
pub async fn load_app_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let base_dir = crate::get_app_base_dir(&app)?;
    let settings_path = base_dir.join("settings.json");

    if settings_path.exists() && settings_path.is_file() {
        let content = fs::read_to_string(&settings_path)
            .await
            .map_err(|e| format!("Failed to read settings.json: {e}"))?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn save_app_settings(app: tauri::AppHandle, settings_json: String) -> Result<(), String> {
    let base_dir = crate::get_app_base_dir(&app)?;
    if !base_dir.exists() {
        fs::create_dir_all(&base_dir)
            .await
            .map_err(|e| format!("Failed to create app base dir: {e}"))?;
    }
    let settings_path = base_dir.join("settings.json");
    fs::write(&settings_path, settings_json.as_bytes())
        .await
        .map_err(|e| format!("Failed to write settings.json: {e}"))?;
    Ok(())
}
