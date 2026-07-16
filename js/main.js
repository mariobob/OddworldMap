// Boot: fetch the map data, then hand over to the modules.

import { $ } from "./dom.js";
import { resize } from "./render.js";
import { initGames, selectGame, applyHash } from "./navigate.js";
import "./sidebar.js";
import "./search.js";
import "./interaction.js";

// the generated data files are `window.MAP_DATA_* = {...}` scripts;
// fetch them and parse the JSON payload after the "="
async function loadOne(file) {
  try {
    // no-cache revalidates (ETag/304) so rebuilds still show up immediately,
    // but an unchanged dataset is not re-downloaded
    const t = await fetch(file, { cache: "no-cache" }).then(r => r.ok ? r.text() : null);
    if (t) return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
  } catch { /* tolerate a missing dataset */ }
  return null;
}

Promise.all([
  loadOne("map_data_ao.js"),
  loadOne("map_data_ae.js"),
]).then(datasets => {
  const games = datasets.filter(d => d && d.levels && d.levels.length);
  if (!games.length) {
    $("gameName").textContent = "Map data failed to load.";
    $("help").textContent = "map data failed to load — check that map_data_ao.js / map_data_ae.js are served";
    return;
  }
  initGames(games);
  resize();
  if (!applyHash()) selectGame(games[0]);
});
