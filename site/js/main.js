import { createOS } from "./os.js";

const params = new URLSearchParams(location.search);
const pct = document.getElementById("loader-pct");
const os = createOS();
const apps = new Set(os.apps);
// The bare desktop. Also the id of the one screen in the room, which is how you get there.
const DESKTOP = "menu";
let room = null;

function wantsFallback() {
  return (
    params.has("fallback") ||
    !("WebGL2RenderingContext" in window) ||
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    navigator.connection?.saveData === true ||
    (navigator.deviceMemory ?? 8) <= 2
  );
}

// The 2M-splat world needs a strong GPU (an integrated one manages ~20 fps), so the
// 500K version is the default and the full one is reserved for GPUs known to cope.
const STRONG_GPU = /NVIDIA|GeForce|Quadro|Radeon (RX|Pro)|Apple M\d/i;

function gpuName() {
  const gl = document.createElement("canvas").getContext("webgl2");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "";
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return name;
}

function wantsLowRes() {
  const forced = params.get("splat");
  if (forced === "low") return true;
  if (forced === "full") return false;
  if (matchMedia("(pointer: coarse), (max-width: 820px)").matches) return true;
  return !STRONG_GPU.test(gpuName());
}

const mode = () => document.body.dataset.mode;
const setMode = (value) => (document.body.dataset.mode = value);

function currentTarget() {
  const id = decodeURIComponent(location.hash.slice(1));
  return apps.has(id) || id === DESKTOP ? id : null;
}

// The hash is the single source of truth: #menu is the desktop, #app is that app open on it, no hash is the room.
// Changes are applied one at a time so a flight always finishes before the next one starts.
let queue = Promise.resolve();
function route() {
  queue = queue.then(applyRoute).catch(console.error);
}

async function applyRoute() {
  const target = currentTarget();
  if (target) {
    const app = target === DESKTOP ? null : target;
    if (!os.visible) {
      if (room) {
        await room.flyTo(DESKTOP);
        room.setPaused(true);
      }
      const shown = os.show({ animate: mode() !== "fallback" });
      if (app) os.open(app);
      await shown;
    } else if (app) {
      os.open(app);
    }
  } else {
    // "Exit to room" is a plain href="#"; tidy the leftover fragment.
    if (location.href.endsWith("#")) history.replaceState(null, "", location.pathname + location.search);
    if (!os.visible || mode() === "fallback") return;
    await os.hide();
    if (room) {
      room.setPaused(false);
      await room.flyHome();
    }
  }
}

os.onNavigate = (id, { quiet = false } = {}) => {
  if (quiet) return history.replaceState(null, "", `#${id}`);
  location.hash = id ?? DESKTOP;
};

os.onExit = () => {
  history.pushState(null, "", location.pathname + location.search);
  route();
};

window.addEventListener("hashchange", route);

function enterFallback() {
  setMode("fallback");
  if (!currentTarget()) history.replaceState(null, "", "#about");
  route();
}

async function bootRoom() {
  const editing = params.has("edit");
  const [{ createRoom }, world] = await Promise.all([
    import("./room.js"),
    fetch("data/world.json").then((r) => r.json()),
  ]);
  const built = await createRoom(document.getElementById("room"), world, {
    lowRes: wantsLowRes(),
    drift: !editing,
    onProgress: (e) => {
      if (e.lengthComputable) pct.textContent = `${Math.round((e.loaded / e.total) * 100)}%`;
    },
    onSelect: (id) => (location.hash = id),
  });
  // Let any route that started while loading finish before the room joins in.
  await queue;
  room = built;
  if (os.visible) room.setPaused(true);
  setMode("room");

  if (params.has("debug")) window.__room = room;
  if (editing) {
    const { startEdit } = await import("./edit.js");
    const list = [{ id: DESKTOP, label: "Menu" }];
    window.__edit = startEdit(room, world, list);
  }
}

if (wantsFallback()) {
  enterFallback();
} else {
  route();
  bootRoom().catch((err) => {
    console.error(err);
    enterFallback();
  });
}
