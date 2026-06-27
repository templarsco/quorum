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

function setRunning(v) {
  running = v;
  const btn = el("#run-btn");
  btn.disabled = v;
  btn.textContent = v ? "Running…" : "Run";
}

function showResult(text, isError) {
  const box = el("#result");
  el("#result-text").textContent = isError ? `⚠ ${text}` : text;
  box.classList.remove("hidden");
  box.classList.toggle("error", !!isError);
}

window.addEventListener("DOMContentLoaded", () => {
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
    invoke("run_task", { task });
  });
});
