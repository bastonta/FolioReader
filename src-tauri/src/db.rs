use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{
    Pool, Sqlite,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use std::path::Path;
use std::str::FromStr;

pub type DbPool = Pool<Sqlite>;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbBookProgress {
    pub book_id: String,
    pub location: String,
    pub progress_percent: f32,
    pub is_read: bool,
    pub updated_at: String,
    pub sync_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbBookmark {
    pub id: String,
    pub server_id: Option<String>,
    pub book_id: String,
    pub location: String,
    pub fraction: f32,
    pub location_label: Option<String>,
    pub chapter_title: Option<String>,
    pub created_at: String,
    pub is_deleted: bool,
    pub sync_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbAnnotation {
    pub id: String,
    pub server_id: Option<String>,
    pub book_id: String,
    pub location_start: String,
    pub location_end: String,
    pub value: String,
    pub selected_text: String,
    pub note: Option<String>,
    pub color: String,
    pub style: Option<String>,
    pub chapter_title: Option<String>,
    pub section_index: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
    pub is_deleted: bool,
    pub sync_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbBookMapping {
    pub local_id: String,
    pub server_book_id: String,
    pub file_path: Option<String>,
    pub created_at: String,
}

pub async fn init_db(db_path: &Path) -> Result<DbPool, sqlx::Error> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let db_str = db_path.to_str().unwrap_or("folio_local.db");
    let options =
        SqliteConnectOptions::from_str(&format!("sqlite://{db_str}"))?.create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // Create tables
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS book_mappings (
            local_id TEXT PRIMARY KEY,
            server_book_id TEXT NOT NULL,
            file_path TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_book_mappings_server_id ON book_mappings(server_book_id);
        CREATE INDEX IF NOT EXISTS idx_book_mappings_file_path ON book_mappings(file_path);

        CREATE TABLE IF NOT EXISTS book_progress (
            book_id TEXT PRIMARY KEY,
            location TEXT NOT NULL,
            progress_percent REAL NOT NULL DEFAULT 0.0,
            is_read INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            sync_status TEXT NOT NULL DEFAULT 'synced'
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
            id TEXT PRIMARY KEY,
            server_id TEXT UNIQUE,
            book_id TEXT NOT NULL,
            location TEXT NOT NULL,
            fraction REAL NOT NULL DEFAULT 0.0,
            location_label TEXT,
            chapter_title TEXT,
            created_at TEXT NOT NULL,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            sync_status TEXT NOT NULL DEFAULT 'synced'
        );
        CREATE INDEX IF NOT EXISTS idx_bookmarks_book_id ON bookmarks(book_id);

        CREATE TABLE IF NOT EXISTS annotations (
            id TEXT PRIMARY KEY,
            server_id TEXT UNIQUE,
            book_id TEXT NOT NULL,
            location_start TEXT NOT NULL,
            location_end TEXT NOT NULL,
            value TEXT NOT NULL,
            selected_text TEXT NOT NULL,
            note TEXT,
            color TEXT NOT NULL DEFAULT 'yellow',
            style TEXT DEFAULT 'highlight',
            chapter_title TEXT,
            section_index INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            sync_status TEXT NOT NULL DEFAULT 'synced'
        );
        CREATE INDEX IF NOT EXISTS idx_annotations_book_id ON annotations(book_id);
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}

// ================= BOOK MAPPINGS REPO =================

pub async fn save_book_mapping(
    pool: &DbPool,
    local_id: &str,
    server_book_id: &str,
    file_path: Option<&str>,
) -> Result<(), sqlx::Error> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO book_mappings (local_id, server_book_id, file_path, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(local_id) DO UPDATE SET
            server_book_id = CASE WHEN excluded.server_book_id != '' THEN excluded.server_book_id ELSE book_mappings.server_book_id END,
            file_path = COALESCE(excluded.file_path, book_mappings.file_path)
        "#,
    )
    .bind(local_id)
    .bind(server_book_id)
    .bind(file_path)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn get_server_book_id(
    pool: &DbPool,
    book_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    if uuid::Uuid::parse_str(book_id).is_ok() {
        return Ok(Some(book_id.to_string()));
    }

    let mapping = sqlx::query_as::<_, DbBookMapping>(
        "SELECT local_id, server_book_id, file_path, created_at FROM book_mappings WHERE (local_id = ? OR file_path = ?) AND server_book_id != '' LIMIT 1",
    )
    .bind(book_id)
    .bind(book_id)
    .fetch_optional(pool)
    .await?;

    Ok(mapping.map(|m| m.server_book_id))
}

pub async fn get_local_id_by_server_id(
    pool: &DbPool,
    server_book_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_scalar::<_, String>(
        "SELECT local_id FROM book_mappings WHERE server_book_id = ? LIMIT 1",
    )
    .bind(server_book_id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

pub async fn get_file_path_for_book(
    pool: &DbPool,
    book_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_scalar::<_, Option<String>>(
        "SELECT file_path FROM book_mappings WHERE local_id = ? OR server_book_id = ? LIMIT 1",
    )
    .bind(book_id)
    .bind(book_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.flatten())
}

// ================= PROGRESS REPO =================

pub async fn get_progress(
    pool: &DbPool,
    book_id: &str,
) -> Result<Option<DbBookProgress>, sqlx::Error> {
    let server_id = get_server_book_id(pool, book_id).await.unwrap_or(None);
    let local_id = if uuid::Uuid::parse_str(book_id).is_ok() {
        get_local_id_by_server_id(pool, book_id)
            .await
            .unwrap_or(None)
    } else {
        None
    };

    let s_id = server_id.as_deref().unwrap_or(book_id);
    let l_id = local_id.as_deref().unwrap_or(book_id);

    sqlx::query_as::<_, DbBookProgress>(
        "SELECT book_id, location, progress_percent, is_read != 0 AS is_read, updated_at, sync_status FROM book_progress WHERE book_id = ? OR book_id = ? OR book_id = ? ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(book_id)
    .bind(s_id)
    .bind(l_id)
    .fetch_optional(pool)
    .await
}

pub async fn save_progress(
    pool: &DbPool,
    book_id: &str,
    location: &str,
    progress_percent: f32,
    is_read: bool,
    mark_pending: bool,
) -> Result<DbBookProgress, sqlx::Error> {
    let now = Utc::now().to_rfc3339();
    let sync_status = if mark_pending { "pending" } else { "synced" };

    sqlx::query(
        r#"
        INSERT INTO book_progress (book_id, location, progress_percent, is_read, updated_at, sync_status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(book_id) DO UPDATE SET
            location = excluded.location,
            progress_percent = excluded.progress_percent,
            is_read = excluded.is_read,
            updated_at = excluded.updated_at,
            sync_status = excluded.sync_status
        "#,
    )
    .bind(book_id)
    .bind(location)
    .bind(progress_percent)
    .bind(if is_read { 1 } else { 0 })
    .bind(&now)
    .bind(sync_status)
    .execute(pool)
    .await?;

    Ok(DbBookProgress {
        book_id: book_id.to_string(),
        location: location.to_string(),
        progress_percent,
        is_read,
        updated_at: now,
        sync_status: sync_status.to_string(),
    })
}

pub async fn delete_progress(pool: &DbPool, book_id: &str) -> Result<(), sqlx::Error> {
    let server_id = get_server_book_id(pool, book_id).await.unwrap_or(None);
    let local_id = if uuid::Uuid::parse_str(book_id).is_ok() {
        get_local_id_by_server_id(pool, book_id)
            .await
            .unwrap_or(None)
    } else {
        None
    };

    let s_id = server_id.as_deref().unwrap_or(book_id);
    let l_id = local_id.as_deref().unwrap_or(book_id);

    sqlx::query("DELETE FROM book_progress WHERE book_id = ? OR book_id = ? OR book_id = ?")
        .bind(book_id)
        .bind(s_id)
        .bind(l_id)
        .execute(pool)
        .await?;

    Ok(())
}

// ================= BOOKMARKS REPO =================

pub async fn get_bookmarks(pool: &DbPool, book_id: &str) -> Result<Vec<DbBookmark>, sqlx::Error> {
    let server_id = get_server_book_id(pool, book_id).await.unwrap_or(None);
    let local_id = if uuid::Uuid::parse_str(book_id).is_ok() {
        get_local_id_by_server_id(pool, book_id)
            .await
            .unwrap_or(None)
    } else {
        None
    };

    let s_id = server_id.as_deref().unwrap_or(book_id);
    let l_id = local_id.as_deref().unwrap_or(book_id);

    sqlx::query_as::<_, DbBookmark>(
        r#"
        SELECT id, server_id, book_id, location, fraction, location_label, chapter_title,
               created_at, is_deleted != 0 AS is_deleted, sync_status
        FROM bookmarks
        WHERE (book_id = ? OR book_id = ? OR book_id = ?) AND is_deleted = 0
        ORDER BY created_at DESC
        "#,
    )
    .bind(book_id)
    .bind(s_id)
    .bind(l_id)
    .fetch_all(pool)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_bookmark(
    pool: &DbPool,
    id: &str,
    server_id: Option<&str>,
    book_id: &str,
    location: &str,
    fraction: f32,
    location_label: Option<&str>,
    chapter_title: Option<&str>,
    created_at: Option<&str>,
    mark_pending: bool,
) -> Result<DbBookmark, sqlx::Error> {
    let now = created_at
        .map(|s| s.to_string())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let sync_status = if mark_pending {
        "pending_create"
    } else {
        "synced"
    };

    sqlx::query(
        r#"
        INSERT INTO bookmarks (id, server_id, book_id, location, fraction, location_label, chapter_title, created_at, is_deleted, sync_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
            server_id = COALESCE(excluded.server_id, bookmarks.server_id),
            location = excluded.location,
            fraction = excluded.fraction,
            location_label = excluded.location_label,
            chapter_title = excluded.chapter_title,
            is_deleted = 0,
            sync_status = excluded.sync_status
        "#,
    )
    .bind(id)
    .bind(server_id)
    .bind(book_id)
    .bind(location)
    .bind(fraction)
    .bind(location_label)
    .bind(chapter_title)
    .bind(&now)
    .bind(sync_status)
    .execute(pool)
    .await?;

    Ok(DbBookmark {
        id: id.to_string(),
        server_id: server_id.map(|s| s.to_string()),
        book_id: book_id.to_string(),
        location: location.to_string(),
        fraction,
        location_label: location_label.map(|s| s.to_string()),
        chapter_title: chapter_title.map(|s| s.to_string()),
        created_at: now,
        is_deleted: false,
        sync_status: sync_status.to_string(),
    })
}

pub async fn delete_bookmark(pool: &DbPool, id: &str) -> Result<(), sqlx::Error> {
    let item = sqlx::query_as::<_, DbBookmark>(
        "SELECT id, server_id, book_id, location, fraction, location_label, chapter_title, created_at, is_deleted != 0 AS is_deleted, sync_status FROM bookmarks WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    if let Some(bm) = item {
        if bm.server_id.is_none() && bm.sync_status == "pending_create" {
            sqlx::query("DELETE FROM bookmarks WHERE id = ?")
                .bind(id)
                .execute(pool)
                .await?;
        } else {
            sqlx::query(
                "UPDATE bookmarks SET is_deleted = 1, sync_status = 'pending_delete' WHERE id = ?",
            )
            .bind(id)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

// ================= ANNOTATIONS REPO =================

pub async fn get_annotations(
    pool: &DbPool,
    book_id: &str,
) -> Result<Vec<DbAnnotation>, sqlx::Error> {
    let server_id = get_server_book_id(pool, book_id).await.unwrap_or(None);
    let local_id = if uuid::Uuid::parse_str(book_id).is_ok() {
        get_local_id_by_server_id(pool, book_id)
            .await
            .unwrap_or(None)
    } else {
        None
    };

    let s_id = server_id.as_deref().unwrap_or(book_id);
    let l_id = local_id.as_deref().unwrap_or(book_id);

    sqlx::query_as::<_, DbAnnotation>(
        r#"
        SELECT id, server_id, book_id, location_start, location_end, value, selected_text,
               note, color, style, chapter_title, section_index, created_at, updated_at,
               is_deleted != 0 AS is_deleted, sync_status
        FROM annotations
        WHERE (book_id = ? OR book_id = ? OR book_id = ?) AND is_deleted = 0
        ORDER BY created_at DESC
        "#,
    )
    .bind(book_id)
    .bind(s_id)
    .bind(l_id)
    .fetch_all(pool)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_annotation(
    pool: &DbPool,
    id: &str,
    server_id: Option<&str>,
    book_id: &str,
    location_start: &str,
    location_end: &str,
    value: &str,
    selected_text: &str,
    note: Option<&str>,
    color: &str,
    style: Option<&str>,
    chapter_title: Option<&str>,
    section_index: Option<i32>,
    created_at: Option<&str>,
    mark_pending: bool,
) -> Result<DbAnnotation, sqlx::Error> {
    let now = Utc::now().to_rfc3339();
    let created = created_at.unwrap_or(&now);
    let sync_status = if mark_pending {
        "pending_create"
    } else {
        "synced"
    };

    sqlx::query(
        r#"
        INSERT INTO annotations (
            id, server_id, book_id, location_start, location_end, value, selected_text,
            note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted, sync_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
            server_id = COALESCE(excluded.server_id, annotations.server_id),
            location_start = excluded.location_start,
            location_end = excluded.location_end,
            value = excluded.value,
            selected_text = excluded.selected_text,
            note = excluded.note,
            color = excluded.color,
            style = excluded.style,
            chapter_title = excluded.chapter_title,
            section_index = excluded.section_index,
            updated_at = excluded.updated_at,
            is_deleted = 0,
            sync_status = excluded.sync_status
        "#,
    )
    .bind(id)
    .bind(server_id)
    .bind(book_id)
    .bind(location_start)
    .bind(location_end)
    .bind(value)
    .bind(selected_text)
    .bind(note)
    .bind(color)
    .bind(style.unwrap_or("highlight"))
    .bind(chapter_title)
    .bind(section_index)
    .bind(created)
    .bind(&now)
    .bind(sync_status)
    .execute(pool)
    .await?;

    Ok(DbAnnotation {
        id: id.to_string(),
        server_id: server_id.map(|s| s.to_string()),
        book_id: book_id.to_string(),
        location_start: location_start.to_string(),
        location_end: location_end.to_string(),
        value: value.to_string(),
        selected_text: selected_text.to_string(),
        note: note.map(|s| s.to_string()),
        color: color.to_string(),
        style: style.map(|s| s.to_string()),
        chapter_title: chapter_title.map(|s| s.to_string()),
        section_index,
        created_at: created.to_string(),
        updated_at: now,
        is_deleted: false,
        sync_status: sync_status.to_string(),
    })
}

pub async fn delete_annotation(pool: &DbPool, id_or_value: &str) -> Result<(), sqlx::Error> {
    let item = sqlx::query_as::<_, DbAnnotation>(
        r#"
        SELECT id, server_id, book_id, location_start, location_end, value, selected_text,
               note, color, style, chapter_title, section_index, created_at, updated_at,
               is_deleted != 0 AS is_deleted, sync_status
        FROM annotations
        WHERE id = ? OR value = ?
        "#,
    )
    .bind(id_or_value)
    .bind(id_or_value)
    .fetch_optional(pool)
    .await?;

    if let Some(ann) = item {
        if ann.server_id.is_none() && ann.sync_status == "pending_create" {
            sqlx::query("DELETE FROM annotations WHERE id = ?")
                .bind(&ann.id)
                .execute(pool)
                .await?;
        } else {
            sqlx::query("UPDATE annotations SET is_deleted = 1, sync_status = 'pending_delete' WHERE id = ?")
                .bind(&ann.id)
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}

pub async fn clear_all_data(pool: &DbPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        DELETE FROM bookmarks;
        DELETE FROM annotations;
        DELETE FROM book_progress;
        DELETE FROM book_mappings;
        VACUUM;
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_db_crud_operations() {
        let pool = init_db(Path::new(":memory:"))
            .await
            .expect("init memory db");

        // 1. Progress
        let book_id = "test-book-1";
        let saved_prog = save_progress(&pool, book_id, "epubcfi(/6/4!/4/2:0)", 35.5, false, true)
            .await
            .expect("save progress");
        assert_eq!(saved_prog.book_id, book_id);
        assert_eq!(saved_prog.progress_percent, 35.5);
        assert_eq!(saved_prog.sync_status, "pending");

        let loaded_prog = get_progress(&pool, book_id)
            .await
            .expect("get progress")
            .expect("must exist");
        assert_eq!(loaded_prog.location, "epubcfi(/6/4!/4/2:0)");

        // 2. Bookmarks
        let bm_id = "bm-1";
        let saved_bm = save_bookmark(
            &pool,
            bm_id,
            None,
            book_id,
            "epubcfi(/6/4!/4/2:10)",
            0.35,
            Some("Page 42"),
            Some("Chapter 1"),
            None,
            true,
        )
        .await
        .expect("save bookmark");
        assert_eq!(saved_bm.id, bm_id);
        assert_eq!(saved_bm.chapter_title.as_deref(), Some("Chapter 1"));

        let bms = get_bookmarks(&pool, book_id).await.expect("get bookmarks");
        assert_eq!(bms.len(), 1);

        delete_bookmark(&pool, bm_id)
            .await
            .expect("delete bookmark");
        let bms_after = get_bookmarks(&pool, book_id)
            .await
            .expect("get bookmarks after delete");
        assert_eq!(bms_after.len(), 0);

        // 3. Annotations
        let ann_id = "ann-1";
        let saved_ann = save_annotation(
            &pool,
            ann_id,
            None,
            book_id,
            "epubcfi(/6/4!/4/2:10)",
            "epubcfi(/6/4!/4/2:50)",
            "epubcfi(/6/4!/4/2:10,/4/2:50)",
            "Highlighted text sample",
            Some("My personal note"),
            "yellow",
            Some("highlight"),
            Some("Chapter 1"),
            Some(2),
            None,
            true,
        )
        .await
        .expect("save annotation");
        assert_eq!(saved_ann.id, ann_id);
        assert_eq!(saved_ann.note.as_deref(), Some("My personal note"));

        let anns = get_annotations(&pool, book_id)
            .await
            .expect("get annotations");
        assert_eq!(anns.len(), 1);

        delete_annotation(&pool, ann_id)
            .await
            .expect("delete annotation");
        let anns_after = get_annotations(&pool, book_id)
            .await
            .expect("get annotations after delete");
        assert_eq!(anns_after.len(), 0);

        // 4. Book mappings
        let local_id = "local-book_chapter1_epub";
        let server_id = "c032646a-7963-4903-b09e-716474f8ebbc";
        let file_path = "/home/user/Books/chapter1.epub";

        save_book_mapping(&pool, local_id, server_id, Some(file_path))
            .await
            .expect("save book mapping");

        let resolved_server_id = get_server_book_id(&pool, local_id)
            .await
            .expect("get server book id")
            .expect("must exist");
        assert_eq!(resolved_server_id, server_id);

        let resolved_local_id = get_local_id_by_server_id(&pool, server_id)
            .await
            .expect("get local book id")
            .expect("must exist");
        assert_eq!(resolved_local_id, local_id);

        // 5. Clear all data
        clear_all_data(&pool).await.expect("clear all data");

        let prog_after_clear = get_progress(&pool, book_id)
            .await
            .expect("get progress after clear");
        assert!(prog_after_clear.is_none());

        let mapping_after_clear = get_server_book_id(&pool, local_id)
            .await
            .expect("get mapping after clear");
        assert!(mapping_after_clear.is_none());
    }
}
