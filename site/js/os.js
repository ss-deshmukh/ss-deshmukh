// Desktop shell: windows, dock, clock. Navigation is driven by the URL hash in main.js.
const BOOT_MS = 700;
const CLOSE_MS = 250;

export function createOS() {
  const root = document.getElementById("os");
  const desktop = root.querySelector(".desktop");
  const appName = document.getElementById("os-app");
  const clock = document.getElementById("os-clock");
  const windows = new Map([...root.querySelectorAll(".window")].map((el) => [el.dataset.app, el]));
  const dock = new Map([...root.querySelectorAll(".dock a")].map((a) => [a.hash.slice(1), a]));
  const small = matchMedia("(max-width: 820px)");
  let z = 1;
  let opened = 0;
  let focused = null;

  const os = {
    apps: [...windows.keys()],
    visible: false,
    // Called when the user closes or switches windows; main.js turns it into a hash change.
    onNavigate: () => {},
  };

  function tick() {
    clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  tick();
  setInterval(tick, 30000);

  function sync() {
    for (const [id, link] of dock) {
      link.classList.toggle("running", windows.get(id).classList.contains("open"));
      link.classList.toggle("active", id === focused);
    }
    for (const [id, win] of windows) win.classList.toggle("focused", id === focused);
    appName.textContent = focused ? windows.get(focused).dataset.title : "";
    document.title = focused ? `${windows.get(focused).dataset.title} · Siddhesh Deshmukh` : "Siddhesh Deshmukh - Software Engineer";
  }

  function topWindow() {
    return [...windows.entries()]
      .filter(([, win]) => win.classList.contains("open"))
      .sort(([, a], [, b]) => b.style.zIndex - a.style.zIndex)[0]?.[0] ?? null;
  }

  os.open = (id) => {
    const win = windows.get(id);
    if (!win) return;
    if (small.matches) for (const other of windows.values()) other.classList.remove("open");
    if (!win.classList.contains("open")) {
      win.classList.add("open");
      if (!win.style.left) {
        // Cascade new windows from the centre of the desktop.
        const step = (opened++ % 5) * 28;
        const roomX = desktop.clientWidth - win.offsetWidth;
        const roomY = desktop.clientHeight - win.offsetHeight;
        win.style.left = `${Math.max(16, Math.min(roomX / 2 - 56 + step, roomX - 16))}px`;
        win.style.top = `${Math.max(12, Math.min(roomY / 2 - 40 + step, roomY - 12))}px`;
      }
    }
    win.style.zIndex = ++z;
    focused = id;
    sync();
    win.focus({ preventScroll: true });
  };

  os.close = (id) => {
    const win = windows.get(id);
    win.classList.remove("open", "max");
    stopVideos(win);
    focused = topWindow();
    sync();
    os.onNavigate(focused);
  };

  os.show = async ({ animate = true } = {}) => {
    if (os.visible) return;
    os.visible = true;
    document.body.dataset.os = "";
    if (!animate) return;
    root.classList.add("booting");
    await wait(BOOT_MS);
    root.classList.remove("booting");
  };

  os.hide = async () => {
    if (!os.visible) return;
    root.classList.add("closing");
    await wait(CLOSE_MS);
    root.classList.remove("closing");
    for (const win of windows.values()) {
      win.classList.remove("open", "max");
      stopVideos(win);
    }
    focused = null;
    sync();
    os.visible = false;
    delete document.body.dataset.os;
  };

  for (const [id, win] of windows) {
    win.addEventListener("pointerdown", () => {
      if (focused === id) return;
      win.style.zIndex = ++z;
      focused = id;
      sync();
      os.onNavigate(id, { quiet: true });
    });
    win.querySelector(".close").addEventListener("click", () => os.close(id));
    win.querySelector(".zoom").addEventListener("click", () => win.classList.toggle("max"));
    makeDraggable(win, desktop, small);
  }

  root.addEventListener("click", (e) => {
    const link = e.target.closest("a.video");
    if (!link) return;
    e.preventDefault();
    const frame = document.createElement("iframe");
    frame.className = "player";
    frame.src = link.dataset.embed;
    frame.allow = "autoplay; fullscreen; picture-in-picture";
    frame.title = link.closest(".project").querySelector(".name").textContent;
    link.closest(".body").appendChild(frame);
    link.remove();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !os.visible) return;
    if (focused) os.close(focused);
    else os.onNavigate(null);
  });

  return os;
}

function stopVideos(win) {
  for (const frame of win.querySelectorAll("iframe.player")) frame.remove();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeDraggable(win, desktop, small) {
  const bar = win.querySelector(".titlebar");
  let grab = null;

  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || small.matches || win.classList.contains("max")) return;
    grab = { x: e.clientX - win.offsetLeft, y: e.clientY - win.offsetTop };
    bar.setPointerCapture(e.pointerId);
  });

  bar.addEventListener("pointermove", (e) => {
    if (!grab) return;
    // Keep the title bar reachable.
    const maxX = desktop.clientWidth - 80;
    const maxY = desktop.clientHeight - 40;
    win.style.left = `${Math.min(Math.max(e.clientX - grab.x, 80 - win.offsetWidth), maxX)}px`;
    win.style.top = `${Math.min(Math.max(e.clientY - grab.y, 0), maxY)}px`;
  });

  const drop = () => (grab = null);
  bar.addEventListener("pointerup", drop);
  bar.addEventListener("pointercancel", drop);
}
