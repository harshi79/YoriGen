/**
 * Integration tests for the production static server (server.js).
 *
 * Run with:  npm run test:server
 *
 * The server is started as a real child process against a temporary fixture
 * directory, exactly the way a hosting platform would start it (PORT + node).
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const SERVER = fileURLToPath(new URL("../server.js", import.meta.url));

let child;
let origin;
let fixtureDir;

function startServer({ port = 0, staticDir }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER], {
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ORIGEN_STATIC_DIR: staticDir },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 10_000);

    proc.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = output.match(/listening on http:\/\/[^:]+:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve({ proc, port: Number(match[1]), output: () => output });
      }
    });
    proc.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}):\n${output}`));
    });
  });
}

before(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "origen-server-"));
  await writeFile(
    join(fixtureDir, "index.html"),
    "<!doctype html><title>ORIGEN</title><p>fixture shell</p>",
    "utf8",
  );
  await mkdir(join(fixtureDir, "assets"), { recursive: true });
  await writeFile(
    join(fixtureDir, "assets", "index-deadbeef1234.js"),
    "export const ok = true;\n",
    "utf8",
  );

  const started = await startServer({ staticDir: fixtureDir });
  child = started.proc;
  origin = `http://127.0.0.1:${started.port}`;
});

after(async () => {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});

test("serves the app shell at /", async () => {
  const res = await fetch(`${origin}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const body = await res.text();
  assert.match(body, /ORIGEN/);
});

test("reports readiness on GET /healthz", async () => {
  const res = await fetch(`${origin}/healthz`);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.status, "ok");
  assert.ok(payload.uptimeSeconds >= 0);
});

test("serves hashed assets with an immutable cache header", async () => {
  const res = await fetch(`${origin}/assets/index-deadbeef1234.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/javascript/);
  assert.match(res.headers.get("cache-control"), /immutable/);
  assert.ok(res.headers.get("etag"));
});

test("supports conditional requests via ETag", async () => {
  const first = await fetch(`${origin}/`);
  const etag = first.headers.get("etag");
  const second = await fetch(`${origin}/`, { headers: { "if-none-match": etag } });
  assert.equal(second.status, 304);
});

test("answers HEAD requests without a body", async () => {
  const res = await fetch(`${origin}/`, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
});

test("falls back to the shell for client-side routes", async () => {
  const res = await fetch(`${origin}/settings`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /ORIGEN/);
});

test("returns 404 for unknown files", async () => {
  const res = await fetch(`${origin}/assets/missing-abc12345.js`);
  assert.equal(res.status, 404);
});

test("rejects path traversal attempts", async () => {
  const res = await fetch(`${origin}/../package.json`);
  assert.ok([400, 404].includes(res.status), `unexpected status ${res.status}`);
});

test("rejects unsupported methods", async () => {
  const res = await fetch(`${origin}/`, { method: "DELETE" });
  assert.equal(res.status, 405);
});

test("uses the platform-provided PORT", async () => {
  assert.ok(Number.isInteger(Number(new URL(origin).port)));
  assert.ok(Number(new URL(origin).port) > 0);
});
