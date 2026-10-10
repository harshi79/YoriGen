#!/usr/bin/env node
/**
 * ORIGEN — production static server.
 *
 * The app is a fully client-side Vite build (`dist/`). Hosting platforms that
 * deploy this repository as a *web service* (Railway, Render, Fly, Docker, ...)
 * need a long-running start command, so this file provides one:
 *
 *     npm start          # -> node server.js
 *
 * It has zero runtime dependencies (Node built-ins only), binds 0.0.0.0 and
 * honours the platform-provided `PORT` variable, so it works unchanged on any
 * container/PaaS host.
 *
 * Environment variables
 *   PORT                TCP port to listen on (default 8080)
 *   HOST                Interface to bind (default 0.0.0.0)
 *   ORIGEN_STATIC_DIR   Directory to serve (default ./dist)
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(
  process.env.ORIGEN_STATIC_DIR || fileURLToPath(new URL("./dist", import.meta.url)),
);
/** Honour any valid PORT (including 0 for an ephemeral port); default to 8080. */
function resolvePort(raw) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : 8080;
}

const PORT = resolvePort(process.env.PORT);
const HOST = process.env.HOST || "0.0.0.0";
const INDEX_FILE = "index.html";

const MIME_TYPES = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

/** Hashed build artifacts (e.g. index-BP0HmT6b.js) can be cached forever. */
const IMMUTABLE_ASSET = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

async function fileInfo(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

/** Maps a URL pathname to a path inside ROOT, or null when it escapes ROOT. */
function toFsPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const relative = decoded.replace(/^[/\\]+/, "");
  const candidate = resolve(ROOT, relative);
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  return candidate;
}

/** Resolves the file to serve, with directory indexes and SPA fallback. */
async function resolveFile(pathname) {
  let target = toFsPath(pathname);
  if (!target) return null;

  if (await fileInfo(target)) return target;

  if (pathname.endsWith("/")) {
    target = join(target, INDEX_FILE);
    if (await fileInfo(target)) return target;
  }

  // Client-side routed paths (e.g. /settings) fall back to the app shell.
  if (!extname(pathname) && target !== ROOT) {
    const shell = join(ROOT, INDEX_FILE);
    if (await fileInfo(shell)) return shell;
  }

  return null;
}

function baseHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

function send(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(body, "utf8");
  res.writeHead(status, {
    ...baseHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": payload.byteLength,
    ...extraHeaders,
  });
  res.end(payload);
}

async function serveStatic(req, res, filePath, info) {
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ...baseHeaders(), ETag: etag });
    res.end();
    return;
  }

  const base = filePath.slice(ROOT.length + 1);
  const headers = {
    ...baseHeaders(),
    "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": info.size,
    "Last-Modified": new Date(info.mtimeMs).toUTCString(),
    ETag: etag,
    "Cache-Control": IMMUTABLE_ASSET.test(base)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

async function handleRequest(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
    return;
  }

  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (pathname === "/healthz") {
    const ready = Boolean(await fileInfo(join(ROOT, INDEX_FILE)));
    const payload = JSON.stringify({
      status: ready ? "ok" : "unavailable",
      root: ROOT,
      uptimeSeconds: Math.round(process.uptime()),
    });
    res.writeHead(ready ? 200 : 503, {
      ...baseHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : payload);
    return;
  }

  const filePath = await resolveFile(pathname);
  if (!filePath) {
    send(res, 404, "404 — Not Found\n");
    return;
  }

  const info = await fileInfo(filePath);
  if (!info) {
    send(res, 404, "404 — Not Found\n");
    return;
  }

  await serveStatic(req, res, filePath, info);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error("[origen] request failed:", error);
    if (!res.headersSent) send(res, 500, "500 — Internal Server Error\n");
    else res.destroy();
  });
});

server.listen(PORT, HOST, async () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  console.log(`[origen] static server listening on http://${HOST}:${port} (root: ${ROOT})`);
  if (!(await fileInfo(join(ROOT, INDEX_FILE)))) {
    console.warn(`[origen] no ${INDEX_FILE} in ${ROOT} — run "npm run build" before starting.`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[origen] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    // Don't hang forever on keep-alive connections.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
