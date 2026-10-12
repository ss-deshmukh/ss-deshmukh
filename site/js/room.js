import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const PITCH_LIMIT = THREE.MathUtils.degToRad(55);
const DRAG_SPEED = 0.0025;
const DAMPING = 8;
const IDLE_AFTER_MS = 4000;
const DRIFT_SPEED = 0.02;
const TAP_SLOP = 6;
const FLY_MS = 1600;
const SCREEN_LIFT = 0.02;
const MIN_HFOV = THREE.MathUtils.degToRad(62);
const MAX_VFOV = 95;
const IDLE_TINT = 0xaab8c2;
const HOVER_TINT = 0xffffff;
const MONO = 'ui-monospace, "SF Mono", "Fira Code", Menlo, Consolas, monospace';

export async function createRoom(canvas, world, { lowRes = false, drift = true, onProgress, onSelect } = {}) {
  // Splats gain nothing from MSAA, so keep it off.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowRes ? 1.5 : 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(world.camera.fov, 1, 0.01, 1000);
  const home = new THREE.Vector3().fromArray(world.camera.position);
  camera.position.copy(home);
  camera.rotation.order = "YXZ";

  scene.add(new SparkRenderer({ renderer }));

  const url = lowRes ? world.splat.urlLowRes : world.splat.url;
  const splat = new SplatMesh({ url, onProgress });
  splat.position.fromArray(world.splat.position);
  splat.quaternion.fromArray(world.splat.quaternion);
  scene.add(splat);

  const screens = (world.monitors ?? []).map(makeScreen);
  for (const screen of screens) scene.add(screen);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pointerRay(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }
  const screenAt = (e) => pointerRay(e.clientX, e.clientY).intersectObjects(screens)[0]?.object ?? null;

  let hovered = null;
  function setHovered(screen) {
    if (screen === hovered) return;
    hovered?.material.color.setHex(IDLE_TINT);
    screen?.material.color.setHex(HOVER_TINT);
    hovered = screen;
    canvas.classList.toggle("over-screen", !!screen);
  }

  const room = { renderer, scene, camera, splat, screens, pointerRay, onTap: null };

  // Portrait screens start turned towards the nearest monitors, which would otherwise be off-frame.
  const portrait = canvas.clientWidth < canvas.clientHeight;
  const start = { ...world.camera, yaw: (portrait && world.camera.yawPortrait) || world.camera.yaw };
  const look = createLookControls(canvas, start, {
    drift,
    onHover: (e) => setHovered(screenAt(e)),
    onTap: (e) => {
      if (room.onTap) return room.onTap(e);
      const screen = screenAt(e);
      if (screen) onSelect?.(screen.userData.id);
    },
  });
  room.look = look;

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Widen the lens on portrait screens so the room doesn't feel like a keyhole.
    const forWidth = 2 * Math.atan(Math.tan(MIN_HFOV / 2) / camera.aspect);
    camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(forWidth), world.camera.fov, MAX_VFOV);
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  // The camera is either at home (look controls drive it), mid-flight, or parked at a screen.
  let flight = null;
  let parkedAt = null;

  function fly(toP, toQ, ms) {
    return new Promise((resolve) => {
      flight = { fromP: camera.position.clone(), fromQ: camera.quaternion.clone(), toP, toQ, start: performance.now(), ms, resolve };
    });
  }

  room.flyTo = async (id, { instant = false } = {}) => {
    const screen = screens.find((s) => s.userData.id === id) ?? screens[0];
    if (!screen || parkedAt === screen) return;
    setHovered(null);
    look.enabled = false;
    parkedAt = screen;
    const { width, height } = screen.geometry.parameters;
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = 0.97 * Math.max(height / 2 / half, width / 2 / (half * camera.aspect));
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(screen.quaternion);
    await fly(screen.position.clone().addScaledVector(normal, dist), screen.quaternion.clone(), instant ? 0 : FLY_MS);
  };

  room.flyHome = async () => {
    if (!parkedAt) return;
    const dir = parkedAt.position.clone().sub(home).normalize();
    look.face(Math.atan2(-dir.x, -dir.z), Math.asin(dir.y));
    const toQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, "YXZ"));
    await fly(home.clone(), toQ, FLY_MS);
    parkedAt = null;
    look.enabled = true;
  };

  const clock = new THREE.Clock();
  function frame() {
    const dt = clock.getDelta();
    if (flight) {
      const t = flight.ms ? Math.min((performance.now() - flight.start) / flight.ms, 1) : 1;
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(flight.fromP, flight.toP, k);
      camera.quaternion.slerpQuaternions(flight.fromQ, flight.toQ, k);
      if (t === 1) {
        const { resolve } = flight;
        flight = null;
        resolve();
      }
    } else if (!parkedAt) {
      look.update(dt);
      camera.rotation.set(look.pitch, look.yaw, 0);
    }
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  room.setPaused = (paused) => {
    clock.getDelta();
    renderer.setAnimationLoop(paused ? null : frame);
  };

  try {
    await splat.initialized;
  } catch (err) {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    throw err;
  }
  return room;
}

function makeScreen(m) {
  const texture = new THREE.CanvasTexture(drawLabel(m.label, m.width / m.height));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(m.width, m.height),
    new THREE.MeshBasicMaterial({ map: texture, color: IDLE_TINT, toneMapped: false }),
  );
  mesh.position.fromArray(m.position);
  mesh.quaternion.fromArray(m.quaternion);
  // Sit just in front of the blurry screen baked into the splat.
  mesh.translateZ(SCREEN_LIFT);
  mesh.userData.id = m.id;
  return mesh;
}

function drawLabel(label, aspect) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = Math.round(1024 / aspect);
  const g = c.getContext("2d");
  const { width: w, height: h } = c;

  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#07192b");
  bg.addColorStop(1, "#0e3d5e");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  const bar = h * 0.13;
  g.fillStyle = "rgb(255 255 255 / 0.08)";
  g.fillRect(0, 0, w, bar);
  ["#f87171", "#fbbf24", "#34d399"].forEach((colour, i) => {
    g.fillStyle = colour;
    g.beginPath();
    g.arc(bar * (0.6 + i * 0.55), bar / 2, bar * 0.16, 0, Math.PI * 2);
    g.fill();
  });
  g.textBaseline = "middle";
  g.font = `${bar * 0.5}px ${MONO}`;
  g.fillStyle = "#7dd3fc";
  g.fillText(`~/${label.toLowerCase().replace(/\s+/g, "-")}`, bar * 2.5, bar / 2);

  const title = label.toUpperCase();
  let size = h * 0.3;
  g.font = `700 ${size}px ${MONO}`;
  size *= Math.min(1, (w * 0.84) / g.measureText(title).width);
  g.font = `700 ${size}px ${MONO}`;
  g.textAlign = "center";
  g.fillStyle = "#eaf7ff";
  g.shadowColor = "#38bdf8";
  g.shadowBlur = size * 0.35;
  g.fillText(title, w / 2, h * 0.53);
  g.shadowBlur = 0;

  g.font = `${h * 0.075}px ${MONO}`;
  g.fillStyle = "#7dd3fc";
  g.fillText("▸ click to open", w / 2, h * 0.82);

  g.strokeStyle = "#38bdf8";
  g.lineWidth = h * 0.014;
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  return c;
}

function createLookControls(el, start, { drift, onHover, onTap }) {
  const state = { yaw: start.yaw, pitch: start.pitch, enabled: true };
  const target = { yaw: start.yaw, pitch: start.pitch };
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  let lastInput = performance.now();

  el.addEventListener("pointerdown", (e) => {
    if (!state.enabled) return;
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
  });

  el.addEventListener("pointermove", (e) => {
    if (!state.enabled) return;
    if (!dragging) return onHover(e);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    target.yaw += dx * DRAG_SPEED;
    target.pitch = THREE.MathUtils.clamp(target.pitch + dy * DRAG_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
    lastX = e.clientX;
    lastY = e.clientY;
    lastInput = performance.now();
  });

  el.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    if (moved < TAP_SLOP) onTap(e);
  });
  el.addEventListener("pointercancel", () => {
    dragging = false;
    el.classList.remove("dragging");
  });

  state.face = (yaw, pitch) => {
    state.yaw = target.yaw = yaw;
    state.pitch = target.pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
    lastInput = performance.now();
  };

  state.update = (dt) => {
    if (drift && !dragging && performance.now() - lastInput > IDLE_AFTER_MS) {
      target.yaw += DRIFT_SPEED * dt;
    }
    const k = 1 - Math.exp(-DAMPING * dt);
    state.yaw += (target.yaw - state.yaw) * k;
    state.pitch += (target.pitch - state.pitch) * k;
  };

  return state;
}
