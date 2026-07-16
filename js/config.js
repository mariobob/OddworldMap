// Viewer-wide tunables, colors and the object category tables.

export const ZOOM_MIN = 0.02, ZOOM_MAX = 4;              // manual zoom clamp (px per draw unit)
export const FOCUS_ZOOM_MIN = 0.5, FOCUS_ZOOM_MAX = 1.6; // zoom clamp when jumping to an object
export const FOCUS_SCREENS = 2.6;                        // jump target: ~this many screens across
export const FLASH_MS = 1600;                            // follow-destination highlight duration
export const TIP_MAX_W = 340;                            // keep in sync with #tip max-width in CSS
export const narrowMQ = window.matchMedia("(max-width: 720px)");   // keep in sync with the CSS breakpoint

// canvas colors shared with the stylesheet, read once from the tokens
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const COLOR = { bg: cssVar("--bg"), mapBg: cssVar("--map-bg"), mapBgRgb: cssVar("--map-bg-rgb"),
                       cellEmpty: cssVar("--cell-empty"), accentRgb: cssVar("--accent-rgb") };

export const LINE_COLORS = { 0:"#43d94c", 1:"#ff5c5c", 2:"#ff9d3d", 3:"#5ca9ff", 4:"#2b8f33", 5:"#a33c3c", 6:"#a3702b" };
export const LINE_NAMES = { 0:"Floor", 1:"Wall (left)", 2:"Wall (right)", 3:"Ceiling",
                            4:"Background floor", 5:"Background wall (left)", 6:"Background wall (right)" };

// ---- categories (matched by TLV name so both games share the buckets) ----
export const CATS = [
  { key:"board",  label:"LCD Status Boards", color:"#ff3860", on:true, names:["LCDStatusBoard"] },
  { key:"mud",    label:"Mudokons",          color:"#3ec6ff", on:true, names:["Mudokon","SlingMudokon","RingMudokon","LiftMudokon","MudokonPathTrans","TorturedMudokon"] },
  { key:"door",   label:"Doors / Transitions", color:"#ffd23e", on:true, names:["Door","PathTransition","BirdPortal","BirdPortalExit","WellLocal","LocalWell","WellExpress","Teleporter","TrainDoor","SlamDoor","MineCar"] },
  { key:"cont",   label:"Continue points",   color:"#ffffff", on:true, names:["ContinuePoint","AbeStart","ElumStart"] },
  { key:"switch", label:"Switches / levers", color:"#5dde75", on:true, names:["Switch","Lever","InvisibleSwitch","FootSwitch","BellHammer","HandStone","IdSplitter","SecurityOrb","SecurityDoor","BellSongStone","ChimeLock","MovieHandStone","GlukkonSwitch","CrawlingSligButton","MultiSwitchController","WheelSyncer","WorkWheel","SlapLock"] },
  { key:"hazard", label:"Hazards",           color:"#ff8b3d", on:true, names:["DeathDrop","TimedMine","Mine","UXB","ElectricWall","DoorFlame","MovingBomb","MeatSaw","BoomMachine","DeathClock","GasEmitter","GasCountdown","TrapDoor","FallingItem","RollingBall","RollingRock","ZBall","Drill","LaughingGas","ExplosionSet","BrewMachine","Water"] },
  { key:"enemy",  label:"Enemies / spawners", color:"#c85dff", on:true, names:["Slig","Slog","Paramite","Scrab","Bat","Bees","SligSpawner","SlogSpawner","ScrabSpawner","Glukkon","SlogHut","FlyingSlig","FlyingSligSpawner","CrawlingSlig","Fleech","Slurg","SlurgSpawner","ZzzSpawner","Greeter","SligGetPants","SligGetWings","BeeSwarmHole"] },
  { key:"screen", label:"Screens / pickups", color:"#3effc8", on:false, names:["LCDScreen","LCD","MovieStone","HintFly","DemoPlaybackStone","Honey","HoneySack","HoneyDripTarget","MeatSack","RockSack","BoneBag","Dove","StatusLight","ColourfulMeter"] },
  { key:"nav",    label:"Hoists / edges / lifts", color:"#8f9bb3", on:false, names:["Hoist","Edge","LiftPoint","LiftMover","Pulley","PullRingRope","ElumWall","ScrabNoFall","RollingBallStopper","FlintLockFire","ParamiteWebLine"] },
  { key:"meta",   label:"Meta / bounds / fx", color:"#5b6270", on:false, names:[] },   // fallback for everything else
];
const NAME_CAT = {};
CATS.forEach(c => c.names.forEach(n => NAME_CAT[n] = c));
const META_CAT = CATS[CATS.length - 1];
export const catOf = t => NAME_CAT[t.name] || META_CAT;
