#!/usr/bin/env node
// ThinkingOut server: runs on your own PC.
//
//  - Sorting: the app sends a note here; it's sorted by a model running in
//    Ollama on this PC. Sorts are queued jobs, so one still finishes if the
//    phone closes the app; the app collects the result when it's next open.
//  - Sync: notes, to-dos, daily to-dos, topics, collections and images are
//    kept here so every device you use sees the same things.
//
// No dependencies beyond Node.js 18+. Run:  node server/server.mjs
// Settings come from environment variables (see README → "Your own server").

import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1"; // reached from outside through Tailscale / Cloudflare, see README
const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const NUM_CTX = Number(process.env.NUM_CTX ?? 16384); // how much text the model holds at once
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(here, "data"));
// Which web pages may call this server. "*" = any (the key still protects it).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());
const MAX_BODY = 30 * 1024 * 1024; // a sort with a few images, or one image upload

mkdirSync(join(DATA_DIR, "images"), { recursive: true });

// ---- the secret key ------------------------------------------------------------

const tokenFile = join(DATA_DIR, "token.txt");
const TOKEN = process.env.SERVER_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : null) ?? (() => {
  const t = randomBytes(24).toString("base64url");
  writeFileSync(tokenFile, t + "\n", { mode: 0o600 });
  return t;
})();

const authorised = (req) => {
  const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
};

// ---- synced records ------------------------------------------------------------
// Every record (a note, to-do, …) is stored with the time it last changed and a
// revision number. A device sends what changed since it last synced and gets
// back everything newer than the revision it last saw. When two devices change
// the same record, the later change wins. Deletions are kept as tombstones so
// they reach the other devices too.

const KINDS = new Set(["sessions", "topics", "items", "collections", "dailies"]);
const recordsFile = join(DATA_DIR, "records.json");
const db = existsSync(recordsFile) ? JSON.parse(readFileSync(recordsFile, "utf8")) : { rev: 0, records: {} };

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = recordsFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, recordsFile); // never leaves a half-written file
  }, 200);
}

function sync({ since = 0, changes = [] }) {
  for (const c of changes) {
    if (!KINDS.has(c.kind) || typeof c.id !== "string" || typeof c.updatedAt !== "number") continue;
    const key = `${c.kind}:${c.id}`;
    const have = db.records[key];
    if (have && have.updatedAt > c.updatedAt) continue; // a newer change already won
    db.records[key] = { kind: c.kind, id: c.id, data: c.data ?? null, updatedAt: c.updatedAt, rev: ++db.rev };
  }
  if (changes.length) persist();
  const out = Object.values(db.records).filter((r) => r.rev > since);
  return { rev: db.rev, changes: out };
}

// ---- sorting with Ollama ----------------------------------------------------

let modelInfo = null; // { name, vision, thinking }

async function ollama(path, body) {
  const res = await fetch(OLLAMA_URL + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ollama: ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Which model to use, and what it can do. OLLAMA_MODEL picks one; otherwise
// the first one Ollama has.
async function getModel() {
  if (modelInfo) return modelInfo;
  let name = process.env.OLLAMA_MODEL;
  if (!name) {
    const { models = [] } = await ollama("/api/tags");
    if (!models.length) throw new Error("Ollama has no models yet. Pull one first (see README).");
    name = models[0].name;
  }
  const show = await ollama("/api/show", { model: name });
  const caps = show.capabilities ?? [];
  modelInfo = { name, vision: caps.includes("vision"), thinking: caps.includes("thinking") };
  return modelInfo;
}

const jobs = new Map(); // id -> { status, result?, error?, created }
let queue = Promise.resolve();

function submitSort(req) {
  const id = randomBytes(9).toString("base64url");
  jobs.set(id, { status: "queued", created: Date.now() });
  // One sort at a time: a PC's GPU runs one model request well, not several.
  queue = queue.then(() => runSort(id, req)).catch(() => {});
  return id;
}

async function runSort(id, { system, prompt, schema, images = [] }) {
  const job = jobs.get(id);
  job.status = "running";
  try {
    const model = await getModel();
    const reply = await ollama("/api/chat", {
      model: model.name,
      stream: false,
      format: schema, // Ollama keeps the reply to this JSON shape
      ...(model.thinking ? { think: false } : {}),
      options: { temperature: 0.3, num_ctx: NUM_CTX },
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt, ...(model.vision && images.length ? { images } : {}) },
      ],
    });
    job.result = { text: reply.message?.content ?? "", model: model.name, sawImages: model.vision && images.length > 0 };
    job.status = "done";
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    job.status = "error";
    modelInfo = null; // look the model up again next time (it may have changed)
  }
}

// Finished jobs are kept for a day for the app to collect, then dropped.
setInterval(() => {
  const cutoff = Date.now() - 24 * 3600e3;
  for (const [id, job] of jobs) if (job.created < cutoff) jobs.delete(id);
}, 3600e3).unref();

// ---- HTTP ---------------------------------------------------------------------

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
    // Chrome asks before a public site (the app) talks to a private address.
    if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const imagePath = (id) => (/^[\w-]{1,80}$/.test(id) ? join(DATA_DIR, "images", id + ".jpg") : null);

const server = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") return send(res, 200, { app: "ThinkingOut server", ok: true });
  if (!authorised(req)) return send(res, 401, { error: "Wrong or missing server key." });

  try {
    const [, api, what, id] = url.pathname.split("/");
    if (api !== "api") return send(res, 404, { error: "Not found" });

    if (what === "health" && req.method === "GET") {
      try {
        const m = await getModel();
        return send(res, 200, { ok: true, model: m.name, vision: m.vision, sync: true });
      } catch (err) {
        return send(res, 200, { ok: false, error: `Server is running, but Ollama isn't ready: ${err.message}`, sync: true });
      }
    }

    if (what === "sort" && req.method === "POST" && !id) {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      if (typeof body.prompt !== "string" || typeof body.system !== "string") return send(res, 400, { error: "Bad request" });
      return send(res, 202, { id: submitSort(body) });
    }
    if (what === "sort" && req.method === "GET" && id) {
      const job = jobs.get(id);
      return job ? send(res, 200, job) : send(res, 404, { error: "No such sort (the server may have restarted)." });
    }

    if (what === "sync" && req.method === "POST") {
      return send(res, 200, sync(JSON.parse((await readBody(req)).toString("utf8"))));
    }

    if (what === "images" && id) {
      const file = imagePath(id);
      if (!file) return send(res, 400, { error: "Bad image id" });
      if (req.method === "PUT") {
        await writeFile(file, await readBody(req));
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET") {
        if (!existsSync(file)) return send(res, 404, { error: "No such image" });
        res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" });
        return res.end(await readFile(file));
      }
    }
    return send(res, 404, { error: "Not found" });
  } catch (err) {
    return send(res, err.status ?? 500, { error: err.message ?? String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ThinkingOut server on http://${HOST}:${PORT}`);
  console.log(`Ollama: ${OLLAMA_URL}   model: ${process.env.OLLAMA_MODEL ?? "(first one Ollama has)"}`);
  console.log(`Data:   ${DATA_DIR}`);
  console.log(`\nServer key (paste into the app: Settings → Your PC):\n  ${TOKEN}\n`);
});
