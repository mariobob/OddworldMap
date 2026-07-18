// Settings: the sidebar gear button, its overlay and the persisted options.
// The module stays importable in bare Node: no DOM access at import time and
// localStorage only inside the guarded store calls. initSettings() does all
// the DOM wiring.

import { CATS } from "./config.js";
import { state } from "./state.js";
import { parseHash } from "./model.js";
import { GEAR_SVG } from "./icons.js";

const SETTINGS_KEY = "owm:settings";
const VIEW_KEY = "owm:view";
const LOC_KEY = "owm:lastloc";

export const SETTINGS_DEFAULTS = { rememberView: true, rememberLoc: false };
export const SHOW_KEYS = ["grid", "coll", "fg", "labels", "dim"];

// localStorage may be unavailable (private mode, blocked); never let that break the viewer
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// copy only known keys with the expected type; anything else keeps its default
export function sanitizeSettings(raw) {
  const s = { ...SETTINGS_DEFAULTS };
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return s;
  }
  if (!p || typeof p !== "object") return s;
  for (const k of Object.keys(SETTINGS_DEFAULTS)) if (typeof p[k] === "boolean") s[k] = p[k];
  return s;
}

// stored display/filter snapshot -> { show, cats } with only known boolean keys
export function sanitizeView(raw) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object") return null;
  const view = { show: {}, cats: {} };
  for (const k of SHOW_KEYS) if (p.show && typeof p.show[k] === "boolean") view.show[k] = p.show[k];
  for (const c of CATS)
    if (p.cats && typeof p.cats[c.key] === "boolean") view.cats[c.key] = p.cats[c.key];
  return view;
}

let settings = null;

export function getSettings() {
  if (!settings) settings = sanitizeSettings(store.get(SETTINGS_KEY));
  return settings;
}

// the persisted display/filter snapshot, or null when off/absent/corrupt
export function getViewSnapshot() {
  return getSettings().rememberView ? sanitizeView(store.get(VIEW_KEY)) : null;
}

// called by sidebar.js whenever a display toggle or object filter changes
export function viewChanged() {
  if (!getSettings().rememberView) return;
  const cats = {};
  CATS.forEach((c) => (cats[c.key] = c.on));
  store.set(VIEW_KEY, JSON.stringify({ show: state.show, cats }));
}

// a candidate "#GAME/LEVEL/…" permalink string, or null; whether its level and
// path still exist is applyHash's job to validate
export function sanitizeLocationHash(raw) {
  return typeof raw === "string" && raw.startsWith("#") && parseHash(raw) ? raw : null;
}

// called by navigate.js whenever the permalink hash is (re)written
export function rememberLocation(hash) {
  if (getSettings().rememberLoc && sanitizeLocationHash(hash)) store.set(LOC_KEY, hash);
}

// the remembered permalink for hashless loads, or null when off/absent/corrupt
export function storedLocationHash() {
  return getSettings().rememberLoc ? sanitizeLocationHash(store.get(LOC_KEY)) : null;
}

export function clearStoredLocation() {
  store.remove(LOC_KEY);
}

export function initSettings() {
  const s = getSettings();
  const $ = (id) => document.getElementById(id);
  const btn = $("settingsBtn"),
    overlay = $("settingsOverlay"),
    closeBtn = $("settingsClose");
  btn.innerHTML = GEAR_SVG;

  const open = () => {
    document.body.classList.add("settings-open");
    closeBtn.focus();
  };
  const close = () => {
    document.body.classList.remove("settings-open");
    btn.focus();
  };
  btn.onclick = open;
  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("settings-open")) close();
  });

  // seed each checkbox from the stored settings, then persist + apply on change
  const bind = (id, key, apply) => {
    const cb = $(id);
    cb.checked = s[key];
    cb.onchange = () => {
      s[key] = cb.checked;
      store.set(SETTINGS_KEY, JSON.stringify(s));
      apply(cb.checked);
    };
  };

  bind("sRememberView", "rememberView", (on) => {
    if (on)
      viewChanged(); // capture the current view right away
    else store.remove(VIEW_KEY);
  });

  bind("sRememberLoc", "rememberLoc", (on) => {
    if (on)
      rememberLocation(location.hash); // capture the current spot right away
    else store.remove(LOC_KEY);
  });
}
