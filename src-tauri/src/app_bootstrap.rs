use crate::config::{load_app_config_from, AppConfigState};
use crate::launch_paths::{forwarded_open_paths, PendingOpenPaths};
use crate::lsp_service::LspManager;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[tauri::command]
pub(crate) fn close_window(
    window: tauri::WebviewWindow,
    lsp_manager: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    lsp_manager.shutdown();
    window.destroy().map_err(|e| e.to_string())
}

pub(crate) fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&config_dir);
    let config_path = config_dir.join("config.json");
    let config = load_app_config_from(&config_path);
    app.manage(AppConfigState {
        config: Mutex::new(config),
        config_path,
    });
    if let Some(window) = app.get_webview_window("main") {
        let win = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.emit("app-close-requested", ());
            }
        });
    }
    Ok(())
}

pub(crate) fn handle_second_instance(app: &tauri::AppHandle, args: Vec<String>, cwd: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let paths = forwarded_open_paths(args, &cwd);
    if paths.is_empty() {
        return;
    }
    app.state::<PendingOpenPaths>().extend(paths);
    let _ = app.emit("single-instance-open-paths", ());
}
