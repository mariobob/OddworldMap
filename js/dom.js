// Cached references to the static DOM and browser-environment handles.

export const $ = id => document.getElementById(id);

export const narrowMQ = window.matchMedia("(max-width: 720px)");   // keep in sync with the CSS breakpoint

export const cv = $("cv"), ctx = cv.getContext("2d");
export const tip = $("tip"), hud = $("hud");
export const menuBtn = $("menuBtn"), scrim = $("scrim");
export const gameBtns = $("gameBtns"), levelBtns = $("levelBtns"), pathBtns = $("pathBtns");
export const filterBox = $("filterBox");
export const searchInput = $("searchInput"), searchResults = $("searchResults"), scopeBar = $("scopeBar");
