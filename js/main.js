// Boot: fetch the map data, then hand over to the modules.

import { $ } from "./dom.js";
import { resize } from "./render.js";
import { initGames, selectGame, applyHash } from "./navigate.js";
import { initSettings, storedLocationHash, clearStoredLocation } from "./settings.js";
import "./sidebar.js";
import "./search.js";
import { toggleMenu } from "./interaction.js";
import "./whatsnew.js";

initSettings();

// ?embed=1: iframe view (wikis, forums) — chrome hides via body.embed, and
// the hash still works, so an embed can point at an exact screen
const embedded = new URLSearchParams(location.search).get("embed") === "1";
if (embedded) {
  document.body.classList.add("embed");
  toggleMenu(false);
}

async function loadOne(file) {
  try {
    // no-cache revalidates (ETag/304) so rebuilds still show up immediately,
    // but an unchanged dataset is not re-downloaded
    const r = await fetch(file, { cache: "no-cache" });
    if (r.ok) return await r.json();
  } catch {
    /* tolerate a missing dataset */
  }
  return null;
}

Promise.all([loadOne("map_data_ao.json"), loadOne("map_data_ae.json")]).then((datasets) => {
  const games = datasets.filter((d) => d && d.levels && d.levels.length);
  if (!games.length) {
    $("gameName").textContent = "Map data failed to load.";
    $("help").textContent =
      "map data failed to load — check that map_data_ao.json / map_data_ae.json are served";
    return;
  }
  initGames(games);
  resize();
  if (!applyHash()) {
    // no usable permalink in the URL: fall back to the remembered location
    // (never in an embed, which gets the default view)
    const stored = embedded ? null : storedLocationHash();
    if (stored) history.replaceState(null, "", stored); // silent: no history entry, no hashchange
    if (!stored || !applyHash()) {
      if (stored) clearStoredLocation(); // its level or path no longer exists
      selectGame(games[0]);
    }
  }
});
