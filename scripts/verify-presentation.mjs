import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { bindInstantAction } from "../src/input.js";
import { generateUIArt } from "./generate-ui-art.mjs";

class Button extends EventTarget {
  disabled = false;
  closest() { return this; }
  getAttribute() { return null; }
}
function fire(button, type, options = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries({ pointerId: 1, clientX: 40, clientY: 40, button: 0, detail: 1, ...options })) {
    Object.defineProperty(event, key, { value });
  }
  button.dispatchEvent(event);
}
const button = new Button();
let activations = 0;
const unbind = bindInstantAction(button, () => { activations += 1; });
fire(button, "pointerdown"); fire(button, "pointerup"); fire(button, "click");
assert.equal(activations, 1, "a tap and its synthetic click must activate once");
fire(button, "click", { detail: 0 });
assert.equal(activations, 2, "keyboard activation must work immediately after a tap");
fire(button, "pointerdown"); fire(button, "pointermove", { clientY: 90 }); fire(button, "pointerup"); fire(button, "click");
assert.equal(activations, 2, "scrolling away and back must not activate a button");
fire(button, "pointerdown"); fire(button, "pointercancel"); fire(button, "pointerup"); fire(button, "click");
assert.equal(activations, 2, "a cancelled touch must not activate on release");
fire(button, "pointerup");
assert.equal(activations, 2, "releasing a touch that began elsewhere must not activate");
fire(button, "pointerdown", { pointerId: 1 }); fire(button, "pointerup", { pointerId: 2 });
assert.equal(activations, 2, "another finger must not finish the first finger's press");
button.disabled = true;
fire(button, "click", { detail: 0 });
assert.equal(activations, 2, "disabled actions must remain disabled for keyboard input");
button.disabled = false;
unbind(); fire(button, "pointerdown"); fire(button, "pointerup"); fire(button, "click", { detail: 0 });
assert.equal(activations, 2, "unbinding must remove every input listener");

// Execute the real worker with a minimal Cache API to verify network/offline
// behavior, including versioned imports and exclusion of account/API responses.
const root = resolve(import.meta.dirname, "..");
const workerSource = await readFile(resolve(root, "service-worker.js"), "utf8");
const handlers = new Map();
const cachesByName = new Map();
let offline = false;
let status = 200;
let skipped = false;
let claimed = false;
const origin = "https://card-crunch.test";
const absolute = (key) => new URL(typeof key === "string" ? key : key.url, `${origin}/`).href;
const caches = {
  async open(name) {
    if (!cachesByName.has(name)) cachesByName.set(name, new Map());
    const map = cachesByName.get(name);
    return {
      async addAll(paths) { for (const path of paths) map.set(absolute(path), new Response(`cached:${path}`)); },
      async put(key, response) { map.set(absolute(key), response); },
      async match(key) { return map.get(absolute(key))?.clone(); }
    };
  },
  async keys() { return [...cachesByName.keys()]; },
  async delete(key) { return cachesByName.delete(key); }
};
runInNewContext(workerSource, {
  URL, Response, Set, Promise, caches,
  fetch: async () => { if (offline) throw new Error("offline"); return new Response("fresh", { status }); },
  self: {
    location: new URL(`${origin}/service-worker.js`),
    addEventListener: (type, handler) => handlers.set(type, handler),
    skipWaiting: async () => { skipped = true; },
    clients: { claim: async () => { claimed = true; } }
  }
});
async function lifecycle(type) {
  const waits = [];
  handlers.get(type)({ waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
}
async function request(path, { mode = "cors", method = "GET" } = {}) {
  let response;
  const waits = [];
  handlers.get("fetch")({
    request: { url: absolute(path), mode, method },
    waitUntil: (promise) => waits.push(promise),
    respondWith: (promise) => { response = promise; }
  });
  const result = response ? await response : null;
  await Promise.all(waits);
  return result;
}
await lifecycle("install");
assert.equal(skipped, true);
assert.equal(await request("/api/matchmaking"), null);
assert.equal(await request("https://accounts.stlproductionz.io/session"), null);
assert.equal(await request("/src/main.js", { method: "POST" }), null);
offline = true;
assert.match(await (await request("/src/main.js?v=206")).text(), /^cached:/);
assert.match(await (await request("/assets/ui/store-items.svg")).text(), /^cached:/);
assert.match(await (await request("/auth/callback", { mode: "navigate" })).text(), /index\.html/);
assert.match(await (await request("/", { mode: "navigate" })).text(), /index\.html/);
offline = false; status = 500;
assert.equal((await request("/src/main.js?v=206")).status, 500);
offline = true;
assert.match(await (await request("/src/main.js?v=206")).text(), /^cached:/, "a server failure must not poison the offline copy");
offline = false; status = 200;
await request("/src/main.js?v=206");
offline = true;
assert.equal(await (await request("/src/main.js?v=206")).text(), "fresh");
cachesByName.set("card-crunch-v-old", new Map());
cachesByName.set("another-app-cache", new Map());
await lifecycle("activate");
assert.equal(claimed, true);
assert.equal(cachesByName.has("card-crunch-v-old"), false);
assert.equal(cachesByName.has("another-app-cache"), true);

const assets = await generateUIArt();
const before = await Promise.all(assets.map((name) => readFile(resolve(root, "assets/ui", name), "utf8")));
await generateUIArt();
const after = await Promise.all(assets.map((name) => readFile(resolve(root, "assets/ui", name), "utf8")));
assert.deepEqual(after, before, "code-drawn art must regenerate deterministically");
for (const svg of after) {
  assert.equal((svg.match(/<svg x=/g) ?? []).length, 16, "all atlas cells must be drawn");
  assert.equal(/<image|data:image|<script|NaN|undefined/.test(svg), false, "SVG must contain only valid code-drawn vectors");
}
async function auditAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "card-sets") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await auditAssets(path);
    else assert.equal(/\.(png|jpe?g|webp|avif)$/i.test(entry.name), false, `Unexpected non-card raster artwork: ${path}`);
  }
}
await auditAssets(resolve(root, "assets"));
console.log("Verified tap/scroll/cancel/keyboard input, offline versioned assets and callback navigation, cache isolation, and all 64 reproducible vector illustrations.");
