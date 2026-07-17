// "What's New": a dated changelog panel driven by changelog.json.
// Wires itself up at import time; if the feed is missing the button stays hidden.

import { $ } from "./dom.js";
import { esc } from "./util.js";
import { NEWSPAPER_SVG } from "./icons.js";

const PREVIEW_N = 5; // entries shown before "see all"
const SEEN_KEY = "owm:whatsnew:lastSeen"; // newest date the visitor has opened
const TAGS = new Set(["new", "improved", "fixed"]);
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

// localStorage may be unavailable (private mode, blocked); never let that break the panel
const store = {
  get: () => {
    try {
      return localStorage.getItem(SEEN_KEY);
    } catch {
      return null;
    }
  },
  set: (v) => {
    try {
      localStorage.setItem(SEEN_KEY, v);
    } catch {
      /* ignore */
    }
  },
};

init();

async function init() {
  let entries;
  try {
    const r = await fetch("changelog.json", { cache: "no-cache" });
    if (!r.ok) return;
    entries = (await r.json()).entries;
  } catch {
    return;
  }
  if (!Array.isArray(entries) || !entries.length) return;

  const btn = $("whatsnewBtn"),
    overlay = $("whatsnewOverlay");
  const body = $("whatsnewBody"),
    closeBtn = $("whatsnewClose");
  const newest = entries[0].date;

  const render = (expanded) => {
    const shown = expanded ? entries : entries.slice(0, PREVIEW_N);
    let html = "",
      lastDate = null;
    for (const e of shown) {
      if (e.date !== lastDate) {
        html += `<div class="wn-date">${esc(fmtDate(e.date))}</div>`;
        lastDate = e.date;
      }
      const tag = TAGS.has(e.tag) ? `<span class="wn-tag wn-tag-${e.tag}">${e.tag}</span>` : "";
      const detail = e.detail ? `<div class="wn-detail">${esc(e.detail)}</div>` : "";
      html += `<div class="wn-entry">${tag}<span class="wn-title">${esc(e.title)}</span>${detail}</div>`;
    }
    if (!expanded && entries.length > PREVIEW_N)
      html += `<button class="wn-more" id="whatsnewMore">See all ${entries.length} updates</button>`;
    body.innerHTML = html;
    const more = $("whatsnewMore");
    if (more) more.onclick = () => render(true);
  };

  const open = () => {
    render(false);
    document.body.classList.add("whatsnew-open");
    btn.classList.remove("hasnew");
    store.set(newest);
    closeBtn.focus();
  };
  const close = () => {
    document.body.classList.remove("whatsnew-open");
    btn.focus();
  };

  const seen = store.get();
  if (!seen || newest > seen) btn.classList.add("hasnew");

  btn.onclick = open;
  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("whatsnew-open")) close();
  });

  btn.insertAdjacentHTML("afterbegin", NEWSPAPER_SVG);
  btn.hidden = false;
}
