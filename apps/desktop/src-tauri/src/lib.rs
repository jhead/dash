use tauri_plugin_fs::FsExt;

/// Grant the webview runtime filesystem scope for a single user-chosen path.
///
/// Task 1394 narrowed the STATIC fs capability (`capabilities/default.json`)
/// from whole-home to the user content directories, so a `.fla` (or an imported
/// asset / a Save-As / Publish target) located anywhere else is no longer
/// readable or writable by default. When the user explicitly picks such a path
/// through a native open/save dialog, the frontend calls this command to extend
/// the runtime scope for **that exact file only** (`allow_file`, not a
/// directory), so user-chosen files anywhere on disk work without widening the
/// static capability. The grant is per-file and lasts for the app session; it
/// deliberately does NOT grant the containing directory (opening a file in `~`
/// must not re-expose the whole home directory that 1394 locked down).
#[tauri::command]
fn allow_fs_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if path.is_empty() {
        return Err("empty path".into());
    }
    app.fs_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![allow_fs_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
