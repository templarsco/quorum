use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

struct EngineState {
    automations: Mutex<Option<Child>>,
    task: Arc<Mutex<Option<Child>>>,
    log: Arc<Mutex<Vec<String>>>,
}

impl EngineState {
    fn new() -> Self {
        Self {
            automations: Mutex::new(None),
            task: Arc::new(Mutex::new(None)),
            log: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[derive(Serialize)]
struct EngineStatus {
    workspace: String,
    quorum_dir: String,
    automations_running: bool,
    agents_running: bool,
    dev_mode: bool,
    mcp_command: String,
    log: Vec<String>,
}

fn push_log(log: &Arc<Mutex<Vec<String>>>, line: impl Into<String>) {
    let mut buf = log.lock().unwrap();
    buf.push(line.into());
    if buf.len() > 200 {
        let drop = buf.len() - 200;
        buf.drain(0..drop);
    }
}

fn repo_engine_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../engine"))
}

fn bundled_engine_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|d| d.join("engine"))
        .filter(|d| d.join("automations.js").exists())
}

fn bundled_node_exe(app: &AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    app.path()
        .resource_dir()
        .ok()
        .map(|d| d.join("node").join(name))
        .filter(|p| p.exists())
}

fn workspace_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("workspace")
}

fn ensure_quorum_dir(workspace: &Path) -> PathBuf {
    let dir = workspace.join(".quorum");
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::create_dir_all(dir.join("automations"));
    dir
}

fn dev_mode() -> bool {
    cfg!(debug_assertions)
}

fn resolve_node(app: &AppHandle) -> PathBuf {
    if dev_mode() {
        return PathBuf::from("node");
    }
    bundled_node_exe(app).unwrap_or_else(|| PathBuf::from("node"))
}

fn spawn_automations(app: &AppHandle, state: &Arc<EngineState>) -> Result<(), String> {
    let workspace = workspace_dir(app);
    let _ = std::fs::create_dir_all(&workspace);
    let quorum = ensure_quorum_dir(&workspace);

    push_log(
        &state.log,
        format!("workspace: {}", workspace.display()),
    );
    push_log(&state.log, format!(".quorum: {}", quorum.display()));

    let mut cmd = if dev_mode() {
        let engine = repo_engine_dir();
        if !engine.join("src/automations/daemon.ts").exists() {
            return Err("engine source not found (expected ../engine)".into());
        }
        let mut c = Command::new("npx");
        c.args(["tsx", "src/automations/daemon.ts"]).current_dir(&engine);
        c
    } else {
        let engine = bundled_engine_dir(app).ok_or("bundled engine not found — run npm run build:engine")?;
        let node = resolve_node(app);
        let mut c = Command::new(node);
        c.arg(engine.join("automations.js")).current_dir(&engine);
        c
    };

    cmd.env("QUORUM_WORKSPACE", &workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("automations spawn failed: {e}"))?;

    let app_out = app.clone();
    let log_out = Arc::clone(&state.log);
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                push_log(&log_out, format!("[automations] {line}"));
                let _ = app_out.emit("quorum-status", line);
            }
        });
    }

    let app_err = app.clone();
    let log_err = Arc::clone(&state.log);
    if let Some(err) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                push_log(&log_err, format!("[automations:err] {line}"));
                let _ = app_err.emit("quorum-status", line);
            }
        });
    }

    push_log(&state.log, "automations daemon started");
    *state.automations.lock().unwrap() = Some(child);
    Ok(())
}

fn spawn_task(app: &AppHandle, state: &Arc<EngineState>, task: String) -> Result<(), String> {
    let workspace = workspace_dir(app);
    let _ = std::fs::create_dir_all(&workspace);
    ensure_quorum_dir(&workspace);

    let mut cmd = if dev_mode() {
        let engine = repo_engine_dir();
        let mut c = Command::new("npx");
        c.args(["tsx", "src/stream.ts", &task]).current_dir(&engine);
        c
    } else {
        let engine = bundled_engine_dir(app).ok_or("bundled engine not found")?;
        let node = resolve_node(app);
        let mut c = Command::new(node);
        c.arg(engine.join("stream.js")).arg(&task).current_dir(&engine);
        c
    };

    cmd.env("QUORUM_WORKSPACE", &workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| format!("task spawn failed: {e}"))?;

    let app_ev = app.clone();
    let task_slot = Arc::clone(&state.task);
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                let _ = app_ev.emit("quorum-event", &line);
            }
            *task_slot.lock().unwrap() = None;
            let _ = app_ev.emit("quorum-agents", "idle");
        });
    }

    *state.task.lock().unwrap() = Some(child);
    let _ = app.emit("quorum-agents", "running");
    Ok(())
}

fn kill_child(slot: &Mutex<Option<Child>>) {
    if let Some(mut child) = slot.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn kill_task(slot: &Arc<Mutex<Option<Child>>>) {
    kill_child(slot.as_ref());
}

#[tauri::command]
fn run_task(app: tauri::AppHandle, state: State<'_, Arc<EngineState>>, task: String) -> Result<(), String> {
    if state.task.lock().unwrap().is_some() {
        return Err("a task is already running".into());
    }
    let state = Arc::clone(&state);
    std::thread::spawn(move || {
        if let Err(e) = spawn_task(&app, &state, task) {
            let _ = app.emit(
                "quorum-event",
                format!(
                    "{{\"type\":\"__error__\",\"text\":{}}}",
                    serde_json::to_string(&e).unwrap_or_default()
                ),
            );
            let _ = app.emit("quorum-agents", "idle");
        }
    });
    Ok(())
}

#[tauri::command]
fn get_engine_status(app: tauri::AppHandle, state: State<'_, Arc<EngineState>>) -> EngineStatus {
    let workspace = workspace_dir(&app);
    let quorum = ensure_quorum_dir(&workspace);
    let automations_running = state
        .automations
        .lock()
        .unwrap()
        .as_mut()
        .map(|c| c.try_wait().ok().flatten().is_none())
        .unwrap_or(false);
    let agents_running = state
        .task
        .lock()
        .unwrap()
        .as_mut()
        .map(|c| c.try_wait().ok().flatten().is_none())
        .unwrap_or(false);

    let mcp_command = if dev_mode() {
        format!("cd {} && npm run mcp", repo_engine_dir().display())
    } else if let Some(engine) = bundled_engine_dir(&app) {
        format!(
            "{} {} (stdio MCP — configure in Claude/Copilot MCP settings)",
            resolve_node(&app).display(),
            engine.join("mcp.js").display()
        )
    } else {
        "bundled MCP unavailable — rebuild with npm run build:engine".into()
    };

    EngineStatus {
        workspace: workspace.display().to_string(),
        quorum_dir: quorum.display().to_string(),
        automations_running,
        agents_running,
        dev_mode: dev_mode(),
        mcp_command,
        log: state.log.lock().unwrap().clone(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(EngineState::new()))
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<Arc<EngineState>>();
            if let Err(e) = spawn_automations(&handle, &state) {
                push_log(&state.log, format!("automations failed: {e}"));
                let _ = handle.emit("quorum-status", format!("automations failed: {e}"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![run_task, get_engine_status])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Arc<EngineState>>() {
                    kill_task(&state.task);
                    kill_child(&state.automations);
                }
            }
        });
}
