mod auth_proxy;
mod db;
mod fs_manager;
mod reader_commands;
mod sync_manager;

use auth_proxy::{AuthHttpClient, AuthHttpClientState};
use tauri::Manager;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let app_handle = app.handle();
            let base_dir = app_handle
                .path()
                .app_local_data_dir()
                .or_else(|_| app_handle.path().app_data_dir())
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
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
            reader_commands::db_save_book_mapping,
            reader_commands::db_get_server_book_id,
            reader_commands::db_save_progress,
            reader_commands::db_get_progress,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
