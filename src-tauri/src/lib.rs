mod app_bootstrap;
mod clipboard;
mod config;
mod file_io;
mod launch_paths;
mod lsp_file_watcher;
mod lsp_protocol;
mod lsp_service;
mod native_paths;
mod reference_data;
mod workspace_files;

use tauri::Manager;

// Tauri command wiring lives here; implementation details stay in focused modules.

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(clipboard::ClipboardService::new())
        .manage(lsp_service::LspManager::new())
        .setup(app_bootstrap::setup_app)
        .invoke_handler(tauri::generate_handler![
            clipboard::read_clipboard_text,
            clipboard::write_clipboard_text,
            file_io::open_files_dialog,
            file_io::open_folder_dialog,
            file_io::save_file_dialog,
            file_io::read_text_files,
            file_io::write_text_file_safe,
            file_io::write_text_file_chunk_safe,
            launch_paths::startup_open_paths,
            workspace_files::list_workspace_files,
            workspace_files::list_sibling_txt_files,
            config::get_config,
            config::save_config,
            config::pick_file_path,
            reference_data::load_lint_reference_dataset,
            lsp_service::lsp_start,
            lsp_service::lsp_stop,
            lsp_service::lsp_open_file,
            lsp_service::lsp_update_file,
            lsp_service::lsp_update_file_incremental,
            lsp_service::lsp_close_file,
            lsp_service::lsp_get_diagnostics,
            lsp_service::lsp_get_diagnostics_batch,
            lsp_service::lsp_hover,
            lsp_service::lsp_field_metadata,
            lsp_service::lsp_definition,
            app_bootstrap::close_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building txteditor");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<clipboard::ClipboardService>().shutdown();
            app_handle.state::<lsp_service::LspManager>().shutdown();
        }
    });
}
