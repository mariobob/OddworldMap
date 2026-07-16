// Boot: fetch the map data, then hand over to the modules.

import { $ } from "./dom.js";
import { resize } from "./render.js";
import { initGames, selectGame, applyHash } from "./navigate.js";
import "./sidebar.js";
import "./search.js";
import "./interaction.js";

async function loadOne(file) {
  try {
    // no-cache revalidates (ETag/304) so rebuilds still show up immediately,
    // but an unchanged dataset is not re-downloaded
    const r = await fetch(file, { cache: "no-cache" });
    if (r.ok) return await r.json();
  } catch { /* tolerate a missing dataset */ }
  return null;
}

Promise.all([
  loadOne("map_data_ao.json"),
  loadOne("map_data_ae.json"),
]).then(datasets => {
  const games = datasets.filter(d => d && d.levels && d.levels.length);
  if (!games.length) {
    $("gameName").textContent = "Map data failed to load.";
    $("help").textContent = "map data failed to load — check that map_data_ao.json / map_data_ae.json are served";
    return;
  }
  initGames(games);
  resize();
  if (!applyHash()) selectGame(games[0]);
});
