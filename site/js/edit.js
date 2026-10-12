// Calibration mode (?edit): click the four corners of a monitor to place its screen quad,
// then copy the JSON into data/world.json.
import * as THREE from "three";

const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
const GRID = 6;

export function startEdit(room, world, apps) {
  const { camera, splat, scene } = room;
  // Ignore the faint floaters that hang in front of surfaces.
  splat.minRaycastOpacity = 0.3;
  const monitors = new Map((world.monitors ?? []).map((m) => [m.id, m]));
  const outlines = new Map();
  let clicks = [];

  const panel = document.createElement("div");
  panel.id = "edit-panel";
  panel.innerHTML = `
    <label>Screen <select></select></label>
    <p></p>
    <button data-do="view">Use current view as start</button>
    <button data-do="remove">Remove this screen</button>
    <button data-do="copy">Copy JSON</button>
    <textarea readonly rows="6"></textarea>`;
  document.body.appendChild(panel);
  const select = panel.querySelector("select");
  const status = panel.querySelector("p");
  const output = panel.querySelector("textarea");
  select.innerHTML = apps.map((a) => `<option value="${a.id}">${a.label}</option>`).join("");

  function snapshot() {
    return {
      ...world,
      camera: { ...world.camera },
      monitors: [...monitors.values()],
    };
  }

  function refresh() {
    const next = CORNERS[clicks.length];
    status.textContent = `${monitors.has(select.value) ? "Placed." : "Not placed."} Click the ${next} corner. Scroll to zoom.`;
    output.value = JSON.stringify(snapshot(), null, 2);
    for (const [id, line] of outlines) {
      scene.remove(line);
      if (!monitors.has(id)) outlines.delete(id);
    }
    for (const m of monitors.values()) {
      const line = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(m.width, m.height)),
        new THREE.LineBasicMaterial({ color: m.id === select.value ? 0xfbbf24 : 0x34d399, depthTest: false, transparent: true }),
      );
      line.position.fromArray(m.position);
      line.quaternion.fromArray(m.quaternion);
      line.renderOrder = 10;
      outlines.set(m.id, line);
      scene.add(line);
    }
  }

  function place(id, corners) {
    const { hits, inliers, ...quad } = quadFromPixels(corners);
    const label = apps.find((a) => a.id === id)?.label ?? id;
    monitors.set(id, { id, label, ...quad });
    refresh();
    return { ...monitors.get(id), hits, inliers };
  }

  // Fit a plane to splat hits inside the clicked outline, then project the corners onto it.
  function quadFromPixels(corners) {
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const [tl, tr, br, bl] = corners;
    const toView = camera.matrixWorldInverse;
    camera.updateMatrixWorld();

    const hits = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const s = 0.18 + (0.64 * i) / (GRID - 1);
        const t = 0.18 + (0.64 * j) / (GRID - 1);
        const [x, y] = lerp(lerp(tl, tr, s), lerp(bl, br, s), t);
        const hit = room.pointerRay(x, y).intersectObject(splat)[0];
        if (hit) hits.push(hit.point.clone().applyMatrix4(toView));
      }
    }
    if (hits.length < 6) throw new Error(`Only ${hits.length} splat hits inside the outline`);

    const plane = ransacDepthPlane(hits);
    const inliers = plane.inliers;

    // Ray through the camera origin: p = d * s, on the plane when z = a x + b y + c.
    const world3 = corners.map(([x, y]) => {
      const d = room.pointerRay(x, y).ray.direction.clone().transformDirection(toView);
      const s = plane.c / (d.z - plane.a * d.x - plane.b * d.y);
      return d.multiplyScalar(s).applyMatrix4(camera.matrixWorld);
    });
    const [TL, TR, BR, BL] = world3;

    const right = TR.clone().sub(TL).add(BR.clone().sub(BL)).normalize();
    const upish = TL.clone().sub(BL).add(TR.clone().sub(BR));
    const normal = right.clone().cross(upish).normalize();
    const up = normal.clone().cross(right);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
    const centre = TL.clone().add(TR).add(BR).add(BL).multiplyScalar(0.25);
    const round = (n) => +n.toFixed(4);
    return {
      position: centre.toArray().map(round),
      quaternion: quaternion.toArray().map(round),
      width: round((TR.distanceTo(TL) + BR.distanceTo(BL)) / 2),
      height: round((TL.distanceTo(BL) + TR.distanceTo(BR)) / 2),
      hits: hits.length,
      inliers,
    };
  }

  room.onTap = (e) => {
    clicks.push([e.clientX, e.clientY]);
    if (clicks.length === 4) {
      try {
        place(select.value, clicks);
      } catch (err) {
        status.textContent = err.message;
      }
      clicks = [];
    }
    refresh();
  };

  room.renderer.domElement.addEventListener("wheel", (e) => {
    e.preventDefault();
    camera.fov = THREE.MathUtils.clamp(camera.fov + Math.sign(e.deltaY) * 3, 12, 80);
    camera.updateProjectionMatrix();
  }, { passive: false });

  select.addEventListener("change", () => {
    clicks = [];
    refresh();
  });

  panel.addEventListener("click", (e) => {
    const action = e.target.dataset?.do;
    if (action === "view") {
      const key = innerWidth < innerHeight ? "yawPortrait" : "yaw";
      world.camera[key] = +room.look.yaw.toFixed(4);
      world.camera.pitch = +room.look.pitch.toFixed(4);
    } else if (action === "remove") {
      monitors.delete(select.value);
    } else if (action === "copy") {
      navigator.clipboard?.writeText(output.value);
    } else {
      return;
    }
    refresh();
  });

  refresh();
  return { place, quadFromPixels, snapshot };
}

// Plane through the largest group of points that agree to within 1.5% of their depth.
function ransacDepthPlane(points) {
  let seed = 1;
  const pick = () => points[(seed = (seed * 1103515245 + 12345) & 0x7fffffff) % points.length];
  const supporters = (plane) =>
    points.filter((p) => Math.abs(plane.a * p.x + plane.b * p.y + plane.c - p.z) < 0.015 * Math.abs(p.z));
  let best = [];
  for (let i = 0; i < 300; i++) {
    const sample = [pick(), pick(), pick()];
    if (new Set(sample).size < 3) continue;
    const plane = fitDepthPlane(sample);
    if (!Number.isFinite(plane.c)) continue;
    const found = supporters(plane);
    if (found.length > best.length) best = found;
  }
  if (best.length < 6) throw new Error("Could not find a flat surface inside the outline");
  return { ...fitDepthPlane(best), inliers: best.length };
}

// Least-squares z = a x + b y + c.
function fitDepthPlane(points) {
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  const n = points.length;
  for (const { x, y, z } of points) {
    sxx += x * x; sxy += x * y; sx += x;
    syy += y * y; sy += y;
    sxz += x * z; syz += y * z; sz += z;
  }
  const m = new THREE.Matrix3().set(sxx, sxy, sx, sxy, syy, sy, sx, sy, n).invert();
  const v = new THREE.Vector3(sxz, syz, sz).applyMatrix3(m);
  return { a: v.x, b: v.y, c: v.z };
}
