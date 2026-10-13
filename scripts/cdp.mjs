// Drive headless Chrome over CDP. Node 22, no deps.
// node cdp.mjs [--target ID] [--url URL] [--w 1440 --h 810 --dpr 1 --mobile] [--wait-for JS] [--eval JS]
//              [--click X,Y] [--key Escape] [--settle MS] [--out file.png] [--close] [--timeout MS]
import { writeFileSync } from "node:fs";

const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parse() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[k] = true;
    else out[k] = argv[++i];
  }
  return out;
}

async function main() {
  const a = parse();
  let target;
  if (a.target) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.id === a.target || t.id.startsWith(a.target));
    if (!target) throw new Error(`no target ${a.target}; have ${list.map((t) => t.id.slice(0, 8)).join(",")}`);
  } else {
    target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method === "Runtime.consoleAPICalled") {
      logs.push(`[${m.params.type}] ` + m.params.args.map((x) => x.value ?? x.description ?? "").join(" "));
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      logs.push("[exception] " + (d.exception?.description ?? d.text));
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  await send("Page.enable");
  // Background tabs get no requestAnimationFrame, so make this one the foreground tab.
  await send("Page.bringToFront");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: !!a.nocache });
  const w = +(a.w ?? 1440);
  const h = +(a.h ?? 810);
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: +(a.dpr ?? 1), mobile: !!a.mobile });
  if (a.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true });

  if (a.url) await send("Page.navigate", { url: a.url });
  if (a.waitFor) {
    const t0 = Date.now();
    const timeout = +(a.timeout ?? 180000);
    for (;;) {
      let ok = false;
      try { ok = await evalJs(a.waitFor); } catch {}
      if (ok) break;
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${a.waitFor}`);
      await sleep(250);
    }
    console.log(`ready after ${Date.now() - t0} ms`);
  }
  if (a.eval) console.log("eval:", JSON.stringify(await evalJs(a.eval)));
  if (a.click) {
    const [x, y] = a.click.split(",").map(Number);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
    }
  }
  if (a.key) {
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: a.key, code: a.key });
  }
  if (a.settle) await sleep(+a.settle);
  if (a.out) {
    const shot = await send("Page.captureScreenshot", { format: a.out.endsWith(".jpg") ? "jpeg" : "png", quality: 85 });
    writeFileSync(a.out, Buffer.from(shot.data, "base64"));
    console.log("saved", a.out);
  }
  if (logs.length) console.log("console:\n" + logs.join("\n"));
  console.log("target:", target.id);
  if (a.close) await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
  ws.close();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
