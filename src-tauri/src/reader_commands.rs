use crate::auth_proxy::AuthHttpClientState;
use crate::db::{
    self, DbAnnotation, DbBookProgress, DbBookReadingStats, DbBookmark, DbLocalBookMeta, DbPool,
    DbReadingSession, DbRecentBook,
};
use crate::sync_manager::{self, PullProgressResult, SyncResult};
use tauri::State;

#[tauri::command]
pub async fn db_save_book_mapping(
    local_id: String,
    server_book_id: String,
    file_path: Option<String>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    db::save_book_mapping(&db, &local_id, &server_book_id, file_path.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_server_book_id(
    book_id: String,
    db: State<'_, DbPool>,
) -> Result<Option<String>, String> {
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

#[tauri::command]
pub async fn db_save_progress(
    book_id: String,
    location: String,
    progress_percent: f32,
    is_read: bool,
    db: State<'_, DbPool>,
) -> Result<DbBookProgress, String> {
    db::save_progress(&db, &book_id, &location, progress_percent, is_read, true)
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
    db::delete_bookmark(&db, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_annotations(
    book_id: String,
    db: State<'_, DbPool>,
) -> Result<Vec<DbAnnotation>, String> {
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
    db: State<'_, DbPool>,
) -> Result<(), String> {
    db::delete_annotation(&db, &id_or_value)
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
) -> Result<SyncResult, String> {
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
) -> Result<Vec<SyncResult>, String> {
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
        if let Ok(res) =
            sync_manager::sync_book(&db, &client, &server_url, token.as_deref(), &book_id).await
        {
            results.push(res);
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn db_clear_all_data(db: State<'_, DbPool>) -> Result<(), String> {
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
    db::save_local_book_meta(
        &db,
        &book_id,
        &file_path,
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
