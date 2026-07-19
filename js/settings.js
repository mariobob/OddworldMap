// Settings: the sidebar gear button, its overlay and the persisted options.
// The module stays importable in bare Node: no DOM access at import time and
// localStorage only inside the guarded store calls. initSettings() does all
// the DOM wiring.

import { CATS } from "./config.js";
import { state } from "./state.js";
import { parseHash } from "./model.js";
import { GEAR_SVG } from "./icons.js";
import { trapDialogKeys } from "./dialog.js";

const SETTINGS_KEY = "owm:settings";
const VIEW_KEY = "owm:view";
const LOC_KEY = "owm:lastloc";

export const SETTINGS_DEFAULTS = {
  rememberView: true,
  rememberLoc: false,
  fullNames: false,
  cacheImages: false,
};
export const SHOW_KEYS = ["grid", "coll", "fg", "conn", "labels", "dim"];

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

// a selector-button label: the short code alone, or "code (full name)" in
// full-names mode ("Oddworld: " is dropped so games read "AO (Abe's Oddysee)")
export function displayLabel(code, fullName, on) {
  const name = (fullName || "").replace(/^Oddworld:\s*/, "");
  return on && name ? `${code} (${name})` : code;
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
  trapDialogKeys(() => document.body.classList.contains("settings-open"), $("settings"), close);

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

  document.body.classList.toggle("fullnames", s.fullNames);
  bind("sFullNames", "fullNames", (on) => {
    document.body.classList.toggle("fullnames", on);
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: { key: "fullNames" } }));
  });

  applyCacheImages(s.cacheImages); // boot: register, or sweep leftovers from a mid-session disable
  bind("sCacheImages", "cacheImages", applyCacheImages);
}

// cam-artwork caching (sw.js) is opt-in; the worker can't read settings, so
// the page gates it. The "cams-on" marker bucket, not registration, is the
// real switch: unregister() leaves the worker controlling the page until
// reload, so only deleting the marker stops caching immediately.
function applyCacheImages(on) {
  if (!("serviceWorker" in navigator)) return;
  if (on) {
    if ("caches" in window) caches.open("cams-on").catch(() => {});
    navigator.serviceWorker.register("sw.js").catch(() => {});
    return;
  }
  // every registration on the origin: sw.js is the only worker there is
  navigator.serviceWorker.getRegistrations().then(
    (regs) => regs.forEach((r) => r.unregister()),
    () => {},
  );
  if ("caches" in window)
    caches.keys().then(
      (names) => names.filter((n) => n.startsWith("cams-")).forEach((n) => caches.delete(n)),
      () => {},
    );
}
