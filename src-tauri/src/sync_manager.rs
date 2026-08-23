use crate::db::{self, DbAnnotation, DbBookmark, DbPool};
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullProgressResult {
    pub success: bool,
    pub message: String,
    pub location: Option<String>,
    pub progress_percent: Option<f32>,
    pub is_read: Option<bool>,
}

// Server payload types
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerProgressResponse {
    pub location: Option<String>,
    pub progress_percent: Option<f32>,
    pub is_read: Option<bool>,
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

async fn calculate_file_hash(file_path: &Path) -> Option<String> {
    let bytes = tokio::fs::read(file_path).await.ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let result = hasher.finalize();
    Some(hex::encode(result))
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
        if p.exists() && p.is_file()
            && let Some(hash) = calculate_file_hash(p).await {
                let url = format!("{base_url}/api/books/by-hash/{hash}");
                if let Ok(res) = client.get(&url).headers(headers.clone()).send().await
                    && res.status().is_success()
                        && let Ok(val) = res.json::<serde_json::Value>().await
                            && let Some(id_str) = val.get("id").and_then(|v| v.as_str()) {
                                let _ =
                                    db::save_book_mapping(pool, book_id, id_str, Some(&fp)).await;
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
            return Ok(SyncResult {
                success: false,
                message: format!(
                    "Book '{book_id}' is not linked to any server Folio ID. Skipping sync."
                ),
                progress_synced: false,
                bookmarks_synced: 0,
                annotations_synced: 0,
            });
        }
    };

    let progress_synced = sync_progress(pool, client, base, &headers, book_id, &server_id)
        .await
        .unwrap_or(false);
    let bookmarks_synced = sync_bookmarks(pool, client, base, &headers, book_id, &server_id)
        .await
        .unwrap_or(0);
    let annotations_synced = sync_annotations(pool, client, base, &headers, book_id, &server_id)
        .await
        .unwrap_or(0);

    Ok(SyncResult {
        success: true,
        message: "Book sync completed successfully".to_string(),
        progress_synced,
        bookmarks_synced,
        annotations_synced,
    })
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
            });
        }
    };

    let url = format!("{base}/api/books/{server_id}/progress?format=cfi");
    let res = client
        .get(&url)
        .headers(headers.clone())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch server progress: {e}"))?;

    if res.status().is_success() {
        if let Ok(remote) = res.json::<ServerProgressResponse>().await {
            if let Some(loc) = remote.location {
                let remote_percent = remote.progress_percent.unwrap_or(0.0);
                let is_read = remote.is_read.unwrap_or(false);

                let current_local = db::get_progress(pool, book_id).await.ok().flatten();
                let local_is_pending = current_local
                    .as_ref()
                    .map(|p| p.sync_status == "pending")
                    .unwrap_or(false);
                let local_percent = current_local.as_ref().map(|p| p.progress_percent).unwrap_or(0.0);

                // If local progress is pending or further ahead, preserve local and push it to the server
                if local_is_pending || (local_percent > remote_percent && local_percent > 0.0) {
                    if let Some(local_p) = current_local {
                        // Push local to server
                        let put_url = format!("{base}/api/books/{server_id}/progress?format=cfi");
                        let payload = ServerProgressPayload {
                            location: Some(local_p.location.clone()),
                            progress_percent: Some(local_p.progress_percent),
                            is_read: Some(local_p.is_read),
                        };
                        let put_res = client
                            .put(&put_url)
                            .headers(headers.clone())
                            .json(&payload)
                            .send()
                            .await;

                        if let Ok(r) = put_res {
                            if r.status().is_success() {
                                let _ = sqlx::query("UPDATE book_progress SET sync_status = 'synced' WHERE book_id = ? OR book_id = ?")
                                    .bind(book_id)
                                    .bind(&server_id)
                                    .execute(pool)
                                    .await;
                            }
                        }

                        return Ok(PullProgressResult {
                            success: true,
                            message: "Local progress preserved and synced with server".to_string(),
                            location: Some(local_p.location),
                            progress_percent: Some(local_p.progress_percent),
                            is_read: Some(local_p.is_read),
                        });
                    }
                }

                // Force save to local SQLite database with sync_status = 'synced'
                let _ = db::save_progress(pool, book_id, &loc, remote_percent, is_read, false).await;
                if server_id != book_id {
                    let _ = db::save_progress(pool, &server_id, &loc, remote_percent, is_read, false).await;
                }

                return Ok(PullProgressResult {
                    success: true,
                    message: "Progress successfully fetched from server".to_string(),
                    location: Some(loc),
                    progress_percent: Some(remote_percent),
                    is_read: Some(is_read),
                });
            }
        }
        return Ok(PullProgressResult {
            success: false,
            message: "No reading progress recorded on server for this book".to_string(),
            location: None,
            progress_percent: None,
            is_read: None,
        });
    } else if res.status().as_u16() == 404 {
        return Ok(PullProgressResult {
            success: false,
            message: "No progress found on server".to_string(),
            location: None,
            progress_percent: None,
            is_read: None,
        });
    } else {
        return Err(format!("Server returned error status {}", res.status()));
    }
}

async fn sync_progress(
    pool: &DbPool,
    client: &reqwest::Client,
    base_url: &str,
    headers: &HeaderMap,
    local_book_id: &str,
    server_book_id: &str,
) -> Result<bool, String> {
    let local = db::get_progress(pool, local_book_id)
        .await
        .map_err(|e| e.to_string())?;

    // 1. Push if pending and not just unread 0%
    if let Some(p) = &local
        && p.sync_status == "pending" {
            let url = format!("{base_url}/api/books/{server_book_id}/progress?format=cfi");
            let payload = ServerProgressPayload {
                location: Some(p.location.clone()),
                progress_percent: Some(p.progress_percent),
                is_read: Some(p.is_read),
            };

            let res = client
                .put(&url)
                .headers(headers.clone())
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("Failed to push progress: {e}"))?;

            if res.status().is_success() {
                let _ = sqlx::query("UPDATE book_progress SET sync_status = 'synced' WHERE book_id = ? OR book_id = ?")
                    .bind(local_book_id)
                    .bind(server_book_id)
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
                && let Some(loc) = remote.location {
                    let current_local = db::get_progress(pool, local_book_id).await.ok().flatten();
                    let is_pending = current_local
                        .as_ref()
                        .map(|p| p.sync_status == "pending")
                        .unwrap_or(false);
                    // If not pending, or if local is at 0% while remote is further ahead, update local
                    let local_percent = current_local.as_ref().map(|p| p.progress_percent).unwrap_or(0.0);
                    let remote_percent = remote.progress_percent.unwrap_or(0.0);
                    if !is_pending || (local_percent <= 0.01 && remote_percent > 0.0) {
                        let _ = db::save_progress(
                            pool,
                            local_book_id,
                            &loc,
                            remote_percent,
                            remote.is_read.unwrap_or(false),
                            false,
                        )
                        .await;
                        if server_book_id != local_book_id {
                            let _ = db::save_progress(
                                pool,
                                server_book_id,
                                &loc,
                                remote_percent,
                                remote.is_read.unwrap_or(false),
                                false,
                            )
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
) -> Result<usize, String> {
    let mut count = 0;

    // 1. Push deleted
    let pending_deleted = sqlx::query_as::<_, DbBookmark>(
        "SELECT id, server_id, book_id, location, fraction, location_label, chapter_title, created_at, is_deleted != 0 AS is_deleted, sync_status FROM bookmarks WHERE (book_id = ? OR book_id = ?) AND sync_status = 'pending_delete' AND server_id IS NOT NULL",
    )
    .bind(local_book_id)
    .bind(server_book_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for bm in pending_deleted {
        if let Some(server_id) = &bm.server_id {
            let url = format!("{base_url}/api/books/{server_book_id}/bookmarks/{server_id}");
            let res = client.delete(&url).headers(headers.clone()).send().await;
            if let Ok(r) = res
                && (r.status().is_success() || r.status().as_u16() == 404) {
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
    .bind(server_book_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for bm in pending_created {
        let url = format!("{base_url}/api/books/{server_book_id}/bookmarks?format=cfi");
        let payload = ServerCreateBookmarkPayload {
            location: bm.location.clone(),
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
                && let Ok(created) = r.json::<ServerBookmarkResponse>().await {
                    let _ = sqlx::query(
                        "UPDATE bookmarks SET server_id = ?, sync_status = 'synced' WHERE id = ?",
                    )
                    .bind(created.id.to_string())
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
            && let Ok(remote_bookmarks) = r.json::<Vec<ServerBookmarkResponse>>().await {
                for rbm in remote_bookmarks {
                    let server_id_str = rbm.id.to_string();
                    let existing = sqlx::query_as::<_, DbBookmark>(
                        "SELECT id, server_id, book_id, location, fraction, location_label, chapter_title, created_at, is_deleted != 0 AS is_deleted, sync_status FROM bookmarks WHERE server_id = ? OR (location = ? AND (book_id = ? OR book_id = ?))",
                    )
                    .bind(&server_id_str)
                    .bind(&rbm.location)
                    .bind(local_book_id)
                    .bind(server_book_id)
                    .fetch_optional(pool)
                    .await
                    .unwrap_or(None);

                    match existing {
                        Some(loc_bm) => {
                            if loc_bm.sync_status != "pending_create"
                                && loc_bm.sync_status != "pending_delete"
                            {
                                let _ = sqlx::query(
                                    "UPDATE bookmarks SET server_id = ?, location = ?, chapter_title = ?, is_deleted = 0, sync_status = 'synced' WHERE id = ?",
                                )
                                .bind(&server_id_str)
                                .bind(&rbm.location)
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
                                &rbm.location,
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
            if other.is_empty() {
                Some("yellow".to_string())
            } else if other.starts_with('#') {
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
) -> Result<usize, String> {
    let mut count = 0;

    // 1. Push deleted
    let pending_deleted = sqlx::query_as::<_, DbAnnotation>(
        "SELECT id, server_id, book_id, location_start, location_end, value, selected_text, note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted != 0 AS is_deleted, sync_status FROM annotations WHERE (book_id = ? OR book_id = ?) AND sync_status = 'pending_delete' AND server_id IS NOT NULL",
    )
    .bind(local_book_id)
    .bind(server_book_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for ann in pending_deleted {
        if let Some(server_id) = &ann.server_id {
            let url = format!("{base_url}/api/books/{server_book_id}/annotations/{server_id}");
            let res = client.delete(&url).headers(headers.clone()).send().await;
            if let Ok(r) = res
                && (r.status().is_success() || r.status().as_u16() == 404) {
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
    .bind(server_book_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for ann in pending_created {
        let url = format!("{base_url}/api/books/{server_book_id}/annotations?format=cfi");
        let payload = ServerCreateAnnotationPayload {
            location_start: if ann.location_start.is_empty() {
                ann.value.clone()
            } else {
                ann.location_start.clone()
            },
            location_end: if ann.location_end.is_empty() {
                ann.value.clone()
            } else {
                ann.location_end.clone()
            },
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
                && let Ok(created) = r.json::<ServerAnnotationResponse>().await {
                    let _ = sqlx::query(
                        "UPDATE annotations SET server_id = ?, sync_status = 'synced' WHERE id = ?",
                    )
                    .bind(created.id.to_string())
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
    .bind(server_book_id)
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
                && r.status().is_success() {
                    let _ =
                        sqlx::query("UPDATE annotations SET sync_status = 'synced' WHERE id = ?")
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
            && let Ok(remote_annotations) = r.json::<Vec<ServerAnnotationResponse>>().await {
                for rann in remote_annotations {
                    let server_id_str = rann.id.to_string();
                    let existing = sqlx::query_as::<_, DbAnnotation>(
                        "SELECT id, server_id, book_id, location_start, location_end, value, selected_text, note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted != 0 AS is_deleted, sync_status FROM annotations WHERE server_id = ? OR (location_start = ? AND (book_id = ? OR book_id = ?))",
                    )
                    .bind(&server_id_str)
                    .bind(&rann.location_start)
                    .bind(local_book_id)
                    .bind(server_book_id)
                    .fetch_optional(pool)
                    .await
                    .unwrap_or(None);

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
                                .bind(&rann.location_start)
                                .bind(&rann.location_end)
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
                            let val = if !rann.location_start.is_empty() {
                                rann.location_start.clone()
                            } else {
                                rann.location_end.clone()
                            };
                            let color = normalize_annotation_color(rann.color.as_deref())
                                .unwrap_or_else(|| "yellow".to_string());

                            let _ = db::save_annotation(
                                pool,
                                &new_id,
                                Some(&server_id_str),
                                local_book_id,
                                &rann.location_start,
                                &rann.location_end,
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
            }

    Ok(count)
}
