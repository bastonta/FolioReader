use crate::auth_proxy::AuthHttpClientState;
use crate::db::{
    self, DbAnnotation, DbBookProgress, DbBookReadingStats, DbBookmark, DbChapterCopy,
    DbLocalBookMeta, DbPool, DbReadingSession, DbRecentBook,
};
use crate::sync_manager::{self, PullProgressResult, SyncResult};
use tauri::State;

fn validate_non_empty(val: &str, field_name: &str) -> Result<(), String> {
    if val.trim().is_empty() {
        return Err(format!("Field '{field_name}' must not be empty"));
    }
    if val.len() > 1024 * 1024 {
        return Err(format!("Field '{field_name}' exceeds maximum allowed size"));
    }
    Ok(())
}

fn sanitize_progress_percent(val: f32) -> Result<f32, String> {
    if val.is_nan() || val < 0.0 {
        return Err("Invalid progress_percent: cannot be negative or NaN".to_string());
    }
    Ok(val.clamp(0.0, 100.0))
}

fn sanitize_session_progress(val: Option<f32>) -> Result<Option<f32>, String> {
    match val {
        Some(v) => {
            if v.is_nan() || v < 0.0 {
                return Err("Invalid session progress: cannot be negative or NaN".to_string());
            }
            Ok(Some(v.clamp(0.0, 100.0)))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn db_save_book_mapping(
    local_id: String,
    server_book_id: String,
    file_path: Option<String>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    validate_non_empty(&local_id, "local_id")?;
    let saved = db::save_book_mapping(&db, &local_id, &server_book_id, file_path.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    if saved {
        Ok(())
    } else {
        // The frontend matches on this prefix
        Err(format!(
            "MAPPING_CONFLICT: '{local_id}' is already bound to another server book"
        ))
    }
}

/// Local id recorded for a file (`None`: the file was never seen). The id of a file must
/// not be computed from its path once it is recorded: the path is relative to a download
/// folder that may have been changed since.
#[tauri::command]
pub async fn db_get_local_id_for_file(
    file_path: String,
    db: State<'_, DbPool>,
) -> Result<Option<String>, String> {
    db::get_local_id_for_file(&db, &file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_server_book_id(
    book_id: String,
    db: State<'_, DbPool>,
) -> Result<Option<String>, String> {
    validate_non_empty(&book_id, "book_id")?;
    db::get_server_book_id(&db, &book_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_check_downloaded_books(
    server_book_ids: Vec<String>,
    db: State<'_, DbPool>,
) -> Result<std::collections::HashMap<String, String>, String> {
    db::check_downloaded_books(&db, &server_book_ids)
        .await
        .map_err(|e| e.to_string())
}

/// Local copies of `Chapters` books built on this device — the whole book and single
/// volumes — by server book id. Copies whose file is not on disk are left out.
#[tauri::command]
pub async fn db_get_chapter_copies(
    server_book_ids: Vec<String>,
    db: State<'_, DbPool>,
) -> Result<std::collections::HashMap<String, Vec<DbChapterCopy>>, String> {
    let copies = db::get_chapter_copies_of_books(&db, &server_book_ids)
        .await
        .map_err(|e| e.to_string())?;

    let mut result: std::collections::HashMap<String, Vec<DbChapterCopy>> =
        std::collections::HashMap::new();
    for copy in copies {
        let on_disk = copy
            .file_path
            .as_deref()
            .is_some_and(|path| std::path::Path::new(path).is_file());
        if on_disk {
            result
                .entry(copy.server_book_id.clone())
                .or_default()
                .push(copy);
        }
    }
    Ok(result)
}

/// What a local book holds of a `Chapters` book; `None` for a book downloaded as a file.
#[tauri::command]
pub async fn db_get_chapter_copy(
    book_id: String,
    db: State<'_, DbPool>,
) -> Result<Option<DbChapterCopy>, String> {
    db::get_chapter_copy(&db, &book_id)
        .await
        .map_err(|e| e.to_string())
}

/// Spine position of a server chapter in a local copy; `None` when the copy does not
/// hold the chapter (it belongs to another volume, or is newer than the copy).
#[tauri::command]
pub async fn db_get_chapter_position(
    book_id: String,
    chapter_id: String,
    db: State<'_, DbPool>,
) -> Result<Option<usize>, String> {
    db::get_chapter_position(&db, &book_id, &chapter_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_save_progress(
    book_id: String,
    location: String,
    progress_percent: f32,
    is_read: bool,
    db: State<'_, DbPool>,
) -> Result<DbBookProgress, String> {
    validate_non_empty(&book_id, "book_id")?;
    validate_non_empty(&location, "location")?;
    // `ch:<chapterId>` is how the server names a position in a book it keeps as chapters.
    // Locally every position is a CFI of the file being read: a server position stored
    // as it came would be pushed back with its percentage converted a second time.
    if location.trim_start().starts_with("ch:") {
        return Err(format!(
            "INVALID_LOCATION: '{location}' is a server position, not a position in a local file"
        ));
    }
    let progress_percent = sanitize_progress_percent(progress_percent)?;

    db::save_progress(&db, &book_id, &location, progress_percent, is_read, true)
        .await
        .map_err(|e| e.to_string())
}

/// Marks a book read (100%) or unread (0%) without opening it. `location`: the position
/// that goes with the mark (a volume copy passes the end or the start of its file).
/// Without one a book marked read keeps the position it has, and a book marked unread
/// has none — "no position" is what the sync then tells the server. `mark_pending: false`
/// keeps the mark on this device (a volume whose server position is in another volume).
#[tauri::command]
pub async fn db_set_read_status(
    book_id: String,
    is_read: bool,
    location: Option<String>,
    mark_pending: Option<bool>,
    db: State<'_, DbPool>,
) -> Result<DbBookProgress, String> {
    validate_non_empty(&book_id, "book_id")?;

    let location = match location {
        Some(location) => location,
        None if is_read => db::get_progress(&db, &book_id)
            .await
            .map_err(|e| e.to_string())?
            .map(|p| p.location)
            .unwrap_or_default(),
        None => String::new(),
    };
    let progress_percent = if is_read { 100.0 } else { 0.0 };

    db::save_progress(
        &db,
        &book_id,
        &location,
        progress_percent,
        is_read,
        mark_pending.unwrap_or(true),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_progress(
    book_id: String,
    db: State<'_, DbPool>,
) -> Result<Option<DbBookProgress>, String> {
    db::get_progress(&db, &book_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_delete_progress(book_id: String, db: State<'_, DbPool>) -> Result<(), String> {
    db::delete_progress(&db, &book_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_bookmarks(
    book_id: String,
    db: State<'_, DbPool>,
) -> Result<Vec<DbBookmark>, String> {
    db::get_bookmarks(&db, &book_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_save_bookmark(
    id: String,
    book_id: String,
    location: String,
    fraction: f32,
    location_label: Option<String>,
    chapter_title: Option<String>,
    db: State<'_, DbPool>,
) -> Result<DbBookmark, String> {
    validate_non_empty(&id, "id")?;
    validate_non_empty(&book_id, "book_id")?;
    validate_non_empty(&location, "location")?;
    let fraction = if fraction.is_nan() {
        0.0
    } else {
        fraction.clamp(0.0, 1.0)
    };

    db::save_bookmark(
        &db,
        &id,
        None,
        &book_id,
        &location,
        fraction,
        location_label.as_deref(),
        chapter_title.as_deref(),
        None,
        true,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_delete_bookmark(id: String, db: State<'_, DbPool>) -> Result<(), String> {
    validate_non_empty(&id, "id")?;
    db::delete_bookmark(&db, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_annotations(
    book_id: String,
    db: State<'_, DbPool>,
) -> Result<Vec<DbAnnotation>, String> {
    validate_non_empty(&book_id, "book_id")?;
    db::get_annotations(&db, &book_id)
        .await
        .map_err(|e| e.to_string())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn db_save_annotation(
    id: String,
    book_id: String,
    location_start: String,
    location_end: String,
    value: String,
    selected_text: String,
    note: Option<String>,
    color: String,
    style: Option<String>,
    chapter_title: Option<String>,
    section_index: Option<i32>,
    db: State<'_, DbPool>,
) -> Result<DbAnnotation, String> {
    validate_non_empty(&id, "id")?;
    validate_non_empty(&book_id, "book_id")?;
    validate_non_empty(&location_start, "location_start")?;
    validate_non_empty(&value, "value")?;

    db::save_annotation(
        &db,
        &id,
        None,
        &book_id,
        &location_start,
        &location_end,
        &value,
        &selected_text,
        note.as_deref(),
        &color,
        style.as_deref(),
        chapter_title.as_deref(),
        section_index,
        None,
        true,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_delete_annotation(
    id_or_value: String,
    book_id: Option<String>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    validate_non_empty(&id_or_value, "id_or_value")?;
    let book_id = book_id.filter(|id| !id.trim().is_empty());
    db::delete_annotation(&db, &id_or_value, book_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pull_book_progress(
    book_id: String,
    server_url: String,
    token: Option<String>,
    db: State<'_, DbPool>,
    auth_state: State<'_, AuthHttpClientState>,
) -> Result<PullProgressResult, String> {
    let client = {
        let auth = auth_state.lock().await;
        auth.client().clone()
    };

    sync_manager::pull_book_progress(&db, &client, &server_url, token.as_deref(), &book_id).await
}

#[tauri::command]
pub async fn sync_book_data(
    book_id: String,
    server_url: String,
    token: Option<String>,
    db: State<'_, DbPool>,
    auth_state: State<'_, AuthHttpClientState>,
    sync_lock: State<'_, sync_manager::SyncLock>,
) -> Result<SyncResult, String> {
    let _lock_guard = sync_lock.0.lock().await;
    let client = {
        let auth = auth_state.lock().await;
        auth.client().clone()
    };

    sync_manager::sync_book(&db, &client, &server_url, token.as_deref(), &book_id).await
}

#[tauri::command]
pub async fn sync_all_pending(
    server_url: String,
    token: Option<String>,
    db: State<'_, DbPool>,
    auth_state: State<'_, AuthHttpClientState>,
    sync_lock: State<'_, sync_manager::SyncLock>,
) -> Result<Vec<SyncResult>, String> {
    let Ok(_lock_guard) = sync_lock.0.try_lock() else {
        // Another sync is already in progress; skip this run to prevent race conditions
        return Ok(Vec::new());
    };

    let client = {
        let auth = auth_state.lock().await;
        auth.client().clone()
    };

    // Find all book_ids that have pending progress, bookmarks, or annotations,
    // excluding purely local unmapped books to prevent infinite sync loops.
    let pending_progress_books = sqlx::query_scalar::<_, String>(
        "SELECT bp.book_id FROM book_progress bp
         WHERE bp.sync_status = 'pending'
         AND (
             bp.book_id GLOB '[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*'
             OR EXISTS (SELECT 1 FROM book_mappings bm WHERE (bm.local_id = bp.book_id OR bm.file_path = bp.book_id) AND bm.server_book_id != '')
         )",
    )
    .fetch_all(&*db)
    .await
    .unwrap_or_default();

    let pending_bookmark_books = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT b.book_id FROM bookmarks b
         WHERE b.sync_status LIKE 'pending%'
         AND (
             b.book_id GLOB '[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*'
             OR EXISTS (SELECT 1 FROM book_mappings bm WHERE (bm.local_id = b.book_id OR bm.file_path = b.book_id) AND bm.server_book_id != '')
         )",
    )
    .fetch_all(&*db)
    .await
    .unwrap_or_default();

    let pending_annotation_books = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT a.book_id FROM annotations a
         WHERE a.sync_status LIKE 'pending%'
         AND (
             a.book_id GLOB '[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*'
             OR EXISTS (SELECT 1 FROM book_mappings bm WHERE (bm.local_id = a.book_id OR bm.file_path = a.book_id) AND bm.server_book_id != '')
         )",
    )
    .fetch_all(&*db)
    .await
    .unwrap_or_default();

    let pending_session_books = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT s.book_id FROM reading_sessions s
         WHERE s.sync_status = 'pending'
         AND (
             s.book_id GLOB '[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*'
             OR EXISTS (SELECT 1 FROM book_mappings bm WHERE (bm.local_id = s.book_id OR bm.file_path = s.book_id) AND bm.server_book_id != '')
         )",
    )
    .fetch_all(&*db)
    .await
    .unwrap_or_default();

    let mut all_book_ids = std::collections::HashSet::new();
    all_book_ids.extend(pending_progress_books);
    all_book_ids.extend(pending_bookmark_books);
    all_book_ids.extend(pending_annotation_books);
    all_book_ids.extend(pending_session_books);

    let mut results = Vec::new();
    for book_id in all_book_ids {
        match sync_manager::sync_book(&db, &client, &server_url, token.as_deref(), &book_id).await {
            Ok(res) => results.push(res),
            // The token was rejected: every other book would fail the same way, and the
            // caller has to know that nothing was synced
            Err(e) if sync_manager::is_unauthorized(&e) => return Err(e),
            Err(e) => results.push(SyncResult {
                success: false,
                message: e,
                progress_synced: false,
                bookmarks_synced: 0,
                annotations_synced: 0,
                sessions_synced: 0,
            }),
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn db_clear_all_data(
    db: State<'_, DbPool>,
    sync_lock: State<'_, sync_manager::SyncLock>,
) -> Result<(), String> {
    // The data is cleared for another account: a sync still running for the previous one
    // must finish first, or it would write its rows into the emptied database
    let _lock_guard = sync_lock.0.lock().await;
    db::clear_all_data(&db).await.map_err(|e| e.to_string())
}

// ================= LOCAL BOOKS METADATA COMMANDS =================

#[tauri::command]
pub async fn db_save_local_book_meta(
    book_id: String,
    file_path: String,
    title: String,
    author: String,
    cover_path: Option<String>,
    extracted: Option<bool>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    validate_non_empty(&book_id, "book_id")?;
    validate_non_empty(&title, "title")?;

    let resolved_file_path = if file_path.trim().is_empty() {
        db::get_file_path_for_book(&db, &book_id)
            .await
            .ok()
            .flatten()
            .unwrap_or_default()
    } else {
        file_path
    };

    if resolved_file_path.trim().is_empty() {
        return Ok(());
    }

    db::save_local_book_meta(
        &db,
        &book_id,
        &resolved_file_path,
        &title,
        &author,
        cover_path.as_deref(),
        extracted.unwrap_or(true),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_all_local_books_meta(
    db: State<'_, DbPool>,
) -> Result<Vec<DbLocalBookMeta>, String> {
    db::get_all_local_books_meta(&db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_local_book_meta(
    book_id: String,
    db: State<'_, DbPool>,
) -> Result<Option<DbLocalBookMeta>, String> {
    db::get_local_book_meta(&db, &book_id)
        .await
        .map_err(|e| e.to_string())
}

// ================= RECENT BOOKS COMMANDS =================

#[tauri::command]
pub async fn db_save_recent_book(book: DbRecentBook, db: State<'_, DbPool>) -> Result<(), String> {
    db::save_recent_book(&db, &book)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_recent_books(
    limit: Option<i64>,
    db: State<'_, DbPool>,
) -> Result<Vec<DbRecentBook>, String> {
    let l = limit.unwrap_or(100);
    db::get_recent_books(&db, l)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_remove_recent_book(id: String, db: State<'_, DbPool>) -> Result<(), String> {
    db::remove_recent_book(&db, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_update_recent_book_meta(
    id: String,
    title: Option<String>,
    author: Option<String>,
    cover_path: Option<String>,
    cover_url: Option<String>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    db::update_recent_book_meta(
        &db,
        &id,
        title.as_deref(),
        author.as_deref(),
        cover_path.as_deref(),
        cover_url.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

// ================= APP KEY/VALUE COMMANDS =================

#[tauri::command]
pub async fn db_set_app_kv(
    key: String,
    value: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    db::set_app_kv(&db, &key, &value)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_app_kv(key: String, db: State<'_, DbPool>) -> Result<Option<String>, String> {
    db::get_app_kv(&db, &key).await.map_err(|e| e.to_string())
}

// ================= READING SESSIONS COMMANDS =================

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn db_save_reading_session(
    book_id: String,
    device_name: Option<String>,
    start_time: String,
    end_time: String,
    duration_seconds: i32,
    start_progress: Option<f32>,
    end_progress: Option<f32>,
    pages_read: Option<i32>,
    db: State<'_, DbPool>,
) -> Result<DbReadingSession, String> {
    validate_non_empty(&book_id, "book_id")?;
    validate_non_empty(&start_time, "start_time")?;
    validate_non_empty(&end_time, "end_time")?;
    if !(0..=86400 * 7).contains(&duration_seconds) {
        return Err("Field 'duration_seconds' must be between 0 and 604800".to_string());
    }

    let start_progress = sanitize_session_progress(start_progress)?;
    let end_progress = sanitize_session_progress(end_progress)?;

    db::save_reading_session(
        &db,
        &book_id,
        device_name.as_deref(),
        &start_time,
        &end_time,
        duration_seconds,
        start_progress,
        end_progress,
        pages_read.unwrap_or(0),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_book_reading_stats(
    book_id: String,
    db: State<'_, DbPool>,
) -> Result<DbBookReadingStats, String> {
    db::get_book_reading_stats(&db, &book_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_delete_book_reading_stats(
    book_id: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    db::delete_book_reading_stats(&db, &book_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_progress_percent_range_0_to_100() {
        assert_eq!(sanitize_progress_percent(0.0).unwrap(), 0.0);
        assert_eq!(sanitize_progress_percent(0.5).unwrap(), 0.5);
        assert_eq!(sanitize_progress_percent(35.4).unwrap(), 35.4);
        assert_eq!(sanitize_progress_percent(100.0).unwrap(), 100.0);
        assert_eq!(sanitize_progress_percent(105.0).unwrap(), 100.0);
        assert!(sanitize_progress_percent(-0.1).is_err());
        assert!(sanitize_progress_percent(f32::NAN).is_err());
    }

    #[test]
    fn test_sanitize_session_progress_range_0_to_100() {
        assert_eq!(sanitize_session_progress(None).unwrap(), None);
        assert_eq!(sanitize_session_progress(Some(0.0)).unwrap(), Some(0.0));
        assert_eq!(sanitize_session_progress(Some(42.5)).unwrap(), Some(42.5));
        assert_eq!(sanitize_session_progress(Some(100.0)).unwrap(), Some(100.0));
        assert_eq!(
            sanitize_session_progress(Some(100.001)).unwrap(),
            Some(100.0)
        );
        assert!(sanitize_session_progress(Some(-1.0)).is_err());
        assert!(sanitize_session_progress(Some(f32::NAN)).is_err());
    }
}
