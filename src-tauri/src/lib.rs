mod auth_proxy;
mod db;
mod fs_manager;
mod reader_commands;
mod sync_manager;

use auth_proxy::{AuthHttpClient, AuthHttpClientState};
use std::path::PathBuf;
use tauri::Manager;
use tokio::sync::Mutex;

pub fn get_app_base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;

    #[cfg(debug_assertions)]
    {
        let identifier = app.config().identifier.as_str();
        if !identifier.ends_with(".dev")
            && !identifier.ends_with(".debug")
            && !identifier.ends_with("-dev")
        {
            let dev_dir = base_dir.join("dev_data");
            if !dev_dir.exists() {
                let _ = std::fs::create_dir_all(&dev_dir);
            }
            return Ok(dev_dir);
        }
    }

    Ok(base_dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let app_handle = app.handle();
            let base_dir = get_app_base_dir(app_handle).unwrap_or_else(|_| PathBuf::from("."));
            let db_path = base_dir.join("folio_local.db");

            tauri::async_runtime::block_on(async move {
                let pool = db::init_db(&db_path)
                    .await
                    .expect("failed to initialize sqlite database");
                app_handle.manage(pool);
            });

            Ok(())
        })
        .manage(Mutex::new(AuthHttpClient::new()) as AuthHttpClientState)
        .invoke_handler(tauri::generate_handler![
            auth_proxy::auth_login_proxy,
            auth_proxy::auth_login_2fa_proxy,
            auth_proxy::auth_email_confirm_proxy,
            auth_proxy::refresh_access_token,
            auth_proxy::auth_revoke_token,
            auth_proxy::clear_auth_cookies,
            fs_manager::get_default_download_dir,
            fs_manager::pick_folder,
            fs_manager::scan_local_books,
            fs_manager::read_book_file,
            fs_manager::download_book_file,
            fs_manager::delete_book_file,
            fs_manager::check_book_downloaded,
            fs_manager::save_custom_font,
            fs_manager::list_custom_fonts,
            fs_manager::delete_custom_font,
            fs_manager::read_font_file,
            fs_manager::open_fonts_folder,
            fs_manager::open_external_url,
            fs_manager::open_external_path,
            reader_commands::db_save_book_mapping,
            reader_commands::db_get_server_book_id,
            reader_commands::db_save_progress,
            reader_commands::db_get_progress,
            reader_commands::db_delete_progress,
            reader_commands::db_get_bookmarks,
            reader_commands::db_save_bookmark,
            reader_commands::db_delete_bookmark,
            reader_commands::db_get_annotations,
            reader_commands::db_save_annotation,
            reader_commands::db_delete_annotation,
            reader_commands::sync_book_data,
            reader_commands::pull_book_progress,
            reader_commands::sync_all_pending,
            reader_commands::db_clear_all_data,
            reader_commands::db_save_local_book_meta,
            reader_commands::db_get_all_local_books_meta,
            reader_commands::db_get_local_book_meta,
            reader_commands::db_save_recent_book,
            reader_commands::db_get_recent_books,
            reader_commands::db_remove_recent_book,
            reader_commands::db_update_recent_book_meta,
            reader_commands::db_set_app_kv,
            reader_commands::db_get_app_kv,
            fs_manager::save_book_cover,
            fs_manager::get_book_cover_path,
            fs_manager::delete_book_cover,
            fs_manager::clear_covers_cache,
            fs_manager::load_app_settings,
            fs_manager::save_app_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
