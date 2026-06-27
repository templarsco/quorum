use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::Emitter;

// Runs the Quorum engine for a task and streams each bus message to the UI as a
// "quorum-event" (one JSON line per event). Runs on a background thread so the window stays live.
#[tauri::command]
fn run_task(app: tauri::AppHandle, task: String) {
    std::thread::spawn(move || {
        // engine lives next to the desktop app: <repo>/engine
        let engine_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../engine");
        let spawned = Command::new("node")
            .args(["--import", "tsx", "src/stream.ts", &task])
            .current_dir(engine_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();

        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "quorum-event",
                    format!(
                        "{{\"type\":\"__error__\",\"text\":\"failed to start engine (is node on PATH?): {}\"}}",
                        e
                    ),
                );
                return;
            }
        };

        if let Some(out) = child.stdout.take() {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    let _ = app.emit("quorum-event", line);
                }
            }
        }
        let _ = child.wait();
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![run_task])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
