import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`;
const service = moduleUrl(readFileSync(new URL("../src/lib/video-service.ts", import.meta.url), "utf8"));
const clientSource = readFileSync(new URL("../src/lib/video-upload.ts", import.meta.url), "utf8").replace('"./video-service"', JSON.stringify(service));
const { uploadPostVideo } = await import(moduleUrl(clientSource));
const partSize = 16 * 1024 * 1024;

function boundary(t, { failPuts = 0, existingParts = [], abortOnPut = false, loseComplete = false } = {}) {
  const controller = new AbortController();
  const state = { requests: [], puts: [], ready: false, errors: failPuts, lost: loseComplete };
  const originalFetch = globalThis.fetch;
  const originalXHR = globalThis.XMLHttpRequest;
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(options.body); state.requests.push(input);
    let data = {};
    if (input.action === "start") data = { video: { state: state.ready ? "ready" : "uploading" }, parts: existingParts };
    if (input.action === "part") data = { url: `https://r2.invalid/part-${input.number}` };
    if (input.action === "complete") {
      state.ready = true;
      if (state.lost) { state.lost = false; throw new TypeError("Lost response"); }
    }
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  };
  globalThis.XMLHttpRequest = class {
    upload = {};
    status = 200;
    open(method, url) { assert.equal(method, "PUT"); this.url = url; }
    send(blob) {
      state.puts.push({ url: this.url, size: blob.size });
      if (abortOnPut) { controller.abort(); return; }
      if (state.errors-- > 0) { this.onerror(); return; }
      this.upload.onprogress({ lengthComputable: true, loaded: blob.size });
      this.onload();
    }
    abort() { this.onabort(); }
  };
  t.after(() => { globalThis.fetch = originalFetch; globalThis.XMLHttpRequest = originalXHR; });
  return { state, controller };
}
const session = size => ({ id: "30000000-0000-4000-8000-000000000001", file: new File([new Uint8Array(size)], "video.mp4", { type: "video/mp4" }) });

test("client resumes completed parts and reports real upload progress", async t => {
  const { state, controller } = boundary(t, { existingParts: [{ number: 1, size: partSize }] });
  const progress = [];
  await uploadPostVideo("post", session(partSize + 9), controller.signal, percent => progress.push(percent));
  assert.deepEqual(state.puts.map(put => put.size), [9]);
  assert.equal(progress.at(-1), 100);
  assert.equal(state.requests.filter(request => request.action === "complete").length, 1);
});

test("failed parts obtain fresh signatures and retry at most three times", async t => {
  const { state, controller } = boundary(t, { failPuts: 3 });
  await assert.rejects(uploadPostVideo("post", session(40), controller.signal, () => {}), /video-storage/);
  assert.equal(state.puts.length, 3);
  assert.equal(state.requests.filter(request => request.action === "part").length, 3);
  assert.equal(state.requests.filter(request => request.action === "complete").length, 0);
});

test("cancellation aborts the current PUT and never completes the upload", async t => {
  const { state, controller } = boundary(t, { abortOnPut: true });
  await assert.rejects(uploadPostVideo("post", session(40), controller.signal, () => {}), error => error.name === "AbortError");
  assert.equal(state.puts.length, 1);
  assert.equal(state.requests.filter(request => request.action === "complete").length, 0);
});

test("an already cancelled upload never allocates an R2 upload", async t => {
  const { state, controller } = boundary(t); controller.abort();
  await assert.rejects(uploadPostVideo("post", session(40), controller.signal, () => {}), error => error.name === "AbortError");
  assert.equal(state.requests.length, 0);
});

test("retry after a lost completion response reuses the ready attachment", async t => {
  const { state, controller } = boundary(t, { loseComplete: true });
  const upload = session(40);
  await assert.rejects(uploadPostVideo("post", upload, controller.signal, () => {}));
  await uploadPostVideo("post", upload, controller.signal, () => {});
  assert.equal(state.puts.length, 1);
  assert.equal(state.requests.filter(request => request.action === "start").length, 2);
});
