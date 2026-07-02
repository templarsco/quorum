const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let running = false;

function el(sel) {
  return document.querySelector(sel);
}

function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.textContent;
}

function roleClass(ev) {
  if (ev.role === "human") return "human";
  if (ev.role === "orchestrator") return "orchestrator";
  if (ev.role === "worker") {
    return ev.author && ev.author.startsWith("copilot") ? "worker-copilot" : "worker-claude";
  }
  return "system";
}

function addBubble(ev) {
  const node = document.createElement("div");
  node.className = `bubble ${roleClass(ev)}`;
  const who = ev.author || ev.role || "system";
  const meta = [who, ev.lang, ev.type && ev.type !== "chat" ? ev.type : null].filter(Boolean).join(" · ");
  const whoEl = document.createElement("div");
  whoEl.className = "who";
  whoEl.textContent = meta;
  const textEl = document.createElement("div");
  textEl.className = "text";
  textEl.textContent = ev.text || "";
  node.appendChild(whoEl);
  node.appendChild(textEl);
  const feed = el("#feed");
  feed.appendChild(node);
  feed.scrollTop = feed.scrollHeight;
}

function appendStatus(line) {
  const box = el("#status-log");
  const row = document.createElement("div");
  row.className = "status-line";
  row.textContent = line;
  box.appendChild(row);
  if (box.childElementCount > 80) box.removeChild(box.firstElementChild);
  box.scrollTop = box.scrollHeight;
}

function setAutomations(on) {
  el("#auto-dot").classList.toggle("on", on);
  el("#auto-dot").classList.toggle("off", !on);
  el("#auto-label").textContent = on ? "Automations running" : "Automations stopped";
}

function setAgents(mode) {
  const runningAgents = mode === "running";
  el("#agent-dot").classList.toggle("on", runningAgents);
  el("#agent-dot").classList.toggle("off", !runningAgents);
  el("#agent-label").textContent = runningAgents ? "Agents running" : "Agents idle";
}

function setRunning(v) {
  running = v;
  const btn = el("#run-btn");
  btn.disabled = v;
  btn.textContent = v ? "Running…" : "Run";
  setAgents(v ? "running" : "idle");
}

function showResult(text, isError) {
  const box = el("#result");
  el("#result-text").textContent = isError ? `⚠ ${text}` : text;
  box.classList.remove("hidden");
  box.classList.toggle("error", !!isError);
}

async function refreshStatus() {
  try {
    const s = await invoke("get_engine_status");
    setAutomations(!!s.automations_running);
    setAgents(s.agents_running ? "running" : "idle");
    if (s.workspace) appendStatus(`workspace → ${s.workspace}`);
    if (s.quorum_dir) appendStatus(`.quorum → ${s.quorum_dir}`);
    if (s.mcp_command) appendStatus(`MCP: ${s.mcp_command}`);
    for (const line of s.log || []) appendStatus(line);
  } catch (e) {
    appendStatus(`status error: ${e}`);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  refreshStatus();

  listen("quorum-status", (e) => {
    appendStatus(String(e.payload));
  });

  listen("quorum-agents", (e) => {
    setAgents(String(e.payload));
    if (String(e.payload) === "idle") setRunning(false);
  });

  listen("quorum-event", (e) => {
    let ev;
    try {
      ev = JSON.parse(e.payload);
    } catch {
      return;
    }
    if (ev.type === "__final__") {
      showResult(ev.text || "", false);
      setRunning(false);
      return;
    }
    if (ev.type === "__error__") {
      showResult(ev.text || "error", true);
      setRunning(false);
      return;
    }
    addBubble(ev);
  });

  el("#task-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (running) return;
    const task = escapeText(el("#task-input").value).trim();
    if (!task) return;
    el("#feed").innerHTML = "";
    el("#result").classList.add("hidden");
    setRunning(true);
    invoke("run_task", { task }).catch((err) => {
      showResult(String(err), true);
      setRunning(false);
    });
  });
});
