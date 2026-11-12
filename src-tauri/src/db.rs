use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{
    AssertSqlSafe, Pool, Sqlite,
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

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbLocalBookMeta {
    pub book_id: String,
    pub file_path: String,
    pub title: String,
    pub author: String,
    pub cover_path: Option<String>,
    pub extracted: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbRecentBook {
    pub id: String,
    pub title: String,
    pub author: String,
    pub cover_path: Option<String>,
    pub cover_url: Option<String>,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub last_location: Option<String>,
    pub progress_fraction: f32,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbReadingSession {
    pub id: String,
    pub client_session_id: String,
    pub book_id: String,
    pub device_name: Option<String>,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: i32,
    pub start_progress: Option<f32>,
    pub end_progress: Option<f32>,
    pub pages_read: i32,
    pub sync_status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbDeviceStats {
    pub device_name: String,
    pub duration_seconds: i64,
    pub session_count: i64,
    pub percentage: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbBookReadingStats {
    pub book_id: String,
    pub total_duration_seconds: i64,
    pub session_count: i64,
    pub total_pages_read: i64,
    pub average_seconds_per_page: Option<f32>,
    pub estimated_remaining_seconds: Option<i64>,
    pub first_read_at: Option<String>,
    pub last_read_at: Option<String>,
    pub device_breakdown: Vec<DbDeviceStats>,
}

/// Path that opens a database kept in memory only.
const IN_MEMORY_DB: &str = ":memory:";

/// `app_kv` key set when the database file could not be used and the application runs on
/// a database in memory: nothing it stores survives a restart. The value is the error.
pub const STORAGE_ERROR_KEY: &str = "db:storage_error";

pub async fn init_db(db_path: &Path) -> Result<DbPool, sqlx::Error> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let db_str = db_path.to_str().unwrap_or("folio_local.db");
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{db_str}"))?
        .create_if_missing(true)
        .pragma("foreign_keys", "ON")
        .pragma("journal_mode", "WAL")
        .pragma("synchronous", "NORMAL");

    let mut pool_options = SqlitePoolOptions::new().max_connections(5);
    if db_str == IN_MEMORY_DB {
        // An in-memory database exists only while a connection to it is open: the pool
        // must never let the last one go (idle connections are closed after ten minutes)
        pool_options = pool_options
            .min_connections(1)
            .idle_timeout(None)
            .max_lifetime(None);
    }
    let pool = pool_options.connect_with(options).await?;

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
            server_id TEXT,
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
            server_id TEXT,
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

        CREATE TABLE IF NOT EXISTS local_books_metadata (
            book_id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            cover_path TEXT,
            extracted INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_local_books_metadata_file_path ON local_books_metadata(file_path);

        CREATE TABLE IF NOT EXISTS recent_books (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            cover_path TEXT,
            cover_url TEXT,
            file_path TEXT,
            file_name TEXT,
            file_size INTEGER,
            last_location TEXT,
            progress_fraction REAL NOT NULL DEFAULT 0.0,
            last_opened_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_recent_books_last_opened ON recent_books(last_opened_at DESC);

        CREATE TABLE IF NOT EXISTS app_kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reading_sessions (
            id TEXT PRIMARY KEY,
            client_session_id TEXT NOT NULL,
            book_id TEXT NOT NULL,
            device_name TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL,
            start_progress REAL,
            end_progress REAL,
            pages_read INTEGER DEFAULT 0,
            sync_status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reading_sessions_book_id ON reading_sessions(book_id);
        CREATE INDEX IF NOT EXISTS idx_reading_sessions_sync_status ON reading_sessions(sync_status);

        -- Local EPUBs assembled on device from server chapters (`Chapters` kind): which part
        -- of which server book a local file holds (`volume` NULL: the whole book)...
        CREATE TABLE IF NOT EXISTS chapter_copies (
            local_id TEXT PRIMARY KEY,
            server_book_id TEXT NOT NULL,
            volume REAL,
            chapters_before INTEGER NOT NULL DEFAULT 0,
            book_chapters INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_chapter_copies_server_id ON chapter_copies(server_book_id);

        -- ...and its reading order: `position` is the spine index of the chapter in that file.
        CREATE TABLE IF NOT EXISTS chapter_copy_chapters (
            local_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (local_id, chapter_id)
        );
        CREATE INDEX IF NOT EXISTS idx_chapter_copy_chapters_position ON chapter_copy_chapters(local_id, position);
        "#,
    )
    .execute(&pool)
    .await?;

    // Schema migrations. A failure leaves the previous schema in place (each step runs in
    // a transaction) and must not keep the application from starting.
    if let Err(e) = relax_server_id_uniqueness(&pool).await {
        eprintln!("Failed to migrate bookmark/annotation indexes: {e}");
    }
    if let Err(e) = migrate_chapter_layouts(&pool).await {
        eprintln!("Failed to migrate chapter layouts: {e}");
    }

    if let Err(e) = normalize_progress_timestamps(&pool).await {
        eprintln!("Failed to normalize progress timestamps: {e}");
    }
    if let Err(e) = fix_legacy_progress_fractions(&pool).await {
        eprintln!("Failed to fix legacy progress fractions: {e}");
    }

    Ok(pool)
}

/// Whether the error says the file is not a usable SQLite database (`SQLITE_CORRUPT`,
/// `SQLITE_NOTADB`), as opposed to a database that is merely busy or out of reach.
fn is_corruption(error: &sqlx::Error) -> bool {
    let Some(database_error) = error.as_database_error() else {
        return false;
    };
    let primary_code = database_error
        .code()
        .and_then(|code| code.parse::<i32>().ok())
        .map(|code| code & 0xff);
    matches!(primary_code, Some(11) | Some(26))
        || database_error.message().contains("malformed")
        || database_error.message().contains("not a database")
}

/// [`init_db`] that does not leave the application crashing on every start. A database
/// file that is damaged is set aside (`*.corrupt-<time>`, nothing is deleted) and a new
/// one is created. If the database still cannot be opened, the application runs on an
/// in-memory one: it starts, and the file on disk is left for a later start. That state
/// is recorded under [`STORAGE_ERROR_KEY`] for the interface to show.
pub async fn init_db_or_recover(db_path: &Path) -> Result<DbPool, sqlx::Error> {
    let mut error = match init_db(db_path).await {
        Ok(pool) => return Ok(pool),
        Err(error) => error,
    };
    eprintln!("Failed to open the local database: {error}");

    if is_corruption(&error) {
        let stamp = Utc::now().format("%Y%m%d%H%M%S");
        for suffix in ["", "-wal", "-shm"] {
            let file = format!("{}{suffix}", db_path.display());
            if Path::new(&file).exists() {
                let _ = std::fs::rename(
                    &file,
                    format!("{}.corrupt-{stamp}{suffix}", db_path.display()),
                );
            }
        }
        match init_db(db_path).await {
            Ok(pool) => return Ok(pool),
            Err(recreate_error) => {
                eprintln!("Failed to recreate the local database: {recreate_error}");
                error = recreate_error;
            }
        }
    }

    let pool = init_db(Path::new(IN_MEMORY_DB)).await?;
    set_app_kv(&pool, STORAGE_ERROR_KEY, &error.to_string()).await?;
    Ok(pool)
}

// ================= SCHEMA MIGRATIONS =================

async fn table_sql(pool: &DbPool, table: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .bind(table)
    .fetch_optional(pool)
    .await
}

/// Early versions stored the reading fraction (0..1) where a percentage belongs. Such rows
/// carry exactly the number the recent books list has as a fraction. The repair runs once
/// per database: genuine progress below 1% (a few chapters of a book with thousands) must
/// never be "repaired" on a later start.
async fn fix_legacy_progress_fractions(pool: &DbPool) -> Result<(), sqlx::Error> {
    const DONE_KEY: &str = "migration:legacy_progress_fractions";
    if get_app_kv(pool, DONE_KEY).await?.is_some() {
        return Ok(());
    }

    sqlx::query(
        r#"
        UPDATE book_progress
        SET progress_percent = (
            SELECT rb.progress_fraction * 100.0
            FROM recent_books rb
            LEFT JOIN book_mappings bm ON bm.local_id = rb.id OR bm.server_book_id = rb.id
            WHERE (rb.id = book_progress.book_id OR bm.local_id = book_progress.book_id OR bm.server_book_id = book_progress.book_id)
              AND rb.progress_fraction > 0.01
              AND ABS(rb.progress_fraction - book_progress.progress_percent) < 0.0005
            LIMIT 1
        )
        WHERE is_read = 0
          AND progress_percent > 0.0
          AND progress_percent <= 1.0
          AND EXISTS (
            SELECT 1
            FROM recent_books rb
            LEFT JOIN book_mappings bm ON bm.local_id = rb.id OR bm.server_book_id = rb.id
            WHERE (rb.id = book_progress.book_id OR bm.local_id = book_progress.book_id OR bm.server_book_id = book_progress.book_id)
              AND rb.progress_fraction > 0.01
              AND ABS(rb.progress_fraction - book_progress.progress_percent) < 0.0005
          )
        "#,
    )
    .execute(pool)
    .await?;

    set_app_kv(pool, DONE_KEY, "done").await
}

// ================= TIMESTAMPS =================
//
// `book_progress.updated_at` is the time the position actually changed: the local clock
// for a position the user read to, the server's `updatedAt` for a position taken from the
// server. It decides which side wins when both changed, so it is kept in one fixed-width
// UTC format whose text order is the chronological order.

pub fn format_timestamp(time: chrono::DateTime<Utc>) -> String {
    time.to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}

pub fn parse_timestamp(value: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value.trim())
        .ok()
        .map(|time| time.with_timezone(&Utc))
}

/// Any RFC 3339 timestamp in the format of [`format_timestamp`].
pub fn normalize_timestamp(value: &str) -> Option<String> {
    parse_timestamp(value).map(format_timestamp)
}

/// Rewrites progress timestamps written by earlier versions (`+00:00`, variable precision).
async fn normalize_progress_timestamps(pool: &DbPool) -> Result<(), sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT book_id, updated_at FROM book_progress WHERE updated_at NOT LIKE '____-__-__T__:__:__.______Z'",
    )
    .fetch_all(pool)
    .await?;
    for (book_id, updated_at) in rows {
        // A value that is not a timestamp loses against everything
        let normalized = normalize_timestamp(&updated_at)
            .unwrap_or_else(|| format_timestamp(chrono::DateTime::UNIX_EPOCH));
        sqlx::query("UPDATE book_progress SET updated_at = ? WHERE book_id = ? AND updated_at = ?")
            .bind(normalized)
            .bind(&book_id)
            .bind(&updated_at)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Bookmarks and annotations used to carry a table-wide `UNIQUE` server id. Two local
/// copies of one server book (the whole book next to one of its volumes) both hold the
/// same server item, so the id is now unique per local book only.
async fn relax_server_id_uniqueness(pool: &DbPool) -> Result<(), sqlx::Error> {
    const BOOKMARK_COLUMNS: &str = "id, server_id, book_id, location, fraction, location_label, chapter_title, created_at, is_deleted, sync_status";
    const ANNOTATION_COLUMNS: &str = "id, server_id, book_id, location_start, location_end, value, selected_text, note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted, sync_status";

    let rebuilds = [
        (
            "bookmarks",
            BOOKMARK_COLUMNS,
            r#"CREATE TABLE bookmarks_rebuilt (
                id TEXT PRIMARY KEY,
                server_id TEXT,
                book_id TEXT NOT NULL,
                location TEXT NOT NULL,
                fraction REAL NOT NULL DEFAULT 0.0,
                location_label TEXT,
                chapter_title TEXT,
                created_at TEXT NOT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                sync_status TEXT NOT NULL DEFAULT 'synced'
            )"#,
        ),
        (
            "annotations",
            ANNOTATION_COLUMNS,
            r#"CREATE TABLE annotations_rebuilt (
                id TEXT PRIMARY KEY,
                server_id TEXT,
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
            )"#,
        ),
    ];

    for (table, columns, create_rebuilt) in rebuilds {
        let has_table_wide_unique = table_sql(pool, table)
            .await?
            .is_some_and(|sql| sql.contains("server_id TEXT UNIQUE"));
        if has_table_wide_unique {
            let mut tx = pool.begin().await?;
            // Table and column names come from the constants above, never from data
            sqlx::query(AssertSqlSafe(format!(
                "DROP TABLE IF EXISTS {table}_rebuilt"
            )))
            .execute(&mut *tx)
            .await?;
            sqlx::query(create_rebuilt).execute(&mut *tx).await?;
            sqlx::query(AssertSqlSafe(format!(
                "INSERT INTO {table}_rebuilt ({columns}) SELECT {columns} FROM {table}"
            )))
            .execute(&mut *tx)
            .await?;
            sqlx::query(AssertSqlSafe(format!("DROP TABLE {table}")))
                .execute(&mut *tx)
                .await?;
            sqlx::query(AssertSqlSafe(format!(
                "ALTER TABLE {table}_rebuilt RENAME TO {table}"
            )))
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
        }

        sqlx::query(AssertSqlSafe(format!(
            "CREATE INDEX IF NOT EXISTS idx_{table}_book_id ON {table}(book_id)"
        )))
        .execute(pool)
        .await?;
        sqlx::query(AssertSqlSafe(format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_book_server_id ON {table}(book_id, server_id)"
        )))
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// Chapter layouts used to be keyed by server book id (`chapter_book_chapters`): one copy
/// per book. They move to the local file that holds them, together with the reading
/// state that was mirrored under the server id.
async fn migrate_chapter_layouts(pool: &DbPool) -> Result<(), sqlx::Error> {
    if table_sql(pool, "chapter_book_chapters").await?.is_none() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO chapter_copies (local_id, server_book_id, volume, chapters_before, book_chapters)
        SELECT bm.local_id, bm.server_book_id, NULL, 0,
               (SELECT COUNT(*) FROM chapter_book_chapters c WHERE c.server_book_id = bm.server_book_id)
        FROM book_mappings bm
        WHERE bm.server_book_id IN (SELECT DISTINCT server_book_id FROM chapter_book_chapters);

        INSERT OR IGNORE INTO chapter_copy_chapters (local_id, chapter_id, position)
        SELECT bm.local_id, c.chapter_id, c.position
        FROM chapter_book_chapters c
        JOIN book_mappings bm ON bm.server_book_id = c.server_book_id;

        INSERT OR IGNORE INTO book_progress (book_id, location, progress_percent, is_read, updated_at, sync_status)
        SELECT cc.local_id, bp.location, bp.progress_percent, bp.is_read, bp.updated_at, bp.sync_status
        FROM book_progress bp
        JOIN chapter_copies cc ON cc.server_book_id = bp.book_id;
        DELETE FROM book_progress WHERE book_id IN (SELECT server_book_id FROM chapter_copies);

        UPDATE OR IGNORE bookmarks
        SET book_id = (SELECT cc.local_id FROM chapter_copies cc WHERE cc.server_book_id = bookmarks.book_id LIMIT 1)
        WHERE book_id IN (SELECT server_book_id FROM chapter_copies);
        UPDATE OR IGNORE annotations
        SET book_id = (SELECT cc.local_id FROM chapter_copies cc WHERE cc.server_book_id = annotations.book_id LIMIT 1)
        WHERE book_id IN (SELECT server_book_id FROM chapter_copies);
        UPDATE reading_sessions
        SET book_id = (SELECT cc.local_id FROM chapter_copies cc WHERE cc.server_book_id = reading_sessions.book_id LIMIT 1)
        WHERE book_id IN (SELECT server_book_id FROM chapter_copies);

        DROP TABLE chapter_book_chapters;
        "#,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

// ================= BOOK MAPPINGS REPO =================

/// Records which server book a local file is (an empty `server_book_id` only records the
/// file). A local id that is already bound to a server book is never rebound to another
/// one: its reading state would silently start syncing into that other book. Returns
/// `false` when such a binding was left as it is.
pub async fn save_book_mapping(
    pool: &DbPool,
    local_id: &str,
    server_book_id: &str,
    file_path: Option<&str>,
) -> Result<bool, sqlx::Error> {
    if !server_book_id.is_empty() {
        let bound = sqlx::query_scalar::<_, String>(
            "SELECT server_book_id FROM book_mappings WHERE local_id = ? LIMIT 1",
        )
        .bind(local_id)
        .fetch_optional(pool)
        .await?;
        if bound.is_some_and(|bound| !bound.is_empty() && bound != server_book_id) {
            return Ok(false);
        }
    }

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

    if !server_book_id.is_empty() {
        // Promote any records previously marked 'local_only' back to 'pending' so they will sync to server
        let _ = sqlx::query(
            "UPDATE book_progress SET sync_status = 'pending' WHERE (book_id = ? OR book_id = ?) AND sync_status = 'local_only'",
        )
        .bind(local_id)
        .bind(server_book_id)
        .execute(pool)
        .await;

        let _ = sqlx::query(
            "UPDATE bookmarks SET sync_status = 'pending_create' WHERE (book_id = ? OR book_id = ?) AND sync_status = 'local_only'",
        )
        .bind(local_id)
        .bind(server_book_id)
        .execute(pool)
        .await;

        let _ = sqlx::query(
            "UPDATE annotations SET sync_status = 'pending_create' WHERE (book_id = ? OR book_id = ?) AND sync_status = 'local_only'",
        )
        .bind(local_id)
        .bind(server_book_id)
        .execute(pool)
        .await;

        let _ = sqlx::query(
            "UPDATE reading_sessions SET sync_status = 'pending' WHERE (book_id = ? OR book_id = ?) AND sync_status = 'local_only'",
        )
        .bind(local_id)
        .bind(server_book_id)
        .execute(pool)
        .await;
    }

    Ok(true)
}

/// The server book a local id is bound to in `book_mappings` (`None`: not bound).
pub async fn get_bound_server_book_id(
    pool: &DbPool,
    local_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let bound = sqlx::query_scalar::<_, String>(
        "SELECT server_book_id FROM book_mappings WHERE local_id = ? LIMIT 1",
    )
    .bind(local_id)
    .fetch_optional(pool)
    .await?;
    Ok(bound.filter(|id| !id.is_empty()))
}

/// Local id recorded for a file. The id is derived from the path of the file relative to
/// the download folder at the time it was first seen; the recorded one must be used from
/// then on, or the reading state of the file is lost when the folder setting changes.
pub async fn get_local_id_for_file(
    pool: &DbPool,
    file_path: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT bm.local_id FROM book_mappings bm
        WHERE bm.file_path = ?
        ORDER BY (bm.local_id IN (SELECT local_id FROM chapter_copies)) DESC,
                 (bm.server_book_id != '') DESC,
                 bm.created_at ASC
        LIMIT 1
        "#,
    )
    .bind(file_path)
    .fetch_optional(pool)
    .await
}

/// [`get_local_id_for_file`] for every recorded file, as `file path -> local id`.
pub async fn get_local_ids_by_file(
    pool: &DbPool,
) -> Result<std::collections::HashMap<String, String>, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT bm.file_path, bm.local_id FROM book_mappings bm
        WHERE bm.file_path IS NOT NULL AND bm.file_path != ''
        ORDER BY (bm.local_id IN (SELECT local_id FROM chapter_copies)) DESC,
                 (bm.server_book_id != '') DESC,
                 bm.created_at ASC
        "#,
    )
    .fetch_all(pool)
    .await?;
    let mut result = std::collections::HashMap::new();
    for (file_path, local_id) in rows {
        // The first row of a file is the preferred one
        result.entry(file_path).or_insert(local_id);
    }
    Ok(result)
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

    if let Some(Some(fp)) = row
        && !fp.is_empty()
    {
        return Ok(Some(fp));
    }

    let meta_fp = sqlx::query_scalar::<_, Option<String>>(
        "SELECT file_path FROM local_books_metadata WHERE book_id = ? LIMIT 1",
    )
    .bind(book_id)
    .fetch_optional(pool)
    .await?;

    if let Some(Some(fp)) = meta_fp
        && !fp.is_empty()
    {
        return Ok(Some(fp));
    }

    let recent_fp = sqlx::query_scalar::<_, Option<String>>(
        "SELECT file_path FROM recent_books WHERE id = ? LIMIT 1",
    )
    .bind(book_id)
    .fetch_optional(pool)
    .await?;

    Ok(recent_fp.flatten())
}

/// Other ids the rows of a book may be stored under, as (server id, local id); either
/// falls back to `book_id` itself.
///
/// A book downloaded as a file keeps its reading state under its local id and under the
/// server id alike. A copy built from chapters keeps it under its own local id only:
/// several copies of one server book (the whole book, single volumes) address different
/// files, and a position stored by one must never be opened in another.
async fn related_row_ids(pool: &DbPool, book_id: &str) -> (String, String) {
    let copy_scoped = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM chapter_copies WHERE local_id = ? OR server_book_id = ? LIMIT 1",
    )
    .bind(book_id)
    .bind(book_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None)
    .is_some();
    if copy_scoped {
        return (book_id.to_string(), book_id.to_string());
    }

    let server_id = get_server_book_id(pool, book_id).await.unwrap_or(None);
    let local_id = if uuid::Uuid::parse_str(book_id).is_ok() {
        get_local_id_by_server_id(pool, book_id)
            .await
            .unwrap_or(None)
    } else {
        None
    };
    (
        server_id.unwrap_or_else(|| book_id.to_string()),
        local_id.unwrap_or_else(|| book_id.to_string()),
    )
}

#[derive(sqlx::FromRow)]
struct DownloadedMappingRow {
    server_book_id: String,
    file_path: String,
}

pub async fn check_downloaded_books(
    pool: &DbPool,
    server_book_ids: &[String],
) -> Result<std::collections::HashMap<String, String>, sqlx::Error> {
    let mut result = std::collections::HashMap::new();
    if server_book_ids.is_empty() {
        return Ok(result);
    }

    for chunk in server_book_ids.chunks(100) {
        let mut builder: sqlx::QueryBuilder<sqlx::Sqlite> = sqlx::QueryBuilder::new(
            // A copy that holds a single volume of a `Chapters` book is not "the book":
            // those are listed by `get_chapter_copies_of_books`.
            "SELECT server_book_id, file_path FROM book_mappings WHERE file_path IS NOT NULL AND file_path != '' AND local_id NOT IN (SELECT local_id FROM chapter_copies WHERE volume IS NOT NULL) AND server_book_id IN (",
        );
        let mut separated = builder.separated(", ");
        for id in chunk {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");

        let rows = builder
            .build_query_as::<DownloadedMappingRow>()
            .fetch_all(pool)
            .await?;
        for row in rows {
            if std::path::Path::new(&row.file_path).is_file() {
                result.insert(row.server_book_id, row.file_path);
            }
        }
    }

    Ok(result)
}

// ================= PROGRESS REPO =================

pub async fn get_progress(
    pool: &DbPool,
    book_id: &str,
) -> Result<Option<DbBookProgress>, sqlx::Error> {
    let (s_id, l_id) = related_row_ids(pool, book_id).await;
    let (s_id, l_id) = (s_id.as_str(), l_id.as_str());

    sqlx::query_as::<_, DbBookProgress>(
        "SELECT book_id, location, progress_percent, is_read != 0 AS is_read, updated_at, sync_status FROM book_progress WHERE book_id = ? OR book_id = ? OR book_id = ? ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(book_id)
    .bind(s_id)
    .bind(l_id)
    .fetch_optional(pool)
    .await
}

/// Stores a reading position. With `mark_pending` it is a position the user read to: it
/// gets the current time as its change time and waits to be pushed. Saving the position
/// that is already stored changes nothing — re-saving on close or when the app goes to
/// the background must not turn an old position into a new change.
pub async fn save_progress(
    pool: &DbPool,
    book_id: &str,
    location: &str,
    progress_percent: f32,
    is_read: bool,
    mark_pending: bool,
) -> Result<DbBookProgress, sqlx::Error> {
    save_progress_at(
        pool,
        book_id,
        location,
        progress_percent,
        is_read,
        mark_pending,
        None,
    )
    .await
}

/// [`save_progress`] with an explicit change time (the server's `updatedAt` for a
/// position that came from the server). A local change is never dated before the state
/// it replaces, whatever the clocks say.
pub async fn save_progress_at(
    pool: &DbPool,
    book_id: &str,
    location: &str,
    progress_percent: f32,
    is_read: bool,
    mark_pending: bool,
    updated_at: Option<&str>,
) -> Result<DbBookProgress, sqlx::Error> {
    let mut changed_at = updated_at
        .and_then(parse_timestamp)
        .unwrap_or_else(Utc::now);

    let sync_status = if mark_pending {
        let current = get_progress(pool, book_id).await?;
        if let Some(current) = current {
            let unchanged = current.location == location
                && current.is_read == is_read
                && (current.progress_percent - progress_percent).abs() < 0.0001;
            if unchanged {
                return Ok(current);
            }
            if let Some(previous) = parse_timestamp(&current.updated_at)
                && previous >= changed_at
            {
                changed_at = previous + chrono::Duration::milliseconds(1);
            }
        }

        let is_mapped = uuid::Uuid::parse_str(book_id).is_ok()
            || sqlx::query_scalar::<_, i32>(
                "SELECT COUNT(1) FROM book_mappings WHERE (local_id = ? OR file_path = ?) AND server_book_id != ''",
            )
            .bind(book_id)
            .bind(book_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0) > 0;

        if !is_mapped {
            let existing_status = sqlx::query_scalar::<_, String>(
                "SELECT sync_status FROM book_progress WHERE book_id = ? LIMIT 1",
            )
            .bind(book_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

            if existing_status.as_deref() == Some("local_only") {
                "local_only"
            } else {
                "pending"
            }
        } else {
            "pending"
        }
    } else {
        "synced"
    };
    let now = format_timestamp(changed_at);

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

/// Marks the position that was pushed to the server as synced. `snapshot_updated_at` is
/// the change time of the position the request was built from: a position saved while
/// the request was in flight is newer and stays pending (`false` is returned).
///
/// `server_updated_at` is the time the server stored for the position (`None`: it did
/// not say, or nothing was sent). It becomes the change time of the local position: the
/// next pull compares against what the server holds, not against the clock of this
/// device, which may run ahead of the server's.
///
/// The rows of the book under its other id that are not newer are brought to the same
/// state: the newest row is the position of the book, and it must stay the pushed one.
pub async fn mark_progress_synced(
    pool: &DbPool,
    book_id: &str,
    alias_id: &str,
    snapshot_updated_at: &str,
    server_updated_at: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let recorded = server_updated_at
        .and_then(normalize_timestamp)
        .unwrap_or_else(|| snapshot_updated_at.to_string());

    let mut tx = pool.begin().await?;
    let pushed: Option<(String, f32, i64)> = sqlx::query_as(
        "SELECT location, progress_percent, is_read FROM book_progress WHERE (book_id = ? OR book_id = ?) AND updated_at = ? AND sync_status != 'synced' LIMIT 1",
    )
    .bind(book_id)
    .bind(alias_id)
    .bind(snapshot_updated_at)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((location, progress_percent, is_read)) = pushed else {
        return Ok(false);
    };

    sqlx::query(
        "UPDATE book_progress SET location = ?, progress_percent = ?, is_read = ?, updated_at = ?, sync_status = 'synced' WHERE (book_id = ? OR book_id = ?) AND updated_at <= ?",
    )
    .bind(location)
    .bind(progress_percent)
    .bind(is_read)
    .bind(&recorded)
    .bind(book_id)
    .bind(alias_id)
    .bind(snapshot_updated_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

/// Replaces the local position with the state of the server (`sync_status = 'synced'`),
/// under `book_id` and `alias_id` alike. Nothing is written when the local position
/// changed after `snapshot_updated_at` (the change time of the local position the
/// decision was based on; `None`: there was none): that change stays pending. Returns
/// whether the server state was stored.
#[allow(clippy::too_many_arguments)]
pub async fn adopt_remote_progress(
    pool: &DbPool,
    book_id: &str,
    alias_id: &str,
    snapshot_updated_at: Option<&str>,
    location: &str,
    progress_percent: f32,
    is_read: bool,
    remote_updated_at: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let snapshot = snapshot_updated_at.unwrap_or("");
    // The change time of the adopted position is the server's (see `mark_progress_synced`)
    let updated_at = remote_updated_at
        .and_then(normalize_timestamp)
        .unwrap_or_else(|| {
            if snapshot.is_empty() {
                format_timestamp(Utc::now())
            } else {
                snapshot.to_string()
            }
        });

    let mut tx = pool.begin().await?;
    let mut stored = false;
    let ids: &[&str] = if alias_id == book_id {
        &[book_id]
    } else {
        &[book_id, alias_id]
    };
    for id in ids {
        let written = sqlx::query(
            r#"
            INSERT INTO book_progress (book_id, location, progress_percent, is_read, updated_at, sync_status)
            SELECT ?, ?, ?, ?, ?, 'synced'
            WHERE NOT EXISTS (
                SELECT 1 FROM book_progress
                WHERE (book_id = ? OR book_id = ?) AND sync_status != 'synced' AND updated_at > ?
            )
            ON CONFLICT(book_id) DO UPDATE SET
                location = excluded.location,
                progress_percent = excluded.progress_percent,
                is_read = excluded.is_read,
                updated_at = excluded.updated_at,
                sync_status = excluded.sync_status
            "#,
        )
        .bind(id)
        .bind(location)
        .bind(progress_percent)
        .bind(if is_read { 1 } else { 0 })
        .bind(&updated_at)
        .bind(book_id)
        .bind(alias_id)
        .bind(snapshot)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        stored |= written > 0;
    }
    tx.commit().await?;
    Ok(stored)
}

pub async fn delete_progress(pool: &DbPool, book_id: &str) -> Result<(), sqlx::Error> {
    let (s_id, l_id) = related_row_ids(pool, book_id).await;
    let (s_id, l_id) = (s_id.as_str(), l_id.as_str());

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
    let (s_id, l_id) = related_row_ids(pool, book_id).await;
    let (s_id, l_id) = (s_id.as_str(), l_id.as_str());

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
    let (s_id, l_id) = related_row_ids(pool, book_id).await;
    let (s_id, l_id) = (s_id.as_str(), l_id.as_str());

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
            sync_status = CASE
                WHEN excluded.sync_status = 'synced' THEN 'synced'
                WHEN annotations.server_id IS NOT NULL THEN 'pending_update'
                ELSE 'pending_create'
            END
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

/// Deletes an annotation by its id or by its CFI range (`value`). The same range exists
/// in many books (and in every copy of one book), so a match by value is limited to
/// `book_id`. Without `book_id` it is limited to the book of the annotation whose id was
/// given; a bare range is then accepted only while a single book has it.
pub async fn delete_annotation(
    pool: &DbPool,
    id_or_value: &str,
    book_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    const COLUMNS: &str = "id, server_id, book_id, location_start, location_end, value, selected_text, note, color, style, chapter_title, section_index, created_at, updated_at, is_deleted != 0 AS is_deleted, sync_status";

    let items = match book_id {
        Some(book_id) => {
            let (s_id, l_id) = related_row_ids(pool, book_id).await;
            sqlx::query_as::<_, DbAnnotation>(AssertSqlSafe(format!(
                r#"
                SELECT {COLUMNS}
                FROM annotations
                WHERE (book_id = ? OR book_id = ? OR book_id = ?)
                  AND (id = ? OR value = ? OR (value != '' AND value IN (SELECT a2.value FROM annotations a2 WHERE a2.id = ? AND a2.book_id = annotations.book_id)))
                  AND is_deleted = 0
                "#
            )))
            .bind(book_id)
            .bind(s_id)
            .bind(l_id)
            .bind(id_or_value)
            .bind(id_or_value)
            .bind(id_or_value)
            .fetch_all(pool)
            .await?
        }
        None => {
            let by_id = sqlx::query_as::<_, DbAnnotation>(AssertSqlSafe(format!(
                r#"
                SELECT {COLUMNS}
                FROM annotations
                WHERE (id = ? OR (value != '' AND value IN (SELECT a2.value FROM annotations a2 WHERE a2.id = ? AND a2.book_id = annotations.book_id)))
                  AND is_deleted = 0
                "#
            )))
            .bind(id_or_value)
            .bind(id_or_value)
            .fetch_all(pool)
            .await?;
            if by_id.is_empty() {
                annotations_of_single_book(pool, id_or_value, COLUMNS).await?
            } else {
                by_id
            }
        }
    };

    for ann in items {
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

/// Live annotations with the CFI range `value`, when all of them belong to one book
/// (under its local id or its server id); none when several books have that range.
async fn annotations_of_single_book(
    pool: &DbPool,
    value: &str,
    columns: &str,
) -> Result<Vec<DbAnnotation>, sqlx::Error> {
    let items = sqlx::query_as::<_, DbAnnotation>(AssertSqlSafe(format!(
        "SELECT {columns} FROM annotations WHERE value = ? AND value != '' AND is_deleted = 0"
    )))
    .bind(value)
    .fetch_all(pool)
    .await?;
    let Some(first) = items.first() else {
        return Ok(items);
    };
    let (s_id, l_id) = related_row_ids(pool, &first.book_id).await;
    let same_book = items
        .iter()
        .all(|a| a.book_id == first.book_id || a.book_id == s_id || a.book_id == l_id);
    Ok(if same_book { items } else { Vec::new() })
}

// ================= LOCAL BOOKS METADATA REPO =================

pub async fn save_local_book_meta(
    pool: &DbPool,
    book_id: &str,
    file_path: &str,
    title: &str,
    author: &str,
    cover_path: Option<&str>,
    extracted: bool,
) -> Result<(), sqlx::Error> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO local_books_metadata (book_id, file_path, title, author, cover_path, extracted, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(book_id) DO UPDATE SET
            file_path = excluded.file_path,
            title = excluded.title,
            author = excluded.author,
            cover_path = COALESCE(excluded.cover_path, local_books_metadata.cover_path),
            extracted = excluded.extracted,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(book_id)
    .bind(file_path)
    .bind(title)
    .bind(author)
    .bind(cover_path)
    .bind(if extracted { 1 } else { 0 })
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn get_all_local_books_meta(pool: &DbPool) -> Result<Vec<DbLocalBookMeta>, sqlx::Error> {
    let mut rows = sqlx::query_as::<_, DbLocalBookMeta>(
        "SELECT book_id, file_path, title, author, cover_path, extracted != 0 AS extracted, updated_at FROM local_books_metadata",
    )
    .fetch_all(pool)
    .await?;

    for row in &mut rows {
        if let Some(ref path) = row.cover_path
            && !Path::new(path).is_file()
        {
            row.cover_path = None;
        }
    }

    Ok(rows)
}

pub async fn get_local_book_meta(
    pool: &DbPool,
    book_id: &str,
) -> Result<Option<DbLocalBookMeta>, sqlx::Error> {
    let mut item = sqlx::query_as::<_, DbLocalBookMeta>(
        "SELECT book_id, file_path, title, author, cover_path, extracted != 0 AS extracted, updated_at FROM local_books_metadata WHERE book_id = ? LIMIT 1",
    )
    .bind(book_id)
    .fetch_optional(pool)
    .await?;

    if let Some(ref mut row) = item
        && let Some(ref path) = row.cover_path
        && !Path::new(path).is_file()
    {
        row.cover_path = None;
    }

    Ok(item)
}

// ================= RECENT BOOKS REPO =================

pub async fn save_recent_book(pool: &DbPool, book: &DbRecentBook) -> Result<(), sqlx::Error> {
    let now = if book.last_opened_at.is_empty() {
        Utc::now().to_rfc3339()
    } else {
        book.last_opened_at.clone()
    };
    sqlx::query(
        r#"
        INSERT INTO recent_books (id, title, author, cover_path, cover_url, file_path, file_name, file_size, last_location, progress_fraction, last_opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            author = excluded.author,
            cover_path = COALESCE(excluded.cover_path, recent_books.cover_path),
            cover_url = COALESCE(excluded.cover_url, recent_books.cover_url),
            file_path = COALESCE(excluded.file_path, recent_books.file_path),
            file_name = COALESCE(excluded.file_name, recent_books.file_name),
            file_size = COALESCE(excluded.file_size, recent_books.file_size),
            last_location = COALESCE(excluded.last_location, recent_books.last_location),
            progress_fraction = excluded.progress_fraction,
            last_opened_at = excluded.last_opened_at
        "#,
    )
    .bind(&book.id)
    .bind(&book.title)
    .bind(&book.author)
    .bind(&book.cover_path)
    .bind(&book.cover_url)
    .bind(&book.file_path)
    .bind(&book.file_name)
    .bind(book.file_size)
    .bind(&book.last_location)
    .bind(book.progress_fraction)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn get_recent_books(pool: &DbPool, limit: i64) -> Result<Vec<DbRecentBook>, sqlx::Error> {
    let mut rows = sqlx::query_as::<_, DbRecentBook>(
        "SELECT id, title, author, cover_path, cover_url, file_path, file_name, file_size, last_location, progress_fraction, last_opened_at FROM recent_books ORDER BY last_opened_at DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    for row in &mut rows {
        if let Some(ref path) = row.cover_path
            && !Path::new(path).is_file()
        {
            row.cover_path = None;
        }
    }

    Ok(rows)
}

pub async fn remove_recent_book(pool: &DbPool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM recent_books WHERE id = ? OR file_path = ?")
        .bind(id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_recent_book_meta(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    author: Option<&str>,
    cover_path: Option<&str>,
    cover_url: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE recent_books
        SET
            title = COALESCE(?, title),
            author = COALESCE(?, author),
            cover_path = COALESCE(?, cover_path),
            cover_url = COALESCE(?, cover_url)
        WHERE id = ?
        "#,
    )
    .bind(title)
    .bind(author)
    .bind(cover_path)
    .bind(cover_url)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

// ================= APP KEY/VALUE REPO =================

pub async fn set_app_kv(pool: &DbPool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO app_kv (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(key)
    .bind(value)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_app_kv(pool: &DbPool, key: &str) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_scalar::<_, String>("SELECT value FROM app_kv WHERE key = ? LIMIT 1")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

// ================= READING SESSIONS REPO =================

#[allow(clippy::too_many_arguments)]
pub async fn save_reading_session(
    pool: &DbPool,
    book_id: &str,
    device_name: Option<&str>,
    start_time: &str,
    end_time: &str,
    duration_seconds: i32,
    start_progress: Option<f32>,
    end_progress: Option<f32>,
    pages_read: i32,
) -> Result<DbReadingSession, sqlx::Error> {
    let id = uuid::Uuid::now_v7().to_string();
    let client_session_id = uuid::Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();

    let is_mapped = uuid::Uuid::parse_str(book_id).is_ok()
        || sqlx::query_scalar::<_, i32>(
            "SELECT COUNT(1) FROM book_mappings WHERE (local_id = ? OR file_path = ?) AND server_book_id != ''",
        )
        .bind(book_id)
        .bind(book_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0) > 0;

    let sync_status = if !is_mapped {
        let is_local_only = sqlx::query_scalar::<_, String>(
            "SELECT sync_status FROM book_progress WHERE book_id = ? LIMIT 1",
        )
        .bind(book_id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

        if is_local_only.as_deref() == Some("local_only") {
            "local_only"
        } else {
            "pending"
        }
    } else {
        "pending"
    };

    let session = sqlx::query_as::<_, DbReadingSession>(
        r#"
        INSERT INTO reading_sessions (
            id, client_session_id, book_id, device_name,
            start_time, end_time, duration_seconds,
            start_progress, end_progress, pages_read,
            sync_status, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
        "#,
    )
    .bind(&id)
    .bind(&client_session_id)
    .bind(book_id)
    .bind(device_name)
    .bind(start_time)
    .bind(end_time)
    .bind(duration_seconds)
    .bind(start_progress)
    .bind(end_progress)
    .bind(pages_read)
    .bind(sync_status)
    .bind(&now)
    .fetch_one(pool)
    .await?;

    Ok(session)
}

pub async fn get_pending_reading_sessions(
    pool: &DbPool,
    limit: i64,
) -> Result<Vec<DbReadingSession>, sqlx::Error> {
    let sessions = sqlx::query_as::<_, DbReadingSession>(
        r#"
        SELECT * FROM reading_sessions
        WHERE sync_status = 'pending'
        ORDER BY start_time ASC
        LIMIT ?
        "#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(sessions)
}

pub async fn mark_reading_sessions_synced(
    pool: &DbPool,
    ids: &[String],
) -> Result<(), sqlx::Error> {
    for id in ids {
        sqlx::query(
            r#"
            UPDATE reading_sessions
            SET sync_status = 'synced'
            WHERE id = ?
            "#,
        )
        .bind(id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn get_book_reading_stats(
    pool: &DbPool,
    book_id: &str,
) -> Result<DbBookReadingStats, sqlx::Error> {
    let (s_id, l_id) = related_row_ids(pool, book_id).await;
    let (s_id, l_id) = (s_id.as_str(), l_id.as_str());

    #[derive(sqlx::FromRow)]
    struct StatsRow {
        total_duration: Option<i64>,
        session_count: Option<i64>,
        total_pages_read: Option<i64>,
        first_read_at: Option<String>,
        last_read_at: Option<String>,
    }

    let row = sqlx::query_as::<_, StatsRow>(
        r#"
        SELECT 
            COALESCE(SUM(duration_seconds), 0) AS total_duration,
            COUNT(*) AS session_count,
            COALESCE(SUM(pages_read), 0) AS total_pages_read,
            MIN(start_time) AS first_read_at,
            MAX(end_time) AS last_read_at
        FROM reading_sessions
        WHERE book_id = ? OR book_id = ? OR book_id = ?
        "#,
    )
    .bind(book_id)
    .bind(s_id)
    .bind(l_id)
    .fetch_one(pool)
    .await?;

    let total_duration_seconds = row.total_duration.unwrap_or(0);
    let session_count = row.session_count.unwrap_or(0);
    let total_pages_read = row.total_pages_read.unwrap_or(0);

    let average_seconds_per_page = if total_pages_read > 0 && total_duration_seconds > 0 {
        Some((total_duration_seconds as f32) / (total_pages_read as f32))
    } else {
        None
    };

    #[derive(sqlx::FromRow)]
    struct DeviceRow {
        device_name: Option<String>,
        duration: Option<i64>,
        session_count: Option<i64>,
    }

    let device_rows = sqlx::query_as::<_, DeviceRow>(
        r#"
        SELECT 
            COALESCE(device_name, 'FolioReader') AS device_name,
            COALESCE(SUM(duration_seconds), 0) AS duration,
            COUNT(*) AS session_count
        FROM reading_sessions
        WHERE book_id = ? OR book_id = ? OR book_id = ?
        GROUP BY COALESCE(device_name, 'FolioReader')
        ORDER BY duration DESC
        "#,
    )
    .bind(book_id)
    .bind(s_id)
    .bind(l_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let device_breakdown = device_rows
        .into_iter()
        .map(|r| {
            let dur = r.duration.unwrap_or(0);
            let pct = if total_duration_seconds > 0 {
                ((dur as f32) / (total_duration_seconds as f32)) * 100.0
            } else {
                0.0
            };
            DbDeviceStats {
                device_name: r.device_name.unwrap_or_else(|| "FolioReader".to_string()),
                duration_seconds: dur,
                session_count: r.session_count.unwrap_or(0),
                percentage: pct,
            }
        })
        .collect();

    Ok(DbBookReadingStats {
        book_id: book_id.to_string(),
        total_duration_seconds,
        session_count,
        total_pages_read,
        average_seconds_per_page,
        estimated_remaining_seconds: None,
        first_read_at: row.first_read_at,
        last_read_at: row.last_read_at,
        device_breakdown,
    })
}

pub async fn delete_book_reading_stats(pool: &DbPool, book_id: &str) -> Result<(), sqlx::Error> {
    let (s_id, l_id) = related_row_ids(pool, book_id).await;
    let (s_id, l_id) = (s_id.as_str(), l_id.as_str());

    sqlx::query(
        r#"
        DELETE FROM reading_sessions
        WHERE book_id = ? OR book_id = ? OR book_id = ?
        "#,
    )
    .bind(book_id)
    .bind(s_id)
    .bind(l_id)
    .execute(pool)
    .await?;

    Ok(())
}

// ================= CHAPTERS BOOKS REPO =================
//
// `Chapters` books have no file on the server: the reader builds EPUBs from their
// chapters, one spine item per chapter — the whole book in one file, or one file per
// volume. Every such file is a *copy*: `chapter_copies` records which part of which
// server book a local file holds, `chapter_copy_chapters` which chapter sits at which
// spine position. With that, progress is exchanged with the server as `ch:<chapterId>`,
// locally stored CFIs survive a rebuild that shifts chapters, and several copies of one
// server book keep their reading state apart (see `related_row_ids`).

/// A local EPUB built from the chapters of a server book.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbChapterCopy {
    pub local_id: String,
    pub server_book_id: String,
    /// Volume the copy holds; `None` for a copy of the whole book.
    pub volume: Option<f32>,
    /// Chapters of the book in the volumes before this copy (0 for the whole book).
    pub chapters_before: i64,
    /// Chapters in the whole book when the copy was built.
    pub book_chapters: i64,
    /// Chapters in the copy itself.
    pub chapters_count: i64,
    pub file_path: Option<String>,
    /// Title the library shows for the file (a volume copy carries its volume).
    pub title: Option<String>,
}

impl DbChapterCopy {
    fn counts(&self) -> (usize, usize, usize) {
        let as_count = |n: i64| usize::try_from(n).unwrap_or(0);
        (
            as_count(self.chapters_before),
            as_count(self.chapters_count),
            as_count(self.book_chapters),
        )
    }

    /// Spine items between the start of the book and the start of this copy.
    pub fn spine_offset(&self) -> usize {
        if self.volume.is_some() {
            self.counts().0
        } else {
            0
        }
    }

    /// Whether the copy reaches the end of the book (always true for the whole book).
    pub fn ends_book(&self) -> bool {
        let (before, count, book) = self.counts();
        self.volume.is_none() || before + count >= book
    }

    /// Reading percentage inside this copy -> percentage of the whole book.
    pub fn to_book_percent(&self, percent: f32) -> f32 {
        if self.volume.is_none() {
            return percent;
        }
        let (before, count, book) = self.counts();
        crate::chapters_epub::copy_to_book_percent(percent, before, count, book)
    }

    /// Percentage of the whole book -> reading percentage inside this copy.
    pub fn to_copy_percent(&self, percent: f32) -> f32 {
        if self.volume.is_none() {
            return percent;
        }
        let (before, count, book) = self.counts();
        crate::chapters_epub::book_to_copy_percent(percent, before, count, book)
    }
}

/// Selects `DbChapterCopy` rows; a `WHERE` clause follows.
macro_rules! chapter_copy_select {
    ($tail:literal) => {
        concat!(
            "SELECT cc.local_id, cc.server_book_id, cc.volume, cc.chapters_before, cc.book_chapters, ",
            "(SELECT COUNT(*) FROM chapter_copy_chapters ch WHERE ch.local_id = cc.local_id) AS chapters_count, ",
            "bm.file_path, lbm.title ",
            "FROM chapter_copies cc ",
            "LEFT JOIN book_mappings bm ON bm.local_id = cc.local_id ",
            "LEFT JOIN local_books_metadata lbm ON lbm.book_id = cc.local_id ",
            $tail
        )
    };
}

/// All mappings of a server book (a book may have been downloaded to several places).
pub async fn get_book_mappings_by_server_id(
    pool: &DbPool,
    server_book_id: &str,
) -> Result<Vec<DbBookMapping>, sqlx::Error> {
    sqlx::query_as::<_, DbBookMapping>(
        "SELECT local_id, server_book_id, file_path, created_at FROM book_mappings WHERE server_book_id = ? ORDER BY created_at DESC",
    )
    .bind(server_book_id)
    .fetch_all(pool)
    .await
}

/// The copy stored under a local id; `None` for any other book.
pub async fn get_chapter_copy(
    pool: &DbPool,
    local_id: &str,
) -> Result<Option<DbChapterCopy>, sqlx::Error> {
    sqlx::query_as::<_, DbChapterCopy>(chapter_copy_select!("WHERE cc.local_id = ? LIMIT 1"))
        .bind(local_id)
        .fetch_optional(pool)
        .await
}

/// Copies of the given server books (whole books and single volumes), ordered by book and
/// volume with the whole book first. Files are not checked for existence here.
pub async fn get_chapter_copies_of_books(
    pool: &DbPool,
    server_book_ids: &[String],
) -> Result<Vec<DbChapterCopy>, sqlx::Error> {
    let mut result = Vec::new();
    for chunk in server_book_ids.chunks(100) {
        let mut builder: sqlx::QueryBuilder<sqlx::Sqlite> =
            sqlx::QueryBuilder::new(chapter_copy_select!("WHERE cc.server_book_id IN ("));
        let mut separated = builder.separated(", ");
        for id in chunk {
            separated.push_bind(id);
        }
        separated
            .push_unseparated(") ORDER BY cc.server_book_id, cc.volume IS NOT NULL, cc.volume");
        result.extend(
            builder
                .build_query_as::<DbChapterCopy>()
                .fetch_all(pool)
                .await?,
        );
    }
    Ok(result)
}

/// Whether the server book is read from copies built on device from its chapters.
pub async fn has_chapter_copies(pool: &DbPool, server_book_id: &str) -> Result<bool, sqlx::Error> {
    let found = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM chapter_copies WHERE server_book_id = ? LIMIT 1",
    )
    .bind(server_book_id)
    .fetch_optional(pool)
    .await?;
    Ok(found.is_some())
}

/// Records a freshly built copy: what it holds and its reading order. Returns the chapters
/// whose spine position changed since the previous build of the same file as
/// `old position -> new position`.
pub async fn save_chapter_copy(
    pool: &DbPool,
    local_id: &str,
    server_book_id: &str,
    volume: Option<f32>,
    chapters_before: usize,
    book_chapters: usize,
    chapter_ids: &[String],
) -> Result<std::collections::HashMap<usize, usize>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let old_rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT chapter_id, position FROM chapter_copy_chapters WHERE local_id = ?")
            .bind(local_id)
            .fetch_all(&mut *tx)
            .await?;
    let old: std::collections::HashMap<String, i64> = old_rows.into_iter().collect();

    let mut moved = std::collections::HashMap::new();
    for (new_position, chapter_id) in chapter_ids.iter().enumerate() {
        if let Some(&old_position) = old.get(chapter_id)
            && old_position >= 0
            && old_position as usize != new_position
        {
            moved.insert(old_position as usize, new_position);
        }
    }

    sqlx::query("DELETE FROM chapter_copy_chapters WHERE local_id = ?")
        .bind(local_id)
        .execute(&mut *tx)
        .await?;

    const CHUNK: usize = 200;
    for (chunk_index, chunk) in chapter_ids.chunks(CHUNK).enumerate() {
        let mut builder: sqlx::QueryBuilder<sqlx::Sqlite> = sqlx::QueryBuilder::new(
            "INSERT OR REPLACE INTO chapter_copy_chapters (local_id, chapter_id, position) ",
        );
        builder.push_values(chunk.iter().enumerate(), |mut row, (i, chapter_id)| {
            row.push_bind(local_id)
                .push_bind(chapter_id)
                .push_bind((chunk_index * CHUNK + i) as i64);
        });
        builder.build().execute(&mut *tx).await?;
    }

    sqlx::query(
        r#"
        INSERT INTO chapter_copies (local_id, server_book_id, volume, chapters_before, book_chapters)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(local_id) DO UPDATE SET
            server_book_id = excluded.server_book_id,
            volume = excluded.volume,
            chapters_before = excluded.chapters_before,
            book_chapters = excluded.book_chapters
        "#,
    )
    .bind(local_id)
    .bind(server_book_id)
    .bind(volume)
    .bind(chapters_before as i64)
    .bind(book_chapters as i64)
    .execute(&mut *tx)
    .await?;

    // The stored positions move together with the layout or not at all: a layout that
    // was saved without them would leave every CFI on the indexes of the previous build.
    remap_book_cfis_in(&mut tx, local_id, &moved).await?;

    if !old.is_empty() {
        rescale_copy_progress_in(&mut tx, local_id, &old, chapter_ids).await?;
    }

    tx.commit().await?;
    Ok(moved)
}

/// The percentage of a copy follows its chapter list: after an update added, removed or
/// reordered chapters, the stored percentage is recomputed for the chapter the reader is in
/// ([`crate::chapters_epub::rescale_percent`]) and queued for the server. A book that has
/// more chapters after the reading position than before is no longer read.
///
/// Runs after [`remap_book_cfis_in`]: the stored CFI already points at the new spine index.
/// The change is dated just after the stored position, not now: a newer position that
/// another device sent in the meantime keeps priority on the server.
async fn rescale_copy_progress_in(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    local_id: &str,
    old: &std::collections::HashMap<String, i64>,
    chapter_ids: &[String],
) -> Result<(), sqlx::Error> {
    let row: Option<(String, f32, bool, String, String)> = sqlx::query_as(
        "SELECT location, progress_percent, is_read != 0, updated_at, sync_status FROM book_progress WHERE book_id = ?",
    )
    .bind(local_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((location, percent, is_read, updated_at, sync_status)) = row else {
        return Ok(());
    };

    let Some(new_index) = crate::chapters_epub::cfi_spine_index(&location) else {
        return Ok(());
    };
    let Some(&old_index) = chapter_ids.get(new_index).and_then(|id| old.get(id)) else {
        return Ok(());
    };
    if old_index < 0 {
        return Ok(());
    }
    let (old_index, old_total) = (old_index as usize, old.len());
    let new_total = chapter_ids.len();

    let new_percent =
        crate::chapters_epub::rescale_percent(percent, old_index, old_total, new_index, new_total);
    let new_is_read = is_read && new_total - new_index <= old_total - old_index;
    if (new_percent - percent).abs() < 0.0001 && new_is_read == is_read {
        return Ok(());
    }

    let changed_at = parse_timestamp(&updated_at)
        .map(|t| t + chrono::Duration::milliseconds(1))
        .unwrap_or_else(Utc::now);
    let sync_status = if sync_status == "local_only" {
        "local_only"
    } else {
        "pending"
    };

    sqlx::query(
        "UPDATE book_progress SET progress_percent = ?, is_read = ?, updated_at = ?, sync_status = ? WHERE book_id = ?",
    )
    .bind(new_percent)
    .bind(if new_is_read { 1 } else { 0 })
    .bind(format_timestamp(changed_at))
    .bind(sync_status)
    .bind(local_id)
    .execute(&mut **tx)
    .await?;

    sqlx::query("UPDATE recent_books SET progress_fraction = ? WHERE id = ?")
        .bind(new_percent / 100.0)
        .bind(local_id)
        .execute(&mut **tx)
        .await?;

    Ok(())
}

/// Updates where a volume copy sits in its book (the server's list of volumes is the
/// source): chapters in the volumes before it and chapters in the whole book. The copy
/// itself — its file and its chapters — is not touched.
pub async fn update_chapter_copy_scope(
    pool: &DbPool,
    local_id: &str,
    chapters_before: usize,
    book_chapters: usize,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE chapter_copies SET chapters_before = ?, book_chapters = ? WHERE local_id = ? AND volume IS NOT NULL",
    )
    .bind(chapters_before as i64)
    .bind(book_chapters as i64)
    .bind(local_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// The server book is no longer read from locally built EPUBs (it has a real file now).
/// The copies stop being copies — and stop being bound to the server book: a file built
/// from chapters that synced as a regular book would report its own percentages and CFIs
/// as those of the whole book. Their reading time, which is the same whatever the file,
/// moves to the server book so that it still reaches the statistics.
///
/// `replaced_local_id` is the copy whose file was just overwritten by the real book: it
/// keeps its binding, and its position (a CFI of the old build) is dropped.
pub async fn delete_chapter_copies_of_book(
    pool: &DbPool,
    server_book_id: &str,
    replaced_local_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    let copies = get_chapter_copies_of_books(pool, &[server_book_id.to_string()]).await?;
    if copies.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    for copy in &copies {
        let sessions: Vec<(String, Option<f32>, Option<f32>)> = sqlx::query_as(
            "SELECT id, start_progress, end_progress FROM reading_sessions WHERE book_id = ? AND sync_status = 'pending'",
        )
        .bind(&copy.local_id)
        .fetch_all(&mut *tx)
        .await?;
        for (id, start_progress, end_progress) in sessions {
            sqlx::query(
                "UPDATE reading_sessions SET book_id = ?, start_progress = ?, end_progress = ? WHERE id = ?",
            )
            .bind(server_book_id)
            .bind(start_progress.map(|p| copy.to_book_percent(p)))
            .bind(end_progress.map(|p| copy.to_book_percent(p)))
            .bind(id)
            .execute(&mut *tx)
            .await?;
        }

        if replaced_local_id == Some(copy.local_id.as_str()) {
            sqlx::query("DELETE FROM book_progress WHERE book_id = ?")
                .bind(&copy.local_id)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("UPDATE book_mappings SET server_book_id = '' WHERE local_id = ?")
                .bind(&copy.local_id)
                .execute(&mut *tx)
                .await?;
        }
    }
    sqlx::query(
        "DELETE FROM chapter_copy_chapters WHERE local_id IN (SELECT local_id FROM chapter_copies WHERE server_book_id = ?)",
    )
    .bind(server_book_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM chapter_copies WHERE server_book_id = ?")
        .bind(server_book_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Spine position of a chapter in a copy.
pub async fn get_chapter_position(
    pool: &DbPool,
    local_id: &str,
    chapter_id: &str,
) -> Result<Option<usize>, sqlx::Error> {
    let position = sqlx::query_scalar::<_, i64>(
        "SELECT position FROM chapter_copy_chapters WHERE local_id = ? AND chapter_id = ? LIMIT 1",
    )
    .bind(local_id)
    .bind(chapter_id)
    .fetch_optional(pool)
    .await?;
    Ok(position.and_then(|p| usize::try_from(p).ok()))
}

/// Id of the chapter stored at a spine position of a copy.
pub async fn get_chapter_id_at(
    pool: &DbPool,
    local_id: &str,
    position: usize,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT chapter_id FROM chapter_copy_chapters WHERE local_id = ? AND position = ? LIMIT 1",
    )
    .bind(local_id)
    .bind(position as i64)
    .fetch_optional(pool)
    .await
}

/// Rewrites the spine step of every stored CFI of a copy after its chapters moved
/// (`moved`: old spine position -> new spine position). Covers reading progress, the
/// recent books list, bookmarks and annotations of that copy.
///
/// [`save_chapter_copy`] does this itself, in the transaction that stores the new layout.
async fn remap_book_cfis_in(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    local_id: &str,
    moved: &std::collections::HashMap<usize, usize>,
) -> Result<(), sqlx::Error> {
    use crate::chapters_epub::remap_cfi_spine;

    if moved.is_empty() {
        return Ok(());
    }

    // Rows are rewritten one by one from values read up front: a set-based UPDATE per
    // moved position would remap the same row twice when positions chain (1 -> 2, 2 -> 3).

    let progress: Option<String> =
        sqlx::query_scalar("SELECT location FROM book_progress WHERE book_id = ?")
            .bind(local_id)
            .fetch_optional(&mut **tx)
            .await?;
    if let Some(location) = progress
        && let Some(remapped) = remap_cfi_spine(&location, moved)
    {
        sqlx::query("UPDATE book_progress SET location = ? WHERE book_id = ?")
            .bind(remapped)
            .bind(local_id)
            .execute(&mut **tx)
            .await?;
    }

    let recent: Option<String> = sqlx::query_scalar(
        "SELECT last_location FROM recent_books WHERE id = ? AND last_location IS NOT NULL",
    )
    .bind(local_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(location) = recent
        && let Some(remapped) = remap_cfi_spine(&location, moved)
    {
        sqlx::query("UPDATE recent_books SET last_location = ? WHERE id = ?")
            .bind(remapped)
            .bind(local_id)
            .execute(&mut **tx)
            .await?;
    }

    let bookmarks: Vec<(String, String)> =
        sqlx::query_as("SELECT id, location FROM bookmarks WHERE book_id = ?")
            .bind(local_id)
            .fetch_all(&mut **tx)
            .await?;
    for (id, location) in bookmarks {
        if let Some(remapped) = remap_cfi_spine(&location, moved) {
            sqlx::query("UPDATE bookmarks SET location = ? WHERE id = ?")
                .bind(remapped)
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
    }

    let annotations: Vec<(String, String, String, String, Option<i64>)> = sqlx::query_as(
        "SELECT id, location_start, location_end, value, section_index FROM annotations WHERE book_id = ?",
    )
    .bind(local_id)
    .fetch_all(&mut **tx)
    .await?;
    for (id, location_start, location_end, value, section_index) in annotations {
        let new_start = remap_cfi_spine(&location_start, moved);
        let new_end = remap_cfi_spine(&location_end, moved);
        let new_value = remap_cfi_spine(&value, moved);
        let new_section = section_index
            .and_then(|s| usize::try_from(s).ok())
            .and_then(|s| moved.get(&s).copied())
            .map(|s| s as i64);
        if new_start.is_none() && new_end.is_none() && new_value.is_none() && new_section.is_none()
        {
            continue;
        }
        sqlx::query(
            "UPDATE annotations SET location_start = ?, location_end = ?, value = ?, section_index = ? WHERE id = ?",
        )
        .bind(new_start.unwrap_or(location_start))
        .bind(new_end.unwrap_or(location_end))
        .bind(new_value.unwrap_or(value))
        .bind(new_section.or(section_index))
        .bind(id)
        .execute(&mut **tx)
        .await?;
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
        DELETE FROM chapter_copies;
        DELETE FROM chapter_copy_chapters;
        DELETE FROM local_books_metadata;
        DELETE FROM recent_books;
        DELETE FROM reading_sessions;
        DELETE FROM app_kv;
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

        delete_annotation(&pool, ann_id, Some(book_id))
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

        // 5. Local books metadata
        save_local_book_meta(
            &pool,
            local_id,
            file_path,
            "Chapter 1 Title",
            "Author Name",
            Some("/path/to/covers/c1.jpg"),
            true,
        )
        .await
        .expect("save local book meta");

        let meta = get_local_book_meta(&pool, local_id)
            .await
            .expect("get local book meta")
            .expect("must exist");
        assert_eq!(meta.title, "Chapter 1 Title");
        assert_eq!(meta.author, "Author Name");

        let all_meta = get_all_local_books_meta(&pool)
            .await
            .expect("get all local books meta");
        assert_eq!(all_meta.len(), 1);

        // 6. Recent books
        let recent_book = DbRecentBook {
            id: local_id.to_string(),
            title: "Chapter 1 Title".to_string(),
            author: "Author Name".to_string(),
            cover_path: Some("/path/to/covers/c1.jpg".to_string()),
            cover_url: None,
            file_path: Some(file_path.to_string()),
            file_name: Some("chapter1.epub".to_string()),
            file_size: Some(1024),
            last_location: Some("epubcfi(/6/4!/4/2:0)".to_string()),
            progress_fraction: 0.5,
            last_opened_at: "2026-08-27T10:00:00Z".to_string(),
        };
        save_recent_book(&pool, &recent_book)
            .await
            .expect("save recent book");

        let recent_list = get_recent_books(&pool, 10).await.expect("get recent books");
        assert_eq!(recent_list.len(), 1);
        assert_eq!(recent_list[0].id, local_id);

        // 7. App KV store
        set_app_kv(&pool, "test_key", "test_val")
            .await
            .expect("set app kv");
        let kv_val = get_app_kv(&pool, "test_key")
            .await
            .expect("get app kv")
            .expect("must exist");
        assert_eq!(kv_val, "test_val");

        // 8. Reading sessions
        let session = save_reading_session(
            &pool,
            book_id,
            Some("Desktop"),
            "2026-08-30T10:00:00Z",
            "2026-08-30T10:30:00Z",
            1800,
            Some(0.1),
            Some(0.35),
            25,
        )
        .await
        .expect("save reading session");
        assert_eq!(session.book_id, book_id);
        assert_eq!(session.duration_seconds, 1800);
        assert_eq!(session.pages_read, 25);
        assert_eq!(session.sync_status, "pending");

        let pending_sessions = get_pending_reading_sessions(&pool, 10)
            .await
            .expect("get pending sessions");
        assert_eq!(pending_sessions.len(), 1);

        let stats = get_book_reading_stats(&pool, book_id)
            .await
            .expect("get book stats");
        assert_eq!(stats.total_duration_seconds, 1800);
        assert_eq!(stats.session_count, 1);
        assert_eq!(stats.total_pages_read, 25);
        assert_eq!(stats.average_seconds_per_page, Some(72.0));

        mark_reading_sessions_synced(&pool, &[session.id])
            .await
            .expect("mark synced");
        let pending_after = get_pending_reading_sessions(&pool, 10)
            .await
            .expect("get pending after sync");
        assert_eq!(pending_after.len(), 0);

        // 9. Clear all data
        clear_all_data(&pool).await.expect("clear all data");

        let stats_after_clear = get_book_reading_stats(&pool, book_id)
            .await
            .expect("get stats after clear");
        assert_eq!(stats_after_clear.session_count, 0);
        assert_eq!(stats_after_clear.total_duration_seconds, 0);

        let prog_after_clear = get_progress(&pool, book_id)
            .await
            .expect("get progress after clear");
        assert!(prog_after_clear.is_none());

        let mapping_after_clear = get_server_book_id(&pool, local_id)
            .await
            .expect("get mapping after clear");
        assert!(mapping_after_clear.is_none());

        let meta_after_clear = get_local_book_meta(&pool, local_id)
            .await
            .expect("get meta after clear");
        assert!(meta_after_clear.is_none());

        let recent_after_clear = get_recent_books(&pool, 10)
            .await
            .expect("get recent after clear");
        assert_eq!(recent_after_clear.len(), 0);

        let kv_after_clear = get_app_kv(&pool, "test_key")
            .await
            .expect("get kv after clear");
        assert!(kv_after_clear.is_none());
    }

    #[tokio::test]
    async fn test_annotation_updates_and_duplicate_cleanup() {
        let pool = init_db(Path::new(":memory:"))
            .await
            .expect("init memory db");
        let book_id = "test-book-dup";
        let cfi = "epubcfi(/6/4!/4/2:10,/4/2:50)";

        // 1. Save initial annotation
        let _ann1 = save_annotation(
            &pool,
            "ann-1",
            None,
            book_id,
            "epubcfi(/6/4!/4/2:10)",
            "epubcfi(/6/4!/4/2:50)",
            cfi,
            "Original text",
            Some("Original note"),
            "yellow",
            Some("highlight"),
            Some("Chapter 1"),
            Some(1),
            None,
            true,
        )
        .await
        .expect("save initial annotation");

        // 2. Edit existing annotation with SAME ID (Bug 3.1 fix verification)
        let _ann1_updated = save_annotation(
            &pool,
            "ann-1",
            None,
            book_id,
            "epubcfi(/6/4!/4/2:10)",
            "epubcfi(/6/4!/4/2:50)",
            cfi,
            "Original text",
            Some("Updated note"),
            "blue",
            Some("highlight"),
            Some("Chapter 1"),
            Some(1),
            None,
            true,
        )
        .await
        .expect("update annotation");

        let anns = get_annotations(&pool, book_id)
            .await
            .expect("get annotations");
        assert_eq!(
            anns.len(),
            1,
            "There should be no duplicates when updating with same ID"
        );
        assert_eq!(anns[0].id, "ann-1");
        assert_eq!(anns[0].color, "blue");
        assert_eq!(anns[0].note.as_deref(), Some("Updated note"));

        // 3. Simulate legacy ghost duplicates (two annotations with different IDs but same CFI value)
        let _ann2_dup = save_annotation(
            &pool,
            "ann-2-ghost",
            None,
            book_id,
            "epubcfi(/6/4!/4/2:10)",
            "epubcfi(/6/4!/4/2:50)",
            cfi,
            "Original text",
            Some("Ghost note"),
            "green",
            Some("highlight"),
            Some("Chapter 1"),
            Some(1),
            None,
            true,
        )
        .await
        .expect("save ghost duplicate");

        let anns_before_delete = get_annotations(&pool, book_id)
            .await
            .expect("get annotations before delete");
        assert_eq!(
            anns_before_delete.len(),
            2,
            "Should have 2 records (simulated duplicate)"
        );

        // 4. Delete by ID of one of the duplicates - should clean up all duplicates for that CFI in the book (Bug 3.2 fix)
        delete_annotation(&pool, "ann-1", None)
            .await
            .expect("delete annotation by id");

        let anns_after_delete = get_annotations(&pool, book_id)
            .await
            .expect("get annotations after delete");
        assert_eq!(
            anns_after_delete.len(),
            0,
            "All duplicates with same CFI should be deleted"
        );

        // 5. Test deletion of duplicates directly by CFI value
        let cfi2 = "epubcfi(/6/6!/4/2:0,/4/2:20)";
        save_annotation(
            &pool,
            "ann-3a",
            None,
            book_id,
            "epubcfi(/6/6!/4/2:0)",
            "epubcfi(/6/6!/4/2:20)",
            cfi2,
            "Text 2",
            None,
            "yellow",
            None,
            None,
            None,
            None,
            true,
        )
        .await
        .expect("save 3a");

        save_annotation(
            &pool,
            "ann-3b",
            None,
            book_id,
            "epubcfi(/6/6!/4/2:0)",
            "epubcfi(/6/6!/4/2:20)",
            cfi2,
            "Text 2",
            None,
            "red",
            None,
            None,
            None,
            None,
            true,
        )
        .await
        .expect("save 3b");

        let anns_cfi2_before = get_annotations(&pool, book_id)
            .await
            .expect("get annotations");
        assert_eq!(anns_cfi2_before.len(), 2);

        delete_annotation(&pool, cfi2, Some(book_id))
            .await
            .expect("delete by cfi value");
        let anns_cfi2_after = get_annotations(&pool, book_id)
            .await
            .expect("get annotations");
        assert_eq!(
            anns_cfi2_after.len(),
            0,
            "All duplicates deleted when deleting by value"
        );
    }

    #[tokio::test]
    async fn test_local_only_and_check_downloaded_books() {
        let pool = init_db(Path::new(":memory:"))
            .await
            .expect("init memory db");
        let local_id = "local-book-123";
        let server_id = "550e8400-e29b-41d4-a716-446655440000";

        // 1. Save progress initially as pending
        let p1 = save_progress(&pool, local_id, "epubcfi(/6/2)", 10.0, false, true)
            .await
            .expect("save progress");
        assert_eq!(p1.sync_status, "pending");

        // 2. Mark as local_only (simulating sync_book failing to find server_id)
        sqlx::query("UPDATE book_progress SET sync_status = 'local_only' WHERE book_id = ?")
            .bind(local_id)
            .execute(&pool)
            .await
            .expect("mark local_only");

        // 3. Saving more progress should preserve local_only
        let p2 = save_progress(&pool, local_id, "epubcfi(/6/4)", 20.0, false, true)
            .await
            .expect("save progress 2");
        assert_eq!(p2.sync_status, "local_only");

        // 4. When book is linked to server via save_book_mapping, local_only records are promoted to pending
        save_book_mapping(&pool, local_id, server_id, None)
            .await
            .expect("save book mapping");

        let p3 = get_progress(&pool, local_id)
            .await
            .expect("get progress")
            .expect("must exist");
        assert_eq!(p3.sync_status, "pending");

        // 5. Test check_downloaded_books with non-existent and existing files
        let empty_result = check_downloaded_books(&pool, &[server_id.to_string()])
            .await
            .expect("check downloaded");
        assert!(empty_result.is_empty(), "No file path yet");

        // Create a temporary dummy file to test file existence
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join("folio_test_book.epub");
        tokio::fs::write(&temp_file, b"test epub content")
            .await
            .expect("write temp epub");

        let temp_path_str = temp_file.to_string_lossy().to_string();
        save_book_mapping(&pool, local_id, server_id, Some(&temp_path_str))
            .await
            .expect("update mapping with file");

        let found_result = check_downloaded_books(
            &pool,
            &[server_id.to_string(), "non-existent-id".to_string()],
        )
        .await
        .expect("check downloaded with file");
        assert_eq!(found_result.len(), 1);
        assert_eq!(found_result.get(server_id).unwrap(), &temp_path_str);

        let _ = tokio::fs::remove_file(temp_file).await;
    }

    #[tokio::test]
    async fn test_chapter_positions_and_cfi_remap() {
        let pool = init_db(Path::new(":memory:"))
            .await
            .expect("init memory db");

        let server_id = "018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6c";
        let local_id = "local-chapters_book_epub";
        let ids = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();

        assert!(!has_chapter_copies(&pool, server_id).await.expect("kind"));
        assert_eq!(get_chapter_copy(&pool, local_id).await.expect("copy"), None);

        // First build: nothing to remap
        save_book_mapping(
            &pool,
            local_id,
            server_id,
            Some("/books/chapters book.epub"),
        )
        .await
        .expect("mapping");
        let moved = save_chapter_copy(
            &pool,
            local_id,
            server_id,
            None,
            0,
            3,
            &ids(&["a", "b", "c"]),
        )
        .await
        .expect("store positions");
        assert!(moved.is_empty());
        assert!(has_chapter_copies(&pool, server_id).await.expect("kind"));
        let copy = get_chapter_copy(&pool, local_id)
            .await
            .expect("copy")
            .expect("stored");
        assert_eq!(copy.server_book_id, server_id);
        assert_eq!(copy.volume, None);
        assert_eq!(copy.chapters_count, 3);
        assert_eq!(copy.file_path.as_deref(), Some("/books/chapters book.epub"));
        assert!(copy.ends_book());
        assert_eq!(copy.to_book_percent(40.0), 40.0);
        assert_eq!(
            get_chapter_position(&pool, local_id, "c")
                .await
                .expect("position"),
            Some(2)
        );
        assert_eq!(
            get_chapter_id_at(&pool, local_id, 1)
                .await
                .expect("id")
                .as_deref(),
            Some("b")
        );
        assert_eq!(
            get_chapter_id_at(&pool, local_id, 7).await.expect("id"),
            None
        );

        // Reading chapter "b" (spine index 1), bookmark in "c", highlight in "a"
        save_progress(
            &pool,
            local_id,
            "epubcfi(/6/4!/4/2/1:10)",
            50.0,
            false,
            false,
        )
        .await
        .expect("progress");
        save_bookmark(
            &pool,
            "bm-ch",
            None,
            local_id,
            "epubcfi(/6/6!/4/2/1:3)",
            0.8,
            None,
            None,
            None,
            true,
        )
        .await
        .expect("bookmark");
        save_annotation(
            &pool,
            "ann-ch",
            None,
            local_id,
            "epubcfi(/6/2!/4/2/1:0)",
            "epubcfi(/6/2!/4/2/1:5)",
            "epubcfi(/6/2!/4/2,/1:0,/1:5)",
            "text",
            None,
            "yellow",
            Some("highlight"),
            None,
            Some(0),
            None,
            true,
        )
        .await
        .expect("annotation");

        // The server inserted chapter "x" before "b": "b" and "c" shift, "a" stays
        let moved = save_chapter_copy(
            &pool,
            local_id,
            server_id,
            None,
            0,
            4,
            &ids(&["a", "x", "b", "c"]),
        )
        .await
        .expect("update positions");
        assert_eq!(moved.len(), 2);
        assert_eq!(moved.get(&1), Some(&2));
        assert_eq!(moved.get(&2), Some(&3));
        assert_eq!(
            get_chapter_id_at(&pool, local_id, 1)
                .await
                .expect("id")
                .as_deref(),
            Some("x")
        );

        // The stored positions moved in the same transaction as the layout
        let progress = get_progress(&pool, local_id)
            .await
            .expect("get progress")
            .expect("must exist");
        // Chained moves (1 -> 2, 2 -> 3) must be applied exactly once
        assert_eq!(progress.location, "epubcfi(/6/6!/4/2/1:10)");
        // Halfway through chapter 2 of 3 is halfway through chapter 3 of 4 now, and the
        // corrected percentage waits to be pushed
        assert!((progress.progress_percent - 62.5).abs() < 0.001);
        assert_eq!(progress.sync_status, "pending");

        let bookmarks = get_bookmarks(&pool, local_id).await.expect("bookmarks");
        assert_eq!(bookmarks[0].location, "epubcfi(/6/8!/4/2/1:3)");

        let annotations = get_annotations(&pool, local_id).await.expect("annotations");
        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].value, "epubcfi(/6/2!/4/2,/1:0,/1:5)");
        assert_eq!(annotations[0].section_index, Some(0));

        // A removed chapter disappears from the layout
        save_chapter_copy(&pool, local_id, server_id, None, 0, 2, &ids(&["a", "c"]))
            .await
            .expect("shrink");
        assert_eq!(
            get_chapter_position(&pool, local_id, "x")
                .await
                .expect("position"),
            None
        );
        assert_eq!(
            get_chapter_position(&pool, local_id, "c")
                .await
                .expect("position"),
            Some(1)
        );

        delete_chapter_copies_of_book(&pool, server_id, None)
            .await
            .expect("clear");
        assert!(!has_chapter_copies(&pool, server_id).await.expect("kind"));
        assert_eq!(
            get_chapter_position(&pool, local_id, "c")
                .await
                .expect("position"),
            None
        );
    }

    #[tokio::test]
    async fn test_copies_of_one_book_keep_their_state_apart() {
        let pool = init_db(Path::new(":memory:"))
            .await
            .expect("init memory db");

        let server_id = "018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6d";
        let whole = "local-Book_epub";
        let volume2 = "local-Book_-_Vol_02_epub";
        let ids = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();

        save_book_mapping(&pool, whole, server_id, Some("/books/Book.epub"))
            .await
            .expect("mapping");
        save_book_mapping(&pool, volume2, server_id, Some("/books/Book - Vol 02.epub"))
            .await
            .expect("mapping");
        save_chapter_copy(
            &pool,
            whole,
            server_id,
            None,
            0,
            4,
            &ids(&["a", "b", "c", "d"]),
        )
        .await
        .expect("whole copy");
        save_chapter_copy(
            &pool,
            volume2,
            server_id,
            Some(2.0),
            2,
            4,
            &ids(&["c", "d"]),
        )
        .await
        .expect("volume copy");

        // The same chapter sits at different spine positions of the two files
        assert_eq!(
            get_chapter_position(&pool, whole, "c").await.expect("p"),
            Some(2)
        );
        assert_eq!(
            get_chapter_position(&pool, volume2, "c").await.expect("p"),
            Some(0)
        );
        assert_eq!(
            get_chapter_id_at(&pool, volume2, 1)
                .await
                .expect("id")
                .as_deref(),
            Some("d")
        );

        let copy = get_chapter_copy(&pool, volume2)
            .await
            .expect("copy")
            .expect("stored");
        assert_eq!(copy.volume, Some(2.0));
        assert_eq!(copy.spine_offset(), 2);
        assert!(copy.ends_book());
        assert_eq!(copy.to_book_percent(50.0), 75.0);
        assert_eq!(copy.to_copy_percent(75.0), 50.0);

        let copies = get_chapter_copies_of_books(&pool, &[server_id.to_string()])
            .await
            .expect("copies");
        let listed: Vec<(&str, Option<f32>)> = copies
            .iter()
            .map(|c| (c.local_id.as_str(), c.volume))
            .collect();
        assert_eq!(listed, [(whole, None), (volume2, Some(2.0))]);

        // Progress, bookmarks and annotations of one copy are invisible to the other, and
        // to whoever asks by the server id
        save_progress(&pool, whole, "epubcfi(/6/8!/4/2/1:10)", 90.0, false, true)
            .await
            .expect("progress");
        save_progress(&pool, volume2, "epubcfi(/6/2!/4/2/1:1)", 10.0, false, true)
            .await
            .expect("progress");
        save_bookmark(
            &pool,
            "bm-whole",
            Some("server-bookmark"),
            whole,
            "epubcfi(/6/6!/4)",
            0.5,
            None,
            None,
            None,
            false,
        )
        .await
        .expect("bookmark");
        // The same server bookmark, stored once per copy in that copy's own coordinates
        save_bookmark(
            &pool,
            "bm-volume",
            Some("server-bookmark"),
            volume2,
            "epubcfi(/6/2!/4)",
            0.0,
            None,
            None,
            None,
            false,
        )
        .await
        .expect("the server id is unique per book only");
        save_annotation(
            &pool,
            "ann-volume",
            Some("server-annotation"),
            volume2,
            "epubcfi(/6/4!/4/2/1:0)",
            "epubcfi(/6/4!/4/2/1:5)",
            "epubcfi(/6/4!/4/2,/1:0,/1:5)",
            "text",
            None,
            "yellow",
            None,
            None,
            Some(1),
            None,
            false,
        )
        .await
        .expect("annotation");

        let progress = get_progress(&pool, volume2).await.expect("p").expect("row");
        assert_eq!(progress.location, "epubcfi(/6/2!/4/2/1:1)");
        let progress = get_progress(&pool, whole).await.expect("p").expect("row");
        assert_eq!(progress.location, "epubcfi(/6/8!/4/2/1:10)");
        assert!(get_progress(&pool, server_id).await.expect("p").is_none());

        let bookmarks = get_bookmarks(&pool, whole).await.expect("bookmarks");
        assert_eq!(bookmarks.len(), 1);
        assert_eq!(bookmarks[0].id, "bm-whole");
        let bookmarks = get_bookmarks(&pool, volume2).await.expect("bookmarks");
        assert_eq!(bookmarks.len(), 1);
        assert_eq!(bookmarks[0].location, "epubcfi(/6/2!/4)");
        assert!(get_annotations(&pool, whole).await.expect("a").is_empty());
        assert_eq!(get_annotations(&pool, volume2).await.expect("a").len(), 1);

        // Only the whole book counts as "the book is downloaded"
        let downloaded_file =
            std::env::temp_dir().join(format!("folio-copy-{}.epub", uuid::Uuid::now_v7()));
        tokio::fs::write(&downloaded_file, b"x")
            .await
            .expect("file");
        let downloaded_path = downloaded_file.to_string_lossy().to_string();
        save_book_mapping(&pool, volume2, server_id, Some(&downloaded_path))
            .await
            .expect("mapping");
        let downloaded = check_downloaded_books(&pool, &[server_id.to_string()])
            .await
            .expect("downloaded");
        assert!(downloaded.is_empty());
        save_book_mapping(&pool, whole, server_id, Some(&downloaded_path))
            .await
            .expect("mapping");
        let downloaded = check_downloaded_books(&pool, &[server_id.to_string()])
            .await
            .expect("downloaded");
        assert_eq!(downloaded.get(server_id), Some(&downloaded_path));
        let _ = tokio::fs::remove_file(&downloaded_file).await;

        // Resetting one copy leaves the other alone
        delete_progress(&pool, volume2).await.expect("reset");
        assert!(get_progress(&pool, volume2).await.expect("p").is_none());
        assert!(get_progress(&pool, whole).await.expect("p").is_some());

        // A local id that is bound to a server book is never rebound to another one
        let other_book = "018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5fff";
        assert!(
            !save_book_mapping(&pool, volume2, other_book, None)
                .await
                .expect("mapping")
        );
        assert_eq!(
            get_server_book_id(&pool, volume2)
                .await
                .expect("id")
                .as_deref(),
            Some(server_id)
        );

        // The server book got a real file, downloaded over the copy of the whole book:
        // the volume copy must not go on syncing its own percentages as a regular book
        save_book_mapping(&pool, whole, server_id, Some("/books/Book.epub"))
            .await
            .expect("mapping");
        save_reading_session(
            &pool,
            volume2,
            None,
            "2026-11-10T10:00:00Z",
            "2026-11-10T10:30:00Z",
            1800,
            Some(0.0),
            Some(50.0),
            3,
        )
        .await
        .expect("session");
        delete_chapter_copies_of_book(&pool, server_id, Some(whole))
            .await
            .expect("detach");
        assert!(!has_chapter_copies(&pool, server_id).await.expect("kind"));
        assert_eq!(get_chapter_copy(&pool, volume2).await.expect("copy"), None);
        assert_eq!(get_server_book_id(&pool, volume2).await.expect("id"), None);
        assert_eq!(
            get_server_book_id(&pool, whole)
                .await
                .expect("id")
                .as_deref(),
            Some(server_id)
        );
        // The position of the replaced copy was a CFI of the old build
        assert!(get_progress(&pool, whole).await.expect("p").is_none());
        // Reading time of the volume reaches the book, in the scale of the book
        let sessions = get_pending_reading_sessions(&pool, 10)
            .await
            .expect("sessions");
        let moved: Vec<_> = sessions.iter().filter(|s| s.book_id == server_id).collect();
        assert_eq!(moved.len(), 1);
        assert!(moved[0].end_progress.is_some_and(|p| p > 50.0));
    }

    #[tokio::test]
    async fn test_migration_from_per_book_chapter_layout() {
        let db_path =
            std::env::temp_dir().join(format!("folio-migrate-{}.db", uuid::Uuid::now_v7()));
        let server_id = "018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6e";
        let file_book = "018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6f";
        let local_id = "local-Old_Book_epub";

        // A database written by the previous build: table-wide unique server ids and the
        // chapter layout keyed by server book id
        {
            let options =
                SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))
                    .expect("options")
                    .create_if_missing(true);
            let old = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .expect("old db");
            sqlx::query(
                r#"
                CREATE TABLE book_mappings (local_id TEXT PRIMARY KEY, server_book_id TEXT NOT NULL, file_path TEXT, created_at TEXT NOT NULL);
                CREATE TABLE book_progress (book_id TEXT PRIMARY KEY, location TEXT NOT NULL, progress_percent REAL NOT NULL DEFAULT 0.0, is_read INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'synced');
                CREATE TABLE bookmarks (
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
                CREATE INDEX idx_bookmarks_book_id ON bookmarks(book_id);
                CREATE TABLE annotations (
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
                CREATE INDEX idx_annotations_book_id ON annotations(book_id);
                CREATE TABLE chapter_book_chapters (server_book_id TEXT NOT NULL, chapter_id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (server_book_id, chapter_id));

                INSERT INTO book_mappings VALUES ('local-Old_Book_epub', '018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6e', '/books/Old Book.epub', '2026-11-10T00:00:00Z');
                INSERT INTO book_mappings VALUES ('local-File_epub', '018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6f', '/books/File.epub', '2026-11-10T00:00:00Z');
                INSERT INTO chapter_book_chapters VALUES ('018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6e', 'a', 0), ('018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6e', 'b', 1);
                INSERT INTO book_progress VALUES ('018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6e', 'epubcfi(/6/4!/4)', 50.0, 0, '2026-11-10T00:00:00Z', 'synced');
                INSERT INTO book_progress VALUES ('018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6f', 'epubcfi(/6/8!/4)', 20.0, 0, '2026-11-10T00:00:00Z', 'synced');
                INSERT INTO bookmarks VALUES ('bm-1', 'srv-bm-1', 'local-Old_Book_epub', 'epubcfi(/6/2!/4)', 0.1, NULL, 'One', '2026-11-10T00:00:00Z', 0, 'synced');
                INSERT INTO bookmarks VALUES ('bm-2', NULL, '018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5a6e', 'epubcfi(/6/4!/4)', 0.6, NULL, 'Two', '2026-11-10T00:00:00Z', 0, 'pending_create');
                INSERT INTO annotations VALUES ('ann-1', 'srv-ann-1', 'local-Old_Book_epub', 'epubcfi(/6/2!/4/2/1:0)', 'epubcfi(/6/2!/4/2/1:5)', 'epubcfi(/6/2!/4/2,/1:0,/1:5)', 'text', 'note', 'blue', 'highlight', 'One', 0, '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z', 0, 'synced');
                "#,
            )
            .execute(&old)
            .await
            .expect("old schema");
            old.close().await;
        }

        let pool = init_db(&db_path).await.expect("migrated db");

        // The layout belongs to the local file now
        assert!(
            table_sql(&pool, "chapter_book_chapters")
                .await
                .expect("sql")
                .is_none()
        );
        let copy = get_chapter_copy(&pool, local_id)
            .await
            .expect("copy")
            .expect("migrated");
        assert_eq!(copy.server_book_id, server_id);
        assert_eq!(copy.volume, None);
        assert_eq!(copy.chapters_count, 2);
        assert_eq!(copy.book_chapters, 2);
        assert_eq!(
            get_chapter_id_at(&pool, local_id, 1)
                .await
                .expect("id")
                .as_deref(),
            Some("b")
        );
        assert_eq!(
            get_chapter_copy(&pool, "local-File_epub")
                .await
                .expect("copy"),
            None
        );

        // ...together with the reading state that was mirrored under the server id
        let progress = get_progress(&pool, local_id)
            .await
            .expect("p")
            .expect("row");
        assert_eq!(progress.book_id, local_id);
        assert_eq!(progress.location, "epubcfi(/6/4!/4)");
        let bookmarks = get_bookmarks(&pool, local_id).await.expect("bookmarks");
        assert_eq!(bookmarks.len(), 2);
        assert!(bookmarks.iter().all(|b| b.book_id == local_id));
        let annotations = get_annotations(&pool, local_id).await.expect("annotations");
        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].note.as_deref(), Some("note"));
        assert_eq!(annotations[0].server_id.as_deref(), Some("srv-ann-1"));

        // A book downloaded as a file is untouched: its progress is still found by either id
        let progress = get_progress(&pool, "local-File_epub")
            .await
            .expect("p")
            .expect("row");
        assert_eq!(progress.book_id, file_book);

        // Server ids are unique per book, not table-wide
        for table in ["bookmarks", "annotations"] {
            let sql = table_sql(&pool, table).await.expect("sql").expect("table");
            assert!(!sql.contains("server_id TEXT UNIQUE"), "{table}: {sql}");
        }
        save_bookmark(
            &pool,
            "bm-3",
            Some("srv-bm-1"),
            "local-Other_epub",
            "epubcfi(/6/2!/4)",
            0.0,
            None,
            None,
            None,
            false,
        )
        .await
        .expect("same server bookmark in another copy");
        let duplicate = sqlx::query(
            "INSERT INTO bookmarks (id, server_id, book_id, location, created_at) VALUES ('bm-4', 'srv-bm-1', 'local-Other_epub', 'x', 'now')",
        )
        .execute(&pool)
        .await;
        assert!(duplicate.is_err());

        // Opening the database again changes nothing
        pool.close().await;
        let pool = init_db(&db_path).await.expect("second start");
        assert_eq!(
            get_bookmarks(&pool, local_id)
                .await
                .expect("bookmarks")
                .len(),
            2
        );
        assert!(
            get_chapter_copy(&pool, local_id)
                .await
                .expect("copy")
                .is_some()
        );
        pool.close().await;

        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", db_path.display()));
        }
    }

    #[tokio::test]
    async fn test_progress_change_time_and_sync_marks() {
        let pool = init_db(Path::new(":memory:")).await.expect("init db");
        let server_id = "018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5b01";
        let local_id = "local-Ordered_epub";
        save_book_mapping(&pool, local_id, server_id, Some("/books/Ordered.epub"))
            .await
            .expect("mapping");

        // ---- A position the user read to is a pending change, dated now ----
        let first = save_progress(&pool, local_id, "epubcfi(/6/4!/4)", 10.0, false, true)
            .await
            .expect("save");
        assert_eq!(first.sync_status, "pending");
        assert_eq!(
            normalize_timestamp(&first.updated_at).as_deref(),
            Some(first.updated_at.as_str())
        );

        // ---- Saving it again changes nothing, not even its time ----
        let again = save_progress(&pool, local_id, "epubcfi(/6/4!/4)", 10.0, false, true)
            .await
            .expect("save");
        assert_eq!(again.updated_at, first.updated_at);

        // ---- The page is turned while the first position is being pushed ----
        let second = save_progress(&pool, local_id, "epubcfi(/6/6!/4)", 20.0, false, true)
            .await
            .expect("save");
        assert!(second.updated_at > first.updated_at);
        // The answer to the push of the first position must not mark the second synced
        assert!(
            !mark_progress_synced(
                &pool,
                local_id,
                server_id,
                &first.updated_at,
                Some("2026-11-10T10:00:00Z")
            )
            .await
            .expect("mark")
        );
        let current = get_progress(&pool, local_id)
            .await
            .expect("p")
            .expect("row");
        assert_eq!(current.location, "epubcfi(/6/6!/4)");
        assert_eq!(current.sync_status, "pending");
        assert_eq!(current.updated_at, second.updated_at);
        // ...and a server position that lost to the first one must not replace it either
        assert!(
            !adopt_remote_progress(
                &pool,
                local_id,
                server_id,
                Some(&first.updated_at),
                "epubcfi(/6/40!/4)",
                90.0,
                false,
                Some("2099-01-01T00:00:00Z"),
            )
            .await
            .expect("adopt")
        );
        let current = get_progress(&pool, local_id)
            .await
            .expect("p")
            .expect("row");
        assert_eq!(current.location, "epubcfi(/6/6!/4)");
        assert_eq!(current.sync_status, "pending");

        // ---- The push of the current position: synced, dated as the server stored it,
        // even when this device's clock runs ahead of the server's ----
        // An older row of the same book under its server id comes along
        save_progress_at(
            &pool,
            server_id,
            "epubcfi(/6/2!/4)",
            5.0,
            false,
            false,
            Some("2020-01-01T00:00:00Z"),
        )
        .await
        .expect("save");
        assert!(
            mark_progress_synced(
                &pool,
                local_id,
                server_id,
                &second.updated_at,
                Some("2020-06-01T00:00:00.123Z")
            )
            .await
            .expect("mark")
        );
        for id in [local_id, server_id] {
            let row: (String, String, String) = sqlx::query_as(
                "SELECT location, updated_at, sync_status FROM book_progress WHERE book_id = ?",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .expect("row");
            assert_eq!(
                row,
                (
                    "epubcfi(/6/6!/4)".to_string(),
                    "2020-06-01T00:00:00.123000Z".to_string(),
                    "synced".to_string()
                )
            );
        }

        // ---- A newer server position replaces it under both ids ----
        assert!(
            adopt_remote_progress(
                &pool,
                local_id,
                server_id,
                Some("2020-06-01T00:00:00.123000Z"),
                "epubcfi(/6/8!/4)",
                30.0,
                true,
                Some("2020-07-01T00:00:00+00:00"),
            )
            .await
            .expect("adopt")
        );
        let adopted = get_progress(&pool, local_id)
            .await
            .expect("p")
            .expect("row");
        assert_eq!(adopted.location, "epubcfi(/6/8!/4)");
        assert!(adopted.is_read);
        assert_eq!(adopted.updated_at, "2020-07-01T00:00:00.000000Z");
        assert_eq!(adopted.sync_status, "synced");

        // ---- The next local change is later than what it replaces, whatever the clock ----
        save_progress_at(
            &pool,
            local_id,
            "epubcfi(/6/8!/4)",
            30.0,
            true,
            false,
            Some("2099-01-01T00:00:00Z"),
        )
        .await
        .expect("save");
        let next = save_progress(&pool, local_id, "epubcfi(/6/10!/4)", 40.0, false, true)
            .await
            .expect("save");
        assert!(next.updated_at.as_str() > "2099-01-01T00:00:00.000000Z");
    }

    #[tokio::test]
    async fn test_annotation_deleted_by_range_stays_in_its_book() {
        let pool = init_db(Path::new(":memory:")).await.expect("init db");
        let range = "epubcfi(/6/4!/4/2,/1:0,/1:5)";
        for (id, book) in [("ann-a", "local-A_epub"), ("ann-b", "local-B_epub")] {
            save_annotation(
                &pool,
                id,
                None,
                book,
                "epubcfi(/6/4!/4/2/1:0)",
                "epubcfi(/6/4!/4/2/1:5)",
                range,
                "text",
                None,
                "yellow",
                None,
                None,
                None,
                None,
                false,
            )
            .await
            .expect("save");
        }

        // Two books have this range: without a book nothing can be chosen
        delete_annotation(&pool, range, None).await.expect("delete");
        assert_eq!(
            get_annotations(&pool, "local-A_epub").await.unwrap().len(),
            1
        );
        assert_eq!(
            get_annotations(&pool, "local-B_epub").await.unwrap().len(),
            1
        );

        // With the book, only that book's annotation goes
        delete_annotation(&pool, range, Some("local-A_epub"))
            .await
            .expect("delete");
        assert!(
            get_annotations(&pool, "local-A_epub")
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            get_annotations(&pool, "local-B_epub").await.unwrap().len(),
            1
        );

        // The only book that still has the range needs no hint
        delete_annotation(&pool, range, None).await.expect("delete");
        assert!(
            get_annotations(&pool, "local-B_epub")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn test_progress_migrations_of_an_existing_database() {
        let db_path =
            std::env::temp_dir().join(format!("folio-progress-{}.db", uuid::Uuid::now_v7()));

        // First start creates the schema; then rows as earlier versions wrote them
        let pool = init_db(&db_path).await.expect("first start");
        sqlx::query(
            r#"
            DELETE FROM app_kv;
            INSERT INTO book_progress VALUES ('local-Offset_epub', 'epubcfi(/6/4!/4)', 42.0, 0, '2026-11-10T12:00:00.5+02:00', 'pending');
            INSERT INTO book_progress VALUES ('local-Garbage_epub', 'epubcfi(/6/4!/4)', 42.0, 0, 'yesterday', 'synced');
            -- A fraction stored where a percentage belongs: the recent list has the same number
            INSERT INTO book_progress VALUES ('local-Fraction_epub', 'epubcfi(/6/4!/4)', 0.37, 0, '2026-11-10T10:00:00+00:00', 'synced');
            INSERT INTO recent_books (id, title, author, progress_fraction, last_opened_at) VALUES ('local-Fraction_epub', 'T', 'A', 0.37, '2026-11-10T10:00:00Z');
            -- Genuine progress below 1% (chapter 20 of 4000) next to a stale recent entry
            INSERT INTO book_progress VALUES ('local-Long_epub', 'epubcfi(/6/40!/4)', 0.5, 0, '2026-11-10T10:00:00+00:00', 'synced');
            INSERT INTO recent_books (id, title, author, progress_fraction, last_opened_at) VALUES ('local-Long_epub', 'T', 'A', 0.02, '2026-11-10T10:00:00Z');
            "#,
        )
        .execute(&pool)
        .await
        .expect("old rows");
        pool.close().await;

        let pool = init_db(&db_path).await.expect("second start");
        let row = |id: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_as::<_, (f32, String, String)>(
                    "SELECT progress_percent, updated_at, sync_status FROM book_progress WHERE book_id = ?",
                )
                .bind(id)
                .fetch_one(&pool)
                .await
                .expect("row")
            }
        };
        // Timestamps: one format, in UTC; the status is untouched
        assert_eq!(
            row("local-Offset_epub").await,
            (
                42.0,
                "2026-11-10T10:00:00.500000Z".to_string(),
                "pending".to_string()
            )
        );
        // What is not a timestamp loses against everything
        assert_eq!(
            row("local-Garbage_epub").await.1,
            "1970-01-01T00:00:00.000000Z"
        );
        // The fraction became a percentage, the genuine half a percent stayed
        assert_eq!(row("local-Fraction_epub").await.0, 37.0);
        assert_eq!(row("local-Long_epub").await.0, 0.5);

        // The repair of fractions runs once per database
        sqlx::query(
            r#"
            INSERT INTO book_progress VALUES ('local-Later_epub', 'epubcfi(/6/4!/4)', 0.25, 0, '2026-11-11T10:00:00.000000Z', 'synced');
            INSERT INTO recent_books (id, title, author, progress_fraction, last_opened_at) VALUES ('local-Later_epub', 'T', 'A', 0.25, '2026-11-11T10:00:00Z');
            "#,
        )
        .execute(&pool)
        .await
        .expect("later rows");
        pool.close().await;
        let pool = init_db(&db_path).await.expect("third start");
        let later: f32 = sqlx::query_scalar(
            "SELECT progress_percent FROM book_progress WHERE book_id = 'local-Later_epub'",
        )
        .fetch_one(&pool)
        .await
        .expect("row");
        assert_eq!(later, 0.25);
        pool.close().await;

        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", db_path.display()));
        }
    }

    #[tokio::test]
    async fn test_damaged_database_is_set_aside() {
        let dir = std::env::temp_dir().join(format!("folio-damaged-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).expect("dir");
        let db_path = dir.join("folio_local.db");
        std::fs::write(&db_path, vec![0x5a; 8192]).expect("garbage");

        assert!(init_db(&db_path).await.is_err());
        let pool = init_db_or_recover(&db_path).await.expect("recovered");
        // A new database on disk: what is stored survives a restart
        assert_eq!(
            get_app_kv(&pool, STORAGE_ERROR_KEY).await.expect("kv"),
            None
        );
        set_app_kv(&pool, "probe", "kept").await.expect("kv");
        pool.close().await;
        let pool = init_db_or_recover(&db_path).await.expect("reopened");
        assert_eq!(
            get_app_kv(&pool, "probe").await.expect("kv").as_deref(),
            Some("kept")
        );
        pool.close().await;
        // The damaged file was kept, not deleted
        let kept = std::fs::read_dir(&dir)
            .expect("dir")
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".corrupt-"))
            .count();
        assert_eq!(kept, 1);

        // A database that cannot be opened at all (its path is a directory): the
        // application still starts, on a database in memory, and says so
        let unusable = dir.join("subdir");
        std::fs::create_dir_all(&unusable).expect("dir");
        let pool = init_db_or_recover(&unusable).await.expect("in memory");
        assert!(
            get_app_kv(&pool, STORAGE_ERROR_KEY)
                .await
                .expect("kv")
                .is_some()
        );
        pool.close().await;

        let _ = std::fs::remove_dir_all(&dir);
    }
}
