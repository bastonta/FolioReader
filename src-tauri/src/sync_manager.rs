use crate::chapters_epub;
use crate::db::{self, DbAnnotation, DbBookmark, DbChapterCopy, DbPool, DbReadingSession};
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub success: bool,
    pub message: String,
    pub progress_synced: bool,
    pub bookmarks_synced: usize,
    pub annotations_synced: usize,
    pub sessions_synced: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullProgressResult {
    pub success: bool,
    pub message: String,
    pub location: Option<String>,
    pub progress_percent: Option<f32>,
    pub is_read: Option<bool>,
    pub updated_at: Option<String>,
}

// Server payload types
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerProgressResponse {
    pub location: Option<String>,
    pub progress_percent: Option<f32>,
    pub is_read: Option<bool>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerProgressPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_percent: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_read: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerBookmarkResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub book_id: Uuid,
    pub location: String,
    pub title: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerCreateBookmarkPayload {
    pub location: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerAnnotationResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub book_id: Uuid,
    pub location_start: String,
    pub location_end: String,
    pub selected_text: String,
    pub note: Option<String>,
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerCreateAnnotationPayload {
    pub location_start: String,
    pub location_end: String,
    pub selected_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerUpdateAnnotationPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerReadingSessionItem {
    pub client_session_id: String,
    pub book_id: Uuid,
    pub device_name: Option<String>,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: i32,
    pub start_progress: Option<f32>,
    pub end_progress: Option<f32>,
    pub pages_read: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerBatchSessionsPayload {
    pub sessions: Vec<ServerReadingSessionItem>,
}

fn build_headers(token: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Some(t) = token {
        let auth_val = if t.to_lowercase().starts_with("bearer ") {
            t.to_string()
        } else {
            format!("Bearer {t}")
        };
        if let Ok(hv) = HeaderValue::from_str(&auth_val) {
            headers.insert(AUTHORIZATION, hv);
        }
    }
    headers
}

#[derive(Default)]
pub struct SyncLock(pub tokio::sync::Mutex<()>);

impl SyncLock {
    pub fn new() -> Self {
        Self(tokio::sync::Mutex::new(()))
    }
}

async fn calculate_file_hash(file_path: &Path) -> Option<String> {
    let path = file_path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        use std::fs::File;
        use std::io::Read;
        let mut file = File::open(&path).ok()?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let n = file.read(&mut buffer).ok()?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        let result = hasher.finalize();
        Some(hex::encode(result))
    })
    .await
    .ok()
    .flatten()
}

pub async fn resolve_server_book_id(
    pool: &DbPool,
    client: &reqwest::Client,
    base_url: &str,
    headers: &HeaderMap,
    book_id: &str,
) -> Option<String> {
    // 1. If it's already a valid UUID
    if Uuid::parse_str(book_id).is_ok() {
        return Some(book_id.to_string());
    }

    // 2. Check local database mappings
    if let Ok(Some(server_id)) = db::get_server_book_id(pool, book_id).await {
        return Some(server_id);
    }

    // 3. Check if file path is stored or can be found
    let file_path_opt = db::get_file_path_for_book(pool, book_id)
        .await
        .ok()
        .flatten();
    if let Some(fp) = file_path_opt {
        let p = Path::new(&fp);
        if p.exists()
            && p.is_file()
            && let Some(hash) = calculate_file_hash(p).await
        {
            let url = format!("{base_url}/api/books/by-hash/{hash}");
            if let Ok(res) = client.get(&url).headers(headers.clone()).send().await
                && res.status().is_success()
                && let Ok(val) = res.json::<serde_json::Value>().await
                && let Some(id_str) = val.get("id").and_then(|v| v.as_str())
            {
                let _ = db::save_book_mapping(pool, book_id, id_str, Some(&fp)).await;
                return Some(id_str.to_string());
            }
        }
    }

    None
}

pub async fn sync_book(
    pool: &DbPool,
    client: &reqwest::Client,
    server_url: &str,
    token: Option<&str>,
    book_id: &str,
) -> Result<SyncResult, String> {
    let base = server_url.trim_end_matches('/');
    if base.is_empty() {
        return Err("Server URL is empty".to_string());
    }

    let headers = build_headers(token);

    // Resolve real server Folio UUID
    let server_id = match resolve_server_book_id(pool, client, base, &headers, book_id).await {
        Some(id) => id,
        None => {
            // Mark pending records as 'local_only' to prevent infinite sync loop for books not on server
            let _ = sqlx::query(
                "UPDATE book_progress SET sync_status = 'local_only' WHERE book_id = ? AND sync_status = 'pending'",
            )
            .bind(book_id)
            .execute(pool)
            .await;

            let _ = sqlx::query(
                "UPDATE bookmarks SET sync_status = 'local_only' WHERE book_id = ? AND sync_status LIKE 'pending%'",
            )
            .bind(book_id)
            .execute(pool)
            .await;

            let _ = sqlx::query(
                "UPDATE annotations SET sync_status = 'local_only' WHERE book_id = ? AND sync_status LIKE 'pending%'",
            )
            .bind(book_id)
            .execute(pool)
            .await;

            let _ = sqlx::query(
                "UPDATE reading_sessions SET sync_status = 'local_only' WHERE book_id = ? AND sync_status = 'pending'",
            )
            .bind(book_id)
            .execute(pool)
            .await;

            return Ok(SyncResult {
                success: false,
                message: format!(
                    "Book '{book_id}' is not linked to any server Folio ID. Skipping sync."
                ),
                progress_synced: false,
                bookmarks_synced: 0,
                annotations_synced: 0,
                sessions_synced: 0,
            });
        }
    };

    if is_book_read_from_copies(pool, book_id).await {
        return Ok(SyncResult {
            success: false,
            message: "This book is read from local copies built from its chapters; each copy syncs on its own.".to_string(),
            progress_synced: false,
            bookmarks_synced: 0,
            annotations_synced: 0,
            sessions_synced: 0,
        });
    }
    let copy = chapter_copy(pool, book_id).await;
    let copy = copy.as_ref();

    let progress_synced = sync_progress(pool, client, base, &headers, book_id, &server_id, copy)
        .await
        .unwrap_or(false);
    let bookmarks_synced = sync_bookmarks(pool, client, base, &headers, book_id, &server_id, copy)
        .await
        .unwrap_or(0);
    let annotations_synced =
        sync_annotations(pool, client, base, &headers, book_id, &server_id, copy)
            .await
            .unwrap_or(0);
    let sessions_synced = sync_reading_sessions(
        pool,
        client,
        base,
        &headers,
        Some(book_id),
        Some(&server_id),
    )
    .await
    .unwrap_or(0);

    Ok(SyncResult {
        success: true,
        message: "Book sync completed successfully".to_string(),
        progress_synced,
        bookmarks_synced,
        annotations_synced,
        sessions_synced,
    })
}

// ---------------- CHAPTERS BOOKS ----------------
// A book assembled on device from server chapters has no file on the server, so its
// reading position is exchanged the way the web reader stores it: `ch:<chapterId>`.
// Locally the position is a CFI of the EPUB built by `chapters_book`.
//
// One server book may have several such copies on a device: the whole book and single
// volumes, each a file of its own. Everything below is therefore resolved per copy (the
// local id of the file), and a volume copy translates between its own scale and the
// whole book: percentages, the read flag and the spine index of bookmarks and annotations.

/// The copy a local book id stands for; `None` for a book downloaded as a file.
async fn chapter_copy(pool: &DbPool, local_book_id: &str) -> Option<DbChapterCopy> {
    db::get_chapter_copy(pool, local_book_id)
        .await
        .ok()
        .flatten()
}

/// `true` when `book_id` is the server id of a book that is read from local copies. Such
/// a book has no reading state of its own on this device: every copy syncs separately.
async fn is_book_read_from_copies(pool: &DbPool, book_id: &str) -> bool {
    Uuid::parse_str(book_id).is_ok() && db::has_chapter_copies(pool, book_id).await.unwrap_or(false)
}

fn volume_copy(copy: Option<&DbChapterCopy>) -> Option<&DbChapterCopy> {
    copy.filter(|c| c.volume.is_some())
}

/// The second id rows of the book may be stored under: the server id for a book downloaded
/// as a file, nothing but the local id for a copy built from chapters.
fn row_alias<'a>(
    copy: Option<&DbChapterCopy>,
    local_book_id: &'a str,
    server_book_id: &'a str,
) -> &'a str {
    if copy.is_some() {
        local_book_id
    } else {
        server_book_id
    }
}

/// Location to send to the server for a local reading position. `None` when it cannot be
/// expressed for the server (then only the percentage is pushed).
async fn outgoing_location(
    pool: &DbPool,
    copy: Option<&DbChapterCopy>,
    location: &str,
) -> Option<String> {
    let Some(copy) = copy else {
        return Some(location.to_string());
    };
    let position = chapters_epub::cfi_spine_index(location)?;
    let chapter_id = db::get_chapter_id_at(pool, &copy.local_id, position)
        .await
        .ok()
        .flatten()?;
    Some(format!("ch:{chapter_id}"))
}

/// Server reading position translated for the local copy of the book.
#[derive(Debug, PartialEq)]
enum RemoteLocation {
    /// A position the local copy can open.
    At(String),
    /// The chapter the reader is already in: the local position is more precise and stays.
    SameChapter,
    /// A chapter the local copy does not have (yet, or it belongs to another volume), or
    /// a position of another edition.
    Unknown,
}

async fn incoming_location(
    pool: &DbPool,
    copy: Option<&DbChapterCopy>,
    remote: String,
    local_location: Option<&str>,
) -> RemoteLocation {
    let Some(copy) = copy else {
        return RemoteLocation::At(remote);
    };
    let Some(chapter_id) = remote.strip_prefix("ch:") else {
        return RemoteLocation::Unknown;
    };
    let Some(position) = db::get_chapter_position(pool, &copy.local_id, chapter_id)
        .await
        .ok()
        .flatten()
    else {
        return RemoteLocation::Unknown;
    };
    if local_location.and_then(chapters_epub::cfi_spine_index) == Some(position) {
        RemoteLocation::SameChapter
    } else {
        RemoteLocation::At(chapters_epub::chapter_start_cfi(position))
    }
}

/// Local reading percentage -> the scale the server keeps (the whole book).
fn outgoing_percent(copy: Option<&DbChapterCopy>, percent: f32) -> f32 {
    copy.map_or(percent, |c| c.to_book_percent(percent))
}

/// Server reading percentage -> the scale of the local copy.
fn incoming_percent(copy: Option<&DbChapterCopy>, percent: f32) -> f32 {
    copy.map_or(percent, |c| c.to_copy_percent(percent))
}

/// Read flag to send to the server; `None` leaves the server flag as it is. Finishing a
/// volume does not finish the book, and a volume copy never clears a flag set elsewhere.
fn outgoing_is_read(copy: Option<&DbChapterCopy>, is_read: bool) -> Option<bool> {
    match volume_copy(copy) {
        Some(volume) => (is_read && volume.ends_book()).then_some(true),
        None => Some(is_read),
    }
}

/// Read flag to store locally for a server flag: a book that is read includes this volume;
/// a book that is not may still have this volume finished.
fn incoming_is_read(copy: Option<&DbChapterCopy>, remote: bool, local: bool) -> bool {
    match volume_copy(copy) {
        Some(_) => remote || local,
        None => remote,
    }
}

/// Location of a bookmark or annotation as the server keeps it: by spine index of the
/// whole book. `None` when a volume copy cannot express it (not a spine CFI).
fn outgoing_item_location(copy: Option<&DbChapterCopy>, location: &str) -> Option<String> {
    match volume_copy(copy) {
        Some(volume) => chapters_epub::shift_cfi_spine(location, volume.spine_offset() as i64),
        None => Some(location.to_string()),
    }
}

/// Server location of a bookmark or annotation translated for the local copy. `None` when
/// the item belongs to a part of the book a volume copy does not hold.
fn incoming_item_location(copy: Option<&DbChapterCopy>, location: &str) -> Option<String> {
    let Some(volume) = volume_copy(copy) else {
        return Some(location.to_string());
    };
    let offset = volume.spine_offset();
    let chapters = usize::try_from(volume.chapters_count).unwrap_or(0);
    let spine = chapters_epub::cfi_spine_index(location)?;
    if spine < offset || spine >= offset + chapters {
        return None;
    }
    chapters_epub::shift_cfi_spine(location, -(offset as i64))
}

// ---------------- PROGRESS SYNC ----------------
pub async fn pull_book_progress(
    pool: &DbPool,
    client: &reqwest::Client,
    server_url: &str,
    token: Option<&str>,
    book_id: &str,
) -> Result<PullProgressResult, String> {
    let base = server_url.trim_end_matches('/');
    if base.is_empty() {
        return Err("Server URL is empty".to_string());
    }

    let headers = build_headers(token);

    // Resolve real server Folio UUID
    let server_id = match resolve_server_book_id(pool, client, base, &headers, book_id).await {
        Some(id) => id,
        None => {
            return Ok(PullProgressResult {
                success: false,
                message: format!("Book '{book_id}' is not linked to any server Folio ID."),
                location: None,
                progress_percent: None,
                is_read: None,
                updated_at: None,
            });
        }
    };

    if is_book_read_from_copies(pool, book_id).await {
        return Ok(PullProgressResult {
            success: false,
            message: "This book is read from local copies built from its chapters; open one of them to sync.".to_string(),
            location: None,
            progress_percent: None,
            is_read: None,
            updated_at: None,
        });
    }
    let copy = chapter_copy(pool, book_id).await;
    let copy = copy.as_ref();

    let url = format!("{base}/api/books/{server_id}/progress?format=cfi");
    let res = client
        .get(&url)
        .headers(headers.clone())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch server progress: {e}"))?;

    if res.status().is_success() {
        if let Ok(remote) = res.json::<ServerProgressResponse>().await
            && let Some(loc) = remote.location
        {
            // The server percentage is in the scale of the whole book, local ones in the
            // scale of the file
            let remote_book_percent = remote.progress_percent.unwrap_or(0.0);
            let remote_percent = incoming_percent(copy, remote_book_percent);

            let current_local = db::get_progress(pool, book_id).await.ok().flatten();
            let local_is_pending = current_local
                .as_ref()
                .map(|p| p.sync_status == "pending")
                .unwrap_or(false);
            let local_percent = current_local
                .as_ref()
                .map(|p| p.progress_percent)
                .unwrap_or(0.0);
            let is_read = incoming_is_read(
                copy,
                remote.is_read.unwrap_or(false),
                current_local.as_ref().is_some_and(|p| p.is_read),
            );
            let incoming = incoming_location(
                pool,
                copy,
                loc,
                current_local.as_ref().map(|p| p.location.as_str()),
            )
            .await;
            // "Further ahead" only means something inside one file: a volume that was read
            // earlier must not take the server position away from the volume being read now
            let local_is_ahead = outgoing_percent(copy, local_percent) > remote_book_percent
                && local_percent > 0.0
                && !(volume_copy(copy).is_some() && incoming == RemoteLocation::Unknown);

            // If local progress is pending or further ahead, preserve local and push it to the server
            if (local_is_pending || local_is_ahead)
                && let Some(local_p) = current_local
            {
                // Push local to server
                let put_url = format!("{base}/api/books/{server_id}/progress?format=cfi");
                let payload = ServerProgressPayload {
                    location: outgoing_location(pool, copy, &local_p.location).await,
                    progress_percent: Some(outgoing_percent(copy, local_p.progress_percent)),
                    is_read: outgoing_is_read(copy, local_p.is_read),
                };
                let put_res = client
                    .put(&put_url)
                    .headers(headers.clone())
                    .json(&payload)
                    .send()
                    .await;

                if let Ok(r) = put_res
                    && r.status().is_success()
                {
                    let _ = sqlx::query("UPDATE book_progress SET sync_status = 'synced' WHERE book_id = ? OR book_id = ?")
                                    .bind(book_id)
                                    .bind(row_alias(copy, book_id, &server_id))
                                    .execute(pool)
                                    .await;
                }

                return Ok(PullProgressResult {
                    success: true,
                    message: "Local progress preserved and synced with server".to_string(),
                    location: Some(local_p.location),
                    progress_percent: Some(local_p.progress_percent),
                    is_read: Some(local_p.is_read),
                    updated_at: Some(local_p.updated_at),
                });
            }

            let loc = match incoming {
                RemoteLocation::At(loc) => loc,
                RemoteLocation::SameChapter => {
                    return Ok(PullProgressResult {
                        success: true,
                        message: "Reading position is up to date".to_string(),
                        location: None,
                        progress_percent: None,
                        is_read: None,
                        updated_at: None,
                    });
                }
                RemoteLocation::Unknown => {
                    let message = if volume_copy(copy).is_some() {
                        "Server progress is in another volume of this book (or in a chapter this copy does not have yet)."
                    } else {
                        "Server progress is in a chapter this copy does not have yet. Update the book from the catalog."
                    };
                    return Ok(PullProgressResult {
                        success: false,
                        message: message.to_string(),
                        location: None,
                        progress_percent: None,
                        is_read: None,
                        updated_at: None,
                    });
                }
            };

            // Force save to local SQLite database with sync_status = 'synced'
            let _ = db::save_progress(pool, book_id, &loc, remote_percent, is_read, false).await;
            // A copy built from chapters keeps its state under its own id only
            if copy.is_none() && server_id != book_id {
                let _ =
                    db::save_progress(pool, &server_id, &loc, remote_percent, is_read, false).await;
            }

            return Ok(PullProgressResult {
                success: true,
                message: "Progress successfully fetched from server".to_string(),
                location: Some(loc),
                progress_percent: Some(remote_percent),
                is_read: Some(is_read),
                updated_at: remote.updated_at,
            });
        }
        Ok(PullProgressResult {
            success: false,
            message: "No reading progress recorded on server for this book".to_string(),
            location: None,
            progress_percent: None,
            is_read: None,
            updated_at: None,
        })
    } else if res.status().as_u16() == 404 {
        Ok(PullProgressResult {
            success: false,
            message: "No progress found on server".to_string(),
            location: None,
            progress_percent: None,
            is_read: None,
            updated_at: None,
        })
    } else {
        Err(format!("Server returned error status {}", res.status()))
    }
}

async fn sync_progress(
    pool: &DbPool,
    client: &reqwest::Client,
    base_url: &str,
    headers: &HeaderMap,
    local_book_id: &str,
    server_book_id: &str,
    copy: Option<&DbChapterCopy>,
) -> Result<bool, String> {
    let local = db::get_progress(pool, local_book_id)
        .await
        .map_err(|e| e.to_string())?;

    // 1. Push if pending and not just unread 0%
    if let Some(p) = &local
        && p.sync_status == "pending"
    {
        let url = format!("{base_url}/api/books/{server_book_id}/progress?format=cfi");
        let payload = ServerProgressPayload {
            location: outgoing_location(pool, copy, &p.location).await,
            progress_percent: Some(outgoing_percent(copy, p.progress_percent)),
            is_read: outgoing_is_read(copy, p.is_read),
        };

        let res = client
            .put(&url)
            .headers(headers.clone())
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Failed to push progress: {e}"))?;

        if res.status().is_success() {
            let _ = sqlx::query(
                "UPDATE book_progress SET sync_status = 'synced' WHERE book_id = ? OR book_id = ?",
            )
            .bind(local_book_id)
            .bind(row_alias(copy, local_book_id, server_book_id))
            .execute(pool)
            .await;
        }
    }

    // 2. Pull remote
    let url = format!("{base_url}/api/books/{server_book_id}/progress?format=cfi");
    let res = client.get(&url).headers(headers.clone()).send().await;

    if let Ok(r) = res
        && r.status().is_success()
        && let Ok(remote) = r.json::<ServerProgressResponse>().await
        && let Some(loc) = remote.location
    {
        let current_local = db::get_progress(pool, local_book_id).await.ok().flatten();
        let is_pending = current_local
            .as_ref()
            .map(|p| p.sync_status == "pending")
            .unwrap_or(false);
        // If not pending, or if local is at 0% while remote is further ahead, update local
        let local_percent = current_local
            .as_ref()
            .map(|p| p.progress_percent)
            .unwrap_or(0.0);
        // In the scale of the local file
        let remote_percent = incoming_percent(copy, remote.progress_percent.unwrap_or(0.0));
        let is_read = incoming_is_read(
            copy,
            remote.is_read.unwrap_or(false),
            current_local.as_ref().is_some_and(|p| p.is_read),
        );
        let incoming = incoming_location(
            pool,
            copy,
            loc,
            current_local.as_ref().map(|p| p.location.as_str()),
        )
        .await;
        // A position the local copy cannot open (or is already at) leaves local progress alone
        if let RemoteLocation::At(loc) = incoming
            && (!is_pending || (local_percent <= 0.01 && remote_percent > 0.0))
        {
            let _ =
                db::save_progress(pool, local_book_id, &loc, remote_percent, is_read, false).await;
            // A copy built from chapters keeps its state under its own id only
            if copy.is_none() && server_book_id != local_book_id {
                let _ =
                    db::save_progress(pool, server_book_id, &loc, remote_percent, is_read, false)
                        .await;
            }
        }
        return Ok(true);
    }

    Ok(false)
}

// ---------------- BOOKMARKS SYNC ----------------
async fn sync_bookmarks(
    pool: &DbPool,
    client: &reqwest::Client,
    base_url: &str,
    headers: &HeaderMap,
    local_book_id: &str,
    server_book_id: &str,
    copy: Option<&DbChapterCopy>,
) -> Result<usize, String> {
    let mut count = 0;
    // Rows of a copy built from chapters live under its local id only (other copies of
    // the same server book hold the same server bookmarks in their own coordinates)
    let row_alias = row_alias(copy, local_book_id, server_book_id);

    // 1. Push deleted
    let pending_deleted = sqlx::query_as::<_, DbBookmark>(
        "SELECT id, server_id, book_id, location, fraction, location_label, chapter_title, created_at, is_deleted != 0 AS is_deleted, sync_status FROM bookmarks WHERE (book_id = ? OR book_id = ?) AND sync_status = 'pending_delete' AND server_id IS NOT NULL",
    )
    .bind(local_book_id)
    .bind(row_alias)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for bm in pending_deleted {
        if let Some(server_id) = &bm.server_id {
            let url = format!("{base_url}/api/books/{server_book_id}/bookmarks/{server_id}");
            let res = client.delete(&url).headers(headers.clone()).send().await;
            if let Ok(r) = res
                && (r.status().is_success() || r.status().as_u16() == 404)
            {
                let _ = sqlx::query("DELETE FROM bookmarks WHERE id = ?")
                    .bind(&bm.id)
                    .execute(pool)
                    .await;
                count += 1;
            }
        }
    }

    // 2. Push created
    let pending_created = sqlx::query_as::<_, DbBookmark>(
        "SELECT id, server_id, book_id, location, fraction, location_label, chapter_title, created_at, is_deleted != 0 AS is_deleted, sync_status FROM bookmarks WHERE (book_id = ? OR book_id = ?) AND sync_status = 'pending_create' AND is_deleted = 0",
    )
    .bind(local_book_id)
    .bind(row_alias)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut pushed_server_ids = std::collections::HashSet::new();
    for bm in pending_created {
        // The server addresses the whole book; a location a volume copy cannot translate
        // stays local
        let Some(location) = outgoing_item_location(copy, &bm.location) else {
            continue;
        };
        let url = format!("{base_url}/api/books/{server_book_id}/bookmarks?format=cfi");
        let payload = ServerCreateBookmarkPayload {
            location,
            title: bm.chapter_title.clone().or(bm.location_label.clone()),
        };

        let res = client
            .post(&url)
            .headers(headers.clone())
            .json(&payload)
            .send()
            .await;
        if let Ok(r) = res
            && r.status().is_success()
            && let Ok(created) = r.json::<ServerBookmarkResponse>().await
        {
            let created_id_str = created.id.to_string();
            pushed_server_ids.insert(created_id_str.clone());
            let _ = sqlx::query(
                "UPDATE bookmarks SET server_id = ?, sync_status = 'synced' WHERE id = ?",
            )
            .bind(created_id_str)
            .bind(&bm.id)
            .execute(pool)
            .await;
            count += 1;
        }
    }

    // 3. Pull remote
    let url = format!("{base_url}/api/books/{server_book_id}/bookmarks?format=cfi");
    let res = client.get(&url).headers(headers.clone()).send().await;

    if let Ok(r) = res
        && r.status().is_success()
        && let Ok(remote_bookmarks) = r.json::<Vec<ServerBookmarkResponse>>().await
    {
        let mut remote_ids: std::collections::HashSet<String> =
            remote_bookmarks.iter().map(|b| b.id.to_string()).collect();
        remote_ids.extend(pushed_server_ids);

        for rbm in &remote_bookmarks {
            let server_id_str = rbm.id.to_string();
            // A bookmark in a part of the book this volume copy does not hold belongs to
            // other copies: it is neither stored here nor treated as deleted
            let Some(location) = incoming_item_location(copy, &rbm.location) else {
                continue;
            };
            let existing = if copy.is_some() {
                sqlx::query_as::<_, DbBookmark>(
                    "SELECT id, server_id, book_id, location, fraction, location_label, chapter_title, created_at, is_deleted != 0 AS is_deleted, sync_status FROM bookmarks WHERE book_id = ? AND (server_id = ? OR location = ?)",
                )
                .bind(local_book_id)
                .bind(&server_id_str)
                .bind(&location)
                .fetch_optional(pool)
                .await
                .unwrap_or(None)
            } else {
                sqlx::query_as::<_, DbBookmark>(
                    "SELECT id, server_id, book_id, location, fraction, location_label, chapter_title, created_at, is_deleted != 0 AS is_deleted, sync_status FROM bookmarks WHERE server_id = ? OR (location = ? AND (book_id = ? OR book_id = ?))",
                )
                .bind(&server_id_str)
                .bind(&location)
                .bind(local_book_id)
                .bind(server_book_id)
                .fetch_optional(pool)
                .await
                .unwrap_or(None)
            };

            match existing {
                Some(loc_bm) => {
                    if loc_bm.sync_status != "pending_create"
                        && loc_bm.sync_status != "pending_delete"
                    {
                        let _ = sqlx::query(
                                    "UPDATE bookmarks SET server_id = ?, location = ?, chapter_title = ?, is_deleted = 0, sync_status = 'synced' WHERE id = ?",
                                )
                                .bind(&server_id_str)
                                .bind(&location)
                                .bind(&rbm.title)
                                .bind(&loc_bm.id)
                                .execute(pool)
                                .await;
                    }
                }
                None => {
                    let new_id = format!("bm-{}", Uuid::now_v7());
                    let _ = db::save_bookmark(
                        pool,
                        &new_id,
                        Some(&server_id_str),
                        local_book_id,
                        &location,
                        0.0,
                        None,
                        rbm.title.as_deref(),
                        Some(&rbm.created_at),
                        false,
                    )
                    .await;
                    count += 1;
                }
            }
        }

        // Delete local bookmarks that were synced with server but are no longer present on server
        let local_synced = sqlx::query_as::<_, DbBookmark>(
            "SELECT id, server_id, book_id, location, fraction, location_label, chapter_title, created_at, is_deleted != 0 AS is_deleted, sync_status FROM bookmarks WHERE (book_id = ? OR book_id = ?) AND sync_status = 'synced' AND server_id IS NOT NULL",
        )
        .bind(local_book_id)
        .bind(row_alias)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        for bm in local_synced {
            if let Some(ref sid) = bm.server_id
                && !remote_ids.contains(sid)
            {
                let _ = sqlx::query("DELETE FROM bookmarks WHERE id = ?")
                    .bind(&bm.id)
                    .execute(pool)
                    .await;
                count += 1;
            }
        }
    }

    Ok(count)
}

// ---------------- ANNOTATIONS SYNC ----------------
fn normalize_annotation_color(color: Option<&str>) -> Option<String> {
    let c = color?.trim().to_lowercase();
    match c.as_str() {
        "yellow" | "#eab308" => Some("yellow".to_string()),
        "gray" | "grey" | "#64748b" => Some("gray".to_string()),
        "blue" | "#3b82f6" => Some("blue".to_string()),
        "red" | "#ef4444" => Some("red".to_string()),
        "green" | "#22c55e" => Some("green".to_string()),
        "olive" | "#84cc16" => Some("olive".to_string()),
        "orange" | "#f97316" => Some("orange".to_string()),
        "purple" | "#a855f7" => Some("purple".to_string()),
        other => {
            if other.is_empty() || other.starts_with('#') {
                Some("yellow".to_string())
            } else {
                Some(other.to_string())
            }
        }
    }
}

async fn sync_annotations(
    pool: &DbPool,
    client: &reqwest::Client,
    base_url: &str,
    headers: &HeaderMap,
    local_book_id: &str,
    server_book_id: &str,
    copy: Option<&DbChapterCopy>,
) -> Result<usize, String> {
    let mut count = 0;
    // See `sync_bookmarks`
    let row_alias = row_alias(copy, local_book_id, server_book_id);

    // 1. Push deleted
    let pending_deleted = sqlx::query_as::<_, DbAnnotation>(
        "SELECT id, server_id, book_id, location_start, location_end, value, selected_text, note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted != 0 AS is_deleted, sync_status FROM annotations WHERE (book_id = ? OR book_id = ?) AND sync_status = 'pending_delete' AND server_id IS NOT NULL",
    )
    .bind(local_book_id)
    .bind(row_alias)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for ann in pending_deleted {
        if let Some(server_id) = &ann.server_id {
            let url = format!("{base_url}/api/books/{server_book_id}/annotations/{server_id}");
            let res = client.delete(&url).headers(headers.clone()).send().await;
            if let Ok(r) = res
                && (r.status().is_success() || r.status().as_u16() == 404)
            {
                let _ = sqlx::query("DELETE FROM annotations WHERE id = ?")
                    .bind(&ann.id)
                    .execute(pool)
                    .await;
                count += 1;
            }
        }
    }

    // 2. Push created
    let pending_created = sqlx::query_as::<_, DbAnnotation>(
        "SELECT id, server_id, book_id, location_start, location_end, value, selected_text, note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted != 0 AS is_deleted, sync_status FROM annotations WHERE (book_id = ? OR book_id = ?) AND sync_status = 'pending_create' AND is_deleted = 0",
    )
    .bind(local_book_id)
    .bind(row_alias)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut pushed_server_ids = std::collections::HashSet::new();
    for ann in pending_created {
        let url = format!("{base_url}/api/books/{server_book_id}/annotations?format=cfi");
        let location_start = if ann.location_start.is_empty() {
            &ann.value
        } else {
            &ann.location_start
        };
        let location_end = if ann.location_end.is_empty() {
            &ann.value
        } else {
            &ann.location_end
        };
        // The server addresses the whole book; a location a volume copy cannot translate
        // stays local
        let (Some(location_start), Some(location_end)) = (
            outgoing_item_location(copy, location_start),
            outgoing_item_location(copy, location_end),
        ) else {
            continue;
        };
        let payload = ServerCreateAnnotationPayload {
            location_start,
            location_end,
            selected_text: ann.selected_text.clone(),
            note: ann.note.clone(),
            color: normalize_annotation_color(Some(&ann.color)),
        };

        let res = client
            .post(&url)
            .headers(headers.clone())
            .json(&payload)
            .send()
            .await;
        if let Ok(r) = res
            && r.status().is_success()
            && let Ok(created) = r.json::<ServerAnnotationResponse>().await
        {
            let created_id_str = created.id.to_string();
            pushed_server_ids.insert(created_id_str.clone());
            let _ = sqlx::query(
                "UPDATE annotations SET server_id = ?, sync_status = 'synced' WHERE id = ?",
            )
            .bind(created_id_str)
            .bind(&ann.id)
            .execute(pool)
            .await;
            count += 1;
        }
    }

    // 3. Push updated
    let pending_updated = sqlx::query_as::<_, DbAnnotation>(
        "SELECT id, server_id, book_id, location_start, location_end, value, selected_text, note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted != 0 AS is_deleted, sync_status FROM annotations WHERE (book_id = ? OR book_id = ?) AND sync_status = 'pending_update' AND is_deleted = 0 AND server_id IS NOT NULL",
    )
    .bind(local_book_id)
    .bind(row_alias)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for ann in pending_updated {
        if let Some(server_id) = &ann.server_id {
            let url =
                format!("{base_url}/api/books/{server_book_id}/annotations/{server_id}?format=cfi");
            let payload = ServerUpdateAnnotationPayload {
                note: ann.note.clone(),
                color: normalize_annotation_color(Some(&ann.color)),
            };

            let res = client
                .put(&url)
                .headers(headers.clone())
                .json(&payload)
                .send()
                .await;
            if let Ok(r) = res
                && r.status().is_success()
            {
                let _ = sqlx::query("UPDATE annotations SET sync_status = 'synced' WHERE id = ?")
                    .bind(&ann.id)
                    .execute(pool)
                    .await;
                count += 1;
            }
        }
    }

    // 4. Pull remote
    let url = format!("{base_url}/api/books/{server_book_id}/annotations?format=cfi");
    let res = client.get(&url).headers(headers.clone()).send().await;

    if let Ok(r) = res
        && r.status().is_success()
        && let Ok(remote_annotations) = r.json::<Vec<ServerAnnotationResponse>>().await
    {
        let mut remote_ids: std::collections::HashSet<String> = remote_annotations
            .iter()
            .map(|a| a.id.to_string())
            .collect();
        remote_ids.extend(pushed_server_ids);

        for rann in &remote_annotations {
            let server_id_str = rann.id.to_string();
            // An annotation in a part of the book this volume copy does not hold belongs
            // to other copies: it is neither stored here nor treated as deleted
            let Some(location_start) = incoming_item_location(copy, &rann.location_start) else {
                continue;
            };
            let location_end = incoming_item_location(copy, &rann.location_end)
                .unwrap_or_else(|| location_start.clone());
            let existing = if copy.is_some() {
                sqlx::query_as::<_, DbAnnotation>(
                    "SELECT id, server_id, book_id, location_start, location_end, value, selected_text, note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted != 0 AS is_deleted, sync_status FROM annotations WHERE book_id = ? AND (server_id = ? OR location_start = ?)",
                )
                .bind(local_book_id)
                .bind(&server_id_str)
                .bind(&location_start)
                .fetch_optional(pool)
                .await
                .unwrap_or(None)
            } else {
                sqlx::query_as::<_, DbAnnotation>(
                    "SELECT id, server_id, book_id, location_start, location_end, value, selected_text, note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted != 0 AS is_deleted, sync_status FROM annotations WHERE server_id = ? OR (location_start = ? AND (book_id = ? OR book_id = ?))",
                )
                .bind(&server_id_str)
                .bind(&location_start)
                .bind(local_book_id)
                .bind(server_book_id)
                .fetch_optional(pool)
                .await
                .unwrap_or(None)
            };

            match existing {
                Some(loc_ann) => {
                    if loc_ann.sync_status != "pending_create"
                        && loc_ann.sync_status != "pending_delete"
                        && loc_ann.sync_status != "pending_update"
                    {
                        let normalized_color = normalize_annotation_color(rann.color.as_deref());
                        let _ = sqlx::query(
                            r#"
                                    UPDATE annotations SET
                                        server_id = ?,
                                        location_start = ?,
                                        location_end = ?,
                                        selected_text = ?,
                                        note = ?,
                                        color = COALESCE(?, color),
                                        updated_at = ?,
                                        is_deleted = 0,
                                        sync_status = 'synced'
                                    WHERE id = ?
                                    "#,
                        )
                        .bind(&server_id_str)
                        .bind(&location_start)
                        .bind(&location_end)
                        .bind(&rann.selected_text)
                        .bind(&rann.note)
                        .bind(&normalized_color)
                        .bind(&rann.updated_at)
                        .bind(&loc_ann.id)
                        .execute(pool)
                        .await;
                    }
                }
                None => {
                    let new_id = format!("ann-{}", Uuid::now_v7());
                    let val = if !location_start.is_empty() {
                        location_start.clone()
                    } else {
                        location_end.clone()
                    };
                    let color = normalize_annotation_color(rann.color.as_deref())
                        .unwrap_or_else(|| "yellow".to_string());

                    let _ = db::save_annotation(
                        pool,
                        &new_id,
                        Some(&server_id_str),
                        local_book_id,
                        &location_start,
                        &location_end,
                        &val,
                        &rann.selected_text,
                        rann.note.as_deref(),
                        &color,
                        Some("highlight"),
                        None,
                        None,
                        Some(&rann.created_at),
                        false,
                    )
                    .await;
                    count += 1;
                }
            }
        }

        // Delete local annotations that were synced with server but are no longer present on server
        let local_synced = sqlx::query_as::<_, DbAnnotation>(
            "SELECT id, server_id, book_id, location_start, location_end, value, selected_text, note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted != 0 AS is_deleted, sync_status FROM annotations WHERE (book_id = ? OR book_id = ?) AND sync_status = 'synced' AND server_id IS NOT NULL",
        )
        .bind(local_book_id)
        .bind(row_alias)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        for ann in local_synced {
            if let Some(ref sid) = ann.server_id
                && !remote_ids.contains(sid)
            {
                let _ = sqlx::query("DELETE FROM annotations WHERE id = ?")
                    .bind(&ann.id)
                    .execute(pool)
                    .await;
                count += 1;
            }
        }
    }

    Ok(count)
}

// ---------------- READING SESSIONS SYNC ----------------
pub async fn sync_reading_sessions(
    pool: &DbPool,
    client: &reqwest::Client,
    base_url: &str,
    headers: &HeaderMap,
    local_book_id: Option<&str>,
    server_book_id: Option<&str>,
) -> Result<usize, String> {
    let pending = if let Some(local_id) = local_book_id {
        let s_id = server_book_id.unwrap_or(local_id);
        sqlx::query_as::<_, DbReadingSession>(
            "SELECT * FROM reading_sessions WHERE (book_id = ? OR book_id = ?) AND sync_status = 'pending' LIMIT 100",
        )
        .bind(local_id)
        .bind(s_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    } else {
        db::get_pending_reading_sessions(pool, 100)
            .await
            .unwrap_or_default()
    };

    if pending.is_empty() {
        return Ok(0);
    }

    let mut payload_items = Vec::new();
    let mut session_ids = Vec::new();

    for s in &pending {
        // Resolve target server book id
        let target_book_id_uuid = if let Ok(uuid) = Uuid::parse_str(&s.book_id) {
            uuid
        } else if let Some(mapped) = db::get_server_book_id(pool, &s.book_id)
            .await
            .ok()
            .flatten()
        {
            if let Ok(uuid) = Uuid::parse_str(&mapped) {
                uuid
            } else {
                continue;
            }
        } else if let Some(srv_id) = server_book_id {
            if let Ok(uuid) = Uuid::parse_str(srv_id) {
                uuid
            } else {
                continue;
            }
        } else {
            continue;
        };

        // Session bounds are percentages of the file that was read; the server keeps them
        // in the scale of the whole book
        let copy = chapter_copy(pool, &s.book_id).await;

        payload_items.push(ServerReadingSessionItem {
            client_session_id: s.client_session_id.clone(),
            book_id: target_book_id_uuid,
            device_name: s
                .device_name
                .clone()
                .or_else(|| Some("FolioReader".to_string())),
            start_time: s.start_time.clone(),
            end_time: s.end_time.clone(),
            duration_seconds: s.duration_seconds,
            start_progress: s
                .start_progress
                .filter(|v| !v.is_nan())
                .map(|v| outgoing_percent(copy.as_ref(), v.clamp(0.0, 100.0))),
            end_progress: s
                .end_progress
                .filter(|v| !v.is_nan())
                .map(|v| outgoing_percent(copy.as_ref(), v.clamp(0.0, 100.0))),
            pages_read: Some(s.pages_read),
        });
        session_ids.push(s.id.clone());
    }

    if payload_items.is_empty() {
        return Ok(0);
    }

    let url = format!("{base_url}/api/statistics/sessions");
    let payload = ServerBatchSessionsPayload {
        sessions: payload_items,
    };

    let res = client
        .post(&url)
        .headers(headers.clone())
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to push reading sessions: {e}"))?;

    if res.status().is_success() {
        let _ = db::mark_reading_sessions_synced(pool, &session_ids).await;
        Ok(session_ids.len())
    } else {
        Err(format!("Server returned HTTP {}", res.status()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn ids(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[tokio::test]
    async fn test_chapters_book_location_translation() {
        let pool = db::init_db(Path::new(":memory:")).await.unwrap();
        let book = "0198c0de-0000-7000-8000-000000000001";
        let local = "local-Book_epub";
        db::save_chapter_copy(
            &pool,
            local,
            book,
            None,
            0,
            3,
            &ids(&["ch-a", "ch-b", "ch-c"]),
        )
        .await
        .unwrap();
        let copy = chapter_copy(&pool, local).await;
        let copy = copy.as_ref();
        assert!(copy.is_some());

        // A regular book: locations pass through untouched in both directions
        let cfi = "epubcfi(/6/4!/4/2/1:10)";
        assert!(chapter_copy(&pool, "local-File_epub").await.is_none());
        assert_eq!(
            outgoing_location(&pool, None, cfi).await.as_deref(),
            Some(cfi)
        );
        assert_eq!(
            incoming_location(&pool, None, cfi.to_string(), None).await,
            RemoteLocation::At(cfi.to_string())
        );

        // A chapters book: the server gets the chapter the CFI is in
        assert_eq!(
            outgoing_location(&pool, copy, cfi).await.as_deref(),
            Some("ch:ch-b")
        );
        assert_eq!(outgoing_location(&pool, copy, "").await, None);
        assert_eq!(
            outgoing_location(&pool, copy, "epubcfi(/6/40!/4)").await,
            None
        );

        // ...and a server chapter becomes the start of that chapter in the local EPUB
        assert_eq!(
            incoming_location(&pool, copy, "ch:ch-c".to_string(), Some(cfi)).await,
            RemoteLocation::At("epubcfi(/6/6!/4)".to_string())
        );
        assert_eq!(
            incoming_location(&pool, copy, "ch:ch-a".to_string(), None).await,
            RemoteLocation::At("epubcfi(/6/2!/4)".to_string())
        );
        // The reader is already inside that chapter: keep the precise local position
        assert_eq!(
            incoming_location(&pool, copy, "ch:ch-b".to_string(), Some(cfi)).await,
            RemoteLocation::SameChapter
        );
        // Chapters this copy does not have, and positions of another edition
        assert_eq!(
            incoming_location(&pool, copy, "ch:ch-new".to_string(), Some(cfi)).await,
            RemoteLocation::Unknown
        );
        assert_eq!(
            incoming_location(&pool, copy, cfi.to_string(), Some(cfi)).await,
            RemoteLocation::Unknown
        );

        // The whole book is in the scale of the server already
        assert_eq!(outgoing_percent(copy, 40.0), 40.0);
        assert_eq!(incoming_percent(copy, 40.0), 40.0);
        assert_eq!(outgoing_is_read(copy, true), Some(true));
        assert_eq!(outgoing_is_read(copy, false), Some(false));
        assert!(!incoming_is_read(copy, false, true));
        assert_eq!(outgoing_item_location(copy, cfi).as_deref(), Some(cfi));
        assert_eq!(incoming_item_location(copy, cfi).as_deref(), Some(cfi));

        // The server id itself is not something to sync when the book is read from copies
        assert!(is_book_read_from_copies(&pool, book).await);
        assert!(!is_book_read_from_copies(&pool, local).await);
        assert!(!is_book_read_from_copies(&pool, "0198c0de-0000-7000-8000-000000000009").await);
    }

    #[tokio::test]
    async fn test_volume_copy_translation() {
        let pool = db::init_db(Path::new(":memory:")).await.unwrap();
        let book = "0198c0de-0000-7000-8000-000000000001";
        // Volumes of 2, 2 and 1 chapters; the whole book and two volumes on this device
        db::save_chapter_copy(
            &pool,
            "local-Book_epub",
            book,
            None,
            0,
            5,
            &ids(&["ch-a", "ch-b", "ch-c", "ch-d", "ch-e"]),
        )
        .await
        .unwrap();
        db::save_chapter_copy(
            &pool,
            "local-Book_-_Vol_02_epub",
            book,
            Some(2.0),
            2,
            5,
            &ids(&["ch-c", "ch-d"]),
        )
        .await
        .unwrap();
        db::save_chapter_copy(
            &pool,
            "local-Book_-_Vol_03_epub",
            book,
            Some(3.0),
            4,
            5,
            &ids(&["ch-e"]),
        )
        .await
        .unwrap();
        let whole = chapter_copy(&pool, "local-Book_epub").await;
        let volume2 = chapter_copy(&pool, "local-Book_-_Vol_02_epub").await;
        let volume3 = chapter_copy(&pool, "local-Book_-_Vol_03_epub").await;
        let (whole, volume2, volume3) = (whole.as_ref(), volume2.as_ref(), volume3.as_ref());

        // The same local CFI names different chapters in different copies
        let second_item = "epubcfi(/6/4!/4/2/1:10)";
        assert_eq!(
            outgoing_location(&pool, whole, second_item)
                .await
                .as_deref(),
            Some("ch:ch-b")
        );
        assert_eq!(
            outgoing_location(&pool, volume2, second_item)
                .await
                .as_deref(),
            Some("ch:ch-d")
        );
        assert_eq!(outgoing_location(&pool, volume3, second_item).await, None);

        // ...and a server chapter opens only in the copies that hold it
        assert_eq!(
            incoming_location(&pool, whole, "ch:ch-d".to_string(), None).await,
            RemoteLocation::At("epubcfi(/6/8!/4)".to_string())
        );
        assert_eq!(
            incoming_location(&pool, volume2, "ch:ch-d".to_string(), None).await,
            RemoteLocation::At("epubcfi(/6/4!/4)".to_string())
        );
        assert_eq!(
            incoming_location(&pool, volume2, "ch:ch-d".to_string(), Some(second_item)).await,
            RemoteLocation::SameChapter
        );
        assert_eq!(
            incoming_location(&pool, volume3, "ch:ch-d".to_string(), None).await,
            RemoteLocation::Unknown
        );

        // Percentages: half of volume 2 is 3 chapters of 5
        assert_eq!(outgoing_percent(volume2, 50.0), 60.0);
        assert_eq!(incoming_percent(volume2, 60.0), 50.0);
        assert_eq!(incoming_percent(volume2, 10.0), 0.0);
        assert_eq!(incoming_percent(volume2, 95.0), 100.0);
        assert_eq!(outgoing_percent(volume3, 100.0), 100.0);

        // Finishing a volume finishes the book only when it is the last one, and a volume
        // never clears the flag
        assert_eq!(outgoing_is_read(volume2, true), None);
        assert_eq!(outgoing_is_read(volume2, false), None);
        assert_eq!(outgoing_is_read(volume3, true), Some(true));
        assert_eq!(outgoing_is_read(volume3, false), None);
        assert!(incoming_is_read(volume2, true, false));
        assert!(incoming_is_read(volume2, false, true));
        assert!(!incoming_is_read(volume2, false, false));

        // Bookmarks and annotations: the server counts spine items from the start of the book
        assert_eq!(
            outgoing_item_location(volume2, second_item).as_deref(),
            Some("epubcfi(/6/8!/4/2/1:10)")
        );
        assert_eq!(
            incoming_item_location(volume2, "epubcfi(/6/8!/4/2,/1:0,/1:5)").as_deref(),
            Some("epubcfi(/6/4!/4/2,/1:0,/1:5)")
        );
        assert_eq!(
            incoming_item_location(volume2, "epubcfi(/6/6!/4)").as_deref(),
            Some("epubcfi(/6/2!/4)")
        );
        // Items of other volumes are not this copy's
        assert_eq!(incoming_item_location(volume2, "epubcfi(/6/4!/4)"), None);
        assert_eq!(incoming_item_location(volume2, "epubcfi(/6/10!/4)"), None);
        assert_eq!(incoming_item_location(volume2, "not a cfi"), None);
        assert_eq!(outgoing_item_location(volume2, "not a cfi"), None);
    }

    // ---- A small in-memory Folio server: progress, bookmarks, annotations, sessions ----

    #[derive(Default)]
    struct MockFolio {
        progress: Option<serde_json::Value>,
        bookmarks: Vec<serde_json::Value>,
        annotations: Vec<serde_json::Value>,
        sessions: Vec<serde_json::Value>,
        /// (method, path without query, body)
        requests: Vec<(String, String, serde_json::Value)>,
    }

    const USER_ID: &str = "0198c0de-ffff-7000-8000-000000000001";

    fn respond(state: &Mutex<MockFolio>, method: &str, target: &str, body: &[u8]) -> (u16, String) {
        let mut state = state.lock().unwrap();
        let path = target.split('?').next().unwrap_or(target).to_string();
        let body: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
        state
            .requests
            .push((method.to_string(), path.clone(), body.clone()));

        if path == "/api/statistics/sessions" {
            if let Some(items) = body.get("sessions").and_then(|s| s.as_array()) {
                state.sessions.extend(items.iter().cloned());
            }
            return (200, "{}".to_string());
        }
        let Some(rest) = path.strip_prefix("/api/books/") else {
            return (404, String::new());
        };
        let mut parts = rest.split('/');
        let book_id = parts.next().unwrap_or_default().to_string();
        let item = |mut value: serde_json::Value| {
            value["id"] = serde_json::json!(Uuid::now_v7().to_string());
            value["userId"] = serde_json::json!(USER_ID);
            value["bookId"] = serde_json::json!(book_id);
            value["createdAt"] = serde_json::json!("2026-11-10T00:00:00Z");
            value["updatedAt"] = serde_json::json!("2026-11-10T00:00:00Z");
            value
        };
        match (method, parts.next(), parts.next()) {
            ("GET", Some("progress"), None) => match &state.progress {
                Some(progress) => (200, progress.to_string()),
                None => (404, String::new()),
            },
            ("PUT", Some("progress"), None) => {
                // Like the server: fields that are not sent keep their value
                let mut progress = state.progress.clone().unwrap_or_else(
                    || serde_json::json!({ "location": "", "progressPercent": 0.0, "isRead": false }),
                );
                for key in ["location", "progressPercent", "isRead"] {
                    if let Some(value) = body.get(key) {
                        progress[key] = value.clone();
                    }
                }
                state.progress = Some(progress.clone());
                (200, progress.to_string())
            }
            ("GET", Some("bookmarks"), None) => (
                200,
                serde_json::Value::Array(state.bookmarks.clone()).to_string(),
            ),
            ("POST", Some("bookmarks"), None) => {
                let created = item(body);
                state.bookmarks.push(created.clone());
                (201, created.to_string())
            }
            ("DELETE", Some("bookmarks"), Some(id)) => {
                state.bookmarks.retain(|b| b["id"] != id);
                (204, String::new())
            }
            ("GET", Some("annotations"), None) => (
                200,
                serde_json::Value::Array(state.annotations.clone()).to_string(),
            ),
            ("POST", Some("annotations"), None) => {
                let created = item(body);
                state.annotations.push(created.clone());
                (201, created.to_string())
            }
            ("DELETE", Some("annotations"), Some(id)) => {
                state.annotations.retain(|a| a["id"] != id);
                (204, String::new())
            }
            _ => (404, String::new()),
        }
    }

    async fn start_mock_server(state: Arc<Mutex<MockFolio>>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let state = state.clone();
                tokio::spawn(async move {
                    let mut data = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let (head_end, content_length) = loop {
                        match socket.read(&mut chunk).await {
                            Ok(0) | Err(_) => return,
                            Ok(n) => data.extend_from_slice(&chunk[..n]),
                        }
                        if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                            let head = String::from_utf8_lossy(&data[..pos]).to_lowercase();
                            let length = head
                                .lines()
                                .find_map(|l| l.strip_prefix("content-length:"))
                                .and_then(|v| v.trim().parse::<usize>().ok())
                                .unwrap_or(0);
                            break (pos + 4, length);
                        }
                    };
                    while data.len() < head_end + content_length {
                        match socket.read(&mut chunk).await {
                            Ok(0) | Err(_) => return,
                            Ok(n) => data.extend_from_slice(&chunk[..n]),
                        }
                    }
                    let head = String::from_utf8_lossy(&data[..head_end]).to_string();
                    let mut request_line = head.split_whitespace();
                    let method = request_line.next().unwrap_or("GET").to_string();
                    let target = request_line.next().unwrap_or("/").to_string();
                    let (status, body) = respond(&state, &method, &target, &data[head_end..]);
                    let header = format!(
                        "HTTP/1.1 {status} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = socket.write_all(header.as_bytes()).await;
                    let _ = socket.write_all(body.as_bytes()).await;
                    let _ = socket.shutdown().await;
                });
            }
        });
        format!("http://{address}")
    }

    fn server_bookmark(book: &str, location: &str, title: &str) -> serde_json::Value {
        serde_json::json!({
            "id": Uuid::now_v7().to_string(),
            "userId": USER_ID,
            "bookId": book,
            "location": location,
            "title": title,
            "createdAt": "2026-11-01T00:00:00Z",
        })
    }

    fn server_annotation(book: &str, start: &str, end: &str, text: &str) -> serde_json::Value {
        serde_json::json!({
            "id": Uuid::now_v7().to_string(),
            "userId": USER_ID,
            "bookId": book,
            "locationStart": start,
            "locationEnd": end,
            "selectedText": text,
            "note": null,
            "color": "yellow",
            "createdAt": "2026-11-01T00:00:00Z",
            "updatedAt": "2026-11-01T00:00:00Z",
        })
    }

    #[tokio::test]
    async fn test_sync_of_volume_copy_next_to_the_whole_book() {
        let book = "0198c0de-0000-7000-8000-000000000001";
        let whole = "local-Book_epub";
        let volume2 = "local-Book_-_Vol_02_epub";

        // The server: the reader is in `ch-c` (the first chapter of volume 2) at 50% of
        // the book; one bookmark and one highlight inside volume 2, one of each outside
        let state = Arc::new(Mutex::new(MockFolio {
            progress: Some(serde_json::json!({
                "location": "ch:ch-c",
                "progressPercent": 50.0,
                "isRead": false,
                "updatedAt": "2026-11-09T00:00:00Z",
            })),
            bookmarks: vec![
                server_bookmark(book, "epubcfi(/6/8!/4/2/1:0)", "In volume 2"),
                server_bookmark(book, "epubcfi(/6/2!/4/2/1:0)", "In volume 1"),
            ],
            annotations: vec![
                server_annotation(
                    book,
                    "epubcfi(/6/6!/4/2/1:0)",
                    "epubcfi(/6/6!/4/2/1:9)",
                    "in volume 2",
                ),
                server_annotation(
                    book,
                    "epubcfi(/6/10!/4/2/1:0)",
                    "epubcfi(/6/10!/4/2/1:9)",
                    "in volume 3",
                ),
            ],
            ..MockFolio::default()
        }));
        let server_url = start_mock_server(state.clone()).await;
        let client = reqwest::Client::new();
        let pool = db::init_db(Path::new(":memory:")).await.unwrap();

        // The device: volume 2 (chapters c, d of a, b | c, d | e)
        db::save_book_mapping(&pool, volume2, book, Some("/books/Book - Vol 02.epub"))
            .await
            .unwrap();
        db::save_chapter_copy(
            &pool,
            volume2,
            book,
            Some(2.0),
            2,
            5,
            &ids(&["ch-c", "ch-d"]),
        )
        .await
        .unwrap();

        // ---- Opening the copy pulls the server position into its own coordinates ----
        let pulled = pull_book_progress(&pool, &client, &server_url, None, volume2)
            .await
            .unwrap();
        assert!(pulled.success, "{}", pulled.message);
        assert_eq!(pulled.location.as_deref(), Some("epubcfi(/6/2!/4)"));
        // 50% of 5 chapters is half a chapter into a volume of 2 that starts after 2
        assert_eq!(pulled.progress_percent, Some(25.0));
        let progress = db::get_progress(&pool, volume2).await.unwrap().unwrap();
        assert_eq!(progress.book_id, volume2);
        assert_eq!(progress.progress_percent, 25.0);
        // Nothing is mirrored under the server id for other copies to pick up
        assert!(db::get_progress(&pool, book).await.unwrap().is_none());

        // ---- A bookmark and a highlight made in the copy, then a full sync ----
        db::save_bookmark(
            &pool,
            "bm-local",
            None,
            volume2,
            "epubcfi(/6/2!/4/4/1:3)",
            0.1,
            None,
            Some("Mine"),
            None,
            true,
        )
        .await
        .unwrap();
        db::save_annotation(
            &pool,
            "ann-local",
            None,
            volume2,
            "epubcfi(/6/4!/4/2/1:0)",
            "epubcfi(/6/4!/4/2/1:5)",
            "epubcfi(/6/4!/4/2,/1:0,/1:5)",
            "mine",
            None,
            "yellow",
            None,
            None,
            Some(1),
            None,
            true,
        )
        .await
        .unwrap();
        state.lock().unwrap().requests.clear();
        let result = sync_book(&pool, &client, &server_url, None, volume2)
            .await
            .unwrap();
        assert!(result.success);

        {
            let state = state.lock().unwrap();
            // Pushed in the coordinates of the whole book: two spine items further
            let created_bookmark = state
                .requests
                .iter()
                .find(|(m, p, _)| m == "POST" && p.ends_with("/bookmarks"))
                .expect("bookmark pushed");
            assert_eq!(created_bookmark.2["location"], "epubcfi(/6/6!/4/4/1:3)");
            let created_annotation = state
                .requests
                .iter()
                .find(|(m, p, _)| m == "POST" && p.ends_with("/annotations"))
                .expect("annotation pushed");
            assert_eq!(
                created_annotation.2["locationStart"],
                "epubcfi(/6/8!/4/2/1:0)"
            );
            assert_eq!(
                created_annotation.2["locationEnd"],
                "epubcfi(/6/8!/4/2/1:5)"
            );
            // Items of other volumes were neither deleted nor touched on the server
            assert!(!state.requests.iter().any(|(m, _, _)| m == "DELETE"));
            assert_eq!(state.bookmarks.len(), 3);
            assert_eq!(state.annotations.len(), 3);
        }

        // Locally: this volume's items only, in this file's coordinates
        let mut bookmarks: Vec<(String, String)> = db::get_bookmarks(&pool, volume2)
            .await
            .unwrap()
            .into_iter()
            .map(|b| (b.location, b.sync_status))
            .collect();
        bookmarks.sort();
        assert_eq!(
            bookmarks,
            [
                ("epubcfi(/6/2!/4/4/1:3)".to_string(), "synced".to_string()),
                ("epubcfi(/6/4!/4/2/1:0)".to_string(), "synced".to_string()),
            ]
        );
        let mut annotations: Vec<(String, String, String)> = db::get_annotations(&pool, volume2)
            .await
            .unwrap()
            .into_iter()
            .map(|a| (a.location_start, a.location_end, a.selected_text))
            .collect();
        annotations.sort();
        assert_eq!(
            annotations,
            [
                (
                    "epubcfi(/6/2!/4/2/1:0)".to_string(),
                    "epubcfi(/6/2!/4/2/1:9)".to_string(),
                    "in volume 2".to_string()
                ),
                (
                    "epubcfi(/6/4!/4/2/1:0)".to_string(),
                    "epubcfi(/6/4!/4/2/1:5)".to_string(),
                    "mine".to_string()
                ),
            ]
        );

        // ---- Syncing again changes nothing on either side ----
        state.lock().unwrap().requests.clear();
        sync_book(&pool, &client, &server_url, None, volume2)
            .await
            .unwrap();
        {
            let state = state.lock().unwrap();
            assert!(
                !state
                    .requests
                    .iter()
                    .any(|(m, _, _)| m == "DELETE" || m == "POST" || m == "PUT")
            );
        }
        assert_eq!(db::get_bookmarks(&pool, volume2).await.unwrap().len(), 2);
        assert_eq!(db::get_annotations(&pool, volume2).await.unwrap().len(), 2);

        // ---- The volume is read to its end: the book is at 80%, and not finished ----
        db::save_progress(&pool, volume2, "epubcfi(/6/4!/4/8/1:0)", 100.0, true, true)
            .await
            .unwrap();
        db::save_reading_session(
            &pool,
            volume2,
            None,
            "2026-11-10T10:00:00Z",
            "2026-11-10T10:30:00Z",
            1800,
            Some(25.0),
            Some(100.0),
            12,
        )
        .await
        .unwrap();
        state.lock().unwrap().requests.clear();
        sync_book(&pool, &client, &server_url, None, volume2)
            .await
            .unwrap();
        {
            let state = state.lock().unwrap();
            let pushed = state
                .requests
                .iter()
                .find(|(m, p, _)| m == "PUT" && p.ends_with("/progress"))
                .expect("progress pushed");
            assert_eq!(pushed.2["location"], "ch:ch-d");
            assert_eq!(pushed.2["progressPercent"], 80.0);
            assert!(pushed.2.get("isRead").is_none());
            assert_eq!(state.progress.as_ref().unwrap()["isRead"], false);
            // Session bounds are in the scale of the book as well
            assert_eq!(state.sessions.len(), 1);
            assert_eq!(state.sessions[0]["startProgress"], 50.0);
            assert_eq!(state.sessions[0]["endProgress"], 80.0);
            assert_eq!(state.sessions[0]["bookId"], book);
        }
        // The copy itself stays finished after the pull that follows the push
        let progress = db::get_progress(&pool, volume2).await.unwrap().unwrap();
        assert_eq!(progress.sync_status, "synced");
        assert_eq!(progress.progress_percent, 100.0);
        assert!(progress.is_read);

        // ---- The whole book is downloaded next to the volume ----
        db::save_book_mapping(&pool, whole, book, Some("/books/Book.epub"))
            .await
            .unwrap();
        db::save_chapter_copy(
            &pool,
            whole,
            book,
            None,
            0,
            5,
            &ids(&["ch-a", "ch-b", "ch-c", "ch-d", "ch-e"]),
        )
        .await
        .unwrap();
        let pulled = pull_book_progress(&pool, &client, &server_url, None, whole)
            .await
            .unwrap();
        // The same server position, in the coordinates and the scale of the whole book
        assert_eq!(pulled.location.as_deref(), Some("epubcfi(/6/8!/4)"));
        assert_eq!(pulled.progress_percent, Some(80.0));
        sync_book(&pool, &client, &server_url, None, whole)
            .await
            .unwrap();
        let mut whole_bookmarks: Vec<String> = db::get_bookmarks(&pool, whole)
            .await
            .unwrap()
            .into_iter()
            .map(|b| b.location)
            .collect();
        whole_bookmarks.sort();
        assert_eq!(
            whole_bookmarks,
            [
                "epubcfi(/6/2!/4/2/1:0)",
                "epubcfi(/6/6!/4/4/1:3)",
                "epubcfi(/6/8!/4/2/1:0)",
            ]
        );
        assert_eq!(db::get_annotations(&pool, whole).await.unwrap().len(), 3);
        // The volume copy still has its own two of each, untouched
        let volume_bookmarks = db::get_bookmarks(&pool, volume2).await.unwrap();
        assert_eq!(volume_bookmarks.len(), 2);
        assert!(
            volume_bookmarks
                .iter()
                .all(|b| b.location.starts_with("epubcfi(/6/2!")
                    || b.location.starts_with("epubcfi(/6/4!"))
        );
        assert_eq!(db::get_annotations(&pool, volume2).await.unwrap().len(), 2);
        let progress = db::get_progress(&pool, volume2).await.unwrap().unwrap();
        assert_eq!(progress.location, "epubcfi(/6/4!/4/8/1:0)");

        // ---- A bookmark deleted in one copy disappears from the other through the server ----
        let shared = db::get_bookmarks(&pool, whole)
            .await
            .unwrap()
            .into_iter()
            .find(|b| b.location == "epubcfi(/6/8!/4/2/1:0)")
            .unwrap();
        db::delete_bookmark(&pool, &shared.id).await.unwrap();
        sync_book(&pool, &client, &server_url, None, whole)
            .await
            .unwrap();
        assert_eq!(state.lock().unwrap().bookmarks.len(), 2);
        // Until the volume copy syncs, its own row is still there
        assert_eq!(db::get_bookmarks(&pool, volume2).await.unwrap().len(), 2);
        sync_book(&pool, &client, &server_url, None, volume2)
            .await
            .unwrap();
        let volume_bookmarks = db::get_bookmarks(&pool, volume2).await.unwrap();
        assert_eq!(volume_bookmarks.len(), 1);
        assert_eq!(volume_bookmarks[0].location, "epubcfi(/6/2!/4/4/1:3)");
        assert_eq!(state.lock().unwrap().bookmarks.len(), 2);

        // ---- The server position moves to another volume: this copy keeps its own ----
        state.lock().unwrap().progress = Some(serde_json::json!({
            "location": "ch:ch-a",
            "progressPercent": 5.0,
            "isRead": false,
        }));
        let pulled = pull_book_progress(&pool, &client, &server_url, None, volume2)
            .await
            .unwrap();
        assert!(!pulled.success);
        assert_eq!(pulled.location, None);
        state.lock().unwrap().requests.clear();
        sync_book(&pool, &client, &server_url, None, volume2)
            .await
            .unwrap();
        let progress = db::get_progress(&pool, volume2).await.unwrap().unwrap();
        assert_eq!(progress.location, "epubcfi(/6/4!/4/8/1:0)");
        // ...and a volume that was read earlier does not take the position back
        assert!(
            !state
                .lock()
                .unwrap()
                .requests
                .iter()
                .any(|(m, p, _)| m == "PUT" && p.ends_with("/progress"))
        );
        assert_eq!(
            state.lock().unwrap().progress.as_ref().unwrap()["location"],
            "ch:ch-a"
        );

        // ---- Asked by the server id, nothing is synced: the copies do that ----
        let result = sync_book(&pool, &client, &server_url, None, book)
            .await
            .unwrap();
        assert!(!result.success);
    }
}
