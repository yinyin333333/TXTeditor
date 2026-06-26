mod app_bootstrap;
mod config;
mod file_io;
mod lsp_protocol;
mod lsp_service;
mod native_paths;
mod workspace_files;

// Tauri command wiring lives here; implementation details stay in focused modules.

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(lsp_service::LspManager::new())
        .setup(app_bootstrap::setup_app)
        .invoke_handler(tauri::generate_handler![
            file_io::open_files_dialog,
            file_io::open_folder_dialog,
            file_io::save_file_dialog,
            file_io::read_text_file,
            file_io::read_text_files,
            file_io::write_text_file_safe,
            workspace_files::list_workspace_files,
            config::get_config,
            config::save_config,
            config::pick_file_path,
            lsp_service::lsp_start,
            lsp_service::lsp_open_file,
            lsp_service::lsp_update_file,
            lsp_service::lsp_update_file_incremental,
            lsp_service::lsp_close_file,
            lsp_service::lsp_get_diagnostics,
            lsp_service::lsp_hover,
            lsp_service::lsp_definition,
            app_bootstrap::close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running txteditor");
}
