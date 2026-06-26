use crate::config::{load_app_config_from, AppConfigState};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[tauri::command]
pub(crate) fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
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
