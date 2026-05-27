// Agent daemon for the AI-builder dev container.
//
// Runs as PID 1. Spawns `pnpm dev` as a child and exposes a typed RPC over a
// single WebSocket on /ws. Token-gated via Sec-WebSocket-Protocol: bearer.<TOKEN>.
//
// Lifecycle: when the last WS client disconnects and GRACE_MS elapses, the
// daemon SIGTERMs the child (escalates to SIGKILL after 5s) and exits, which
// terminates the container. A reconnect within the grace window cancels the
// shutdown.
//
// Only deps: `ws` + node built-ins. ESM.

import { spawn, spawnSync } from "node:child_process";
import { timingSafeEqual, createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocketServer } from "ws";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AGENT_TOKEN = process.env.AGENT_TOKEN;
if (!AGENT_TOKEN || AGENT_TOKEN.length < 8) {
  console.error("[agent] AGENT_TOKEN env var is required (min 8 chars). Refusing to start.");
  process.exit(1);
}
const GRACE_MS = Number.parseInt(process.env.GRACE_MS ?? "60000", 10);
const AGENT_PORT = Number.parseInt(process.env.AGENT_PORT ?? "4000", 10);
const DEV_CMD = process.env.DEV_CMD ?? "pnpm exec next dev -H 0.0.0.0";
const WORKSPACE = "/app";
const READY_TIMEOUT_MS = 3000;
const HELLO_PROTO_VERSION = 1;
const MAX_READ_SIZE = 2 * 1024 * 1024; // 2MB
const DEFAULT_SHELL_TIMEOUT_MS = 60_000;
const MAX_SHELL_TIMEOUT_MS = 5 * 60_000;
const LIST_DIR_MAX_DEPTH = 8;
const LIST_DIR_SKIP = new Set(["node_modules", ".next", ".open-next", ".wrangler"]);
const SHELL_ALLOWLIST = new Set(["pnpm", "node", "npx", "tsc", "eslint", "git", "sh", "ls", "cat"]);

function log(...args) {
  console.log("[agent]", ...args);
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

function safePath(p) {
  if (typeof p !== "string" || p.length === 0) {
    const err = new Error("path must be a non-empty string");
    err.code = "path_outside_workspace";
    throw err;
  }
  const abs = path.resolve(WORKSPACE, p);
  if (!abs.startsWith(WORKSPACE + "/") && abs !== WORKSPACE) {
    const err = new Error(`path outside ${WORKSPACE}: ${p}`);
    err.code = "path_outside_workspace";
    throw err;
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Token gate
// ---------------------------------------------------------------------------

function tokenMatches(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function extractBearerProto(header) {
  if (!header) return null;
  // Header can be a string (comma-separated) or array (ws lib normalizes either way).
  const list = Array.isArray(header) ? header : String(header).split(",");
  const protos = list.map((s) => s.trim()).filter(Boolean);
  if (protos.length !== 1) return null;
  const proto = protos[0];
  if (!proto.startsWith("bearer.")) return null;
  return { proto, token: proto.slice("bearer.".length) };
}

// ---------------------------------------------------------------------------
// Child dev server
// ---------------------------------------------------------------------------

const devParts = DEV_CMD.split(/\s+/).filter(Boolean);
if (devParts.length === 0) {
  console.error("[agent] DEV_CMD is empty. Refusing to start.");
  process.exit(1);
}

log(`spawning dev: ${DEV_CMD}`);
const child = spawn(devParts[0], devParts.slice(1), {
  cwd: WORKSPACE,
  env: { ...process.env },
  stdio: ["ignore", "pipe", "pipe"],
});

child.on("exit", (code, signal) => {
  log(`dev child exited code=${code} signal=${signal}`);
});
child.on("error", (err) => {
  log(`dev child error: ${err.message}`);
});

function broadcastLog(stream, data) {
  const frame = JSON.stringify({
    id: "_",
    type: "event",
    event: { kind: "log", payload: { stream, data } },
  });
  for (const c of clients) {
    if (c.ws.readyState === 1 /* OPEN */) {
      try {
        c.ws.send(frame);
      } catch {
        // ignore
      }
    }
  }
}

child.stdout.on("data", (buf) => {
  const s = buf.toString("utf8");
  process.stdout.write(s);
  broadcastLog("stdout", s);
});
child.stderr.on("data", (buf) => {
  const s = buf.toString("utf8");
  process.stderr.write(s);
  broadcastLog("stderr", s);
});

// ---------------------------------------------------------------------------
// Client / grace-timer state
// ---------------------------------------------------------------------------

const clients = new Set();
const inFlight = new Map(); // id -> { abort, child? }
let graceTimer = null;
let shuttingDown = false;

function armGraceTimer() {
  if (graceTimer || shuttingDown) return;
  log(`no clients connected — arming grace timer (${GRACE_MS}ms)`);
  graceTimer = setTimeout(() => {
    graceTimer = null;
    shutdown("grace_expired");
  }, GRACE_MS);
}

function disarmGraceTimer() {
  if (graceTimer) {
    clearTimeout(graceTimer);
    graceTimer = null;
    log("client reconnected — grace timer cancelled");
  }
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutting down: ${reason}`);
  // Abort in-flight ops.
  for (const [, entry] of inFlight) {
    try {
      entry.abort?.abort?.();
    } catch {
      // ignore
    }
    if (entry.child && !entry.child.killed) {
      try {
        entry.child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
  inFlight.clear();

  // Kill dev child.
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (!child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      setTimeout(() => process.exit(0), 200);
    }, 5000);
  } else {
    setTimeout(() => process.exit(0), 200);
  }
}

process.on("SIGTERM", () => shutdown("sigterm"));
process.on("SIGINT", () => shutdown("sigint"));

// ---------------------------------------------------------------------------
// WS server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({
  host: "0.0.0.0",
  port: AGENT_PORT,
  path: "/ws",
  handleProtocols: (protocols, req) => {
    // protocols is a Set in newer ws versions, array in older. Normalize.
    const arr = Array.isArray(protocols) ? protocols : Array.from(protocols ?? []);
    if (arr.length !== 1) return false;
    const proto = arr[0];
    if (!proto.startsWith("bearer.")) return false;
    const token = proto.slice("bearer.".length);
    if (!tokenMatches(token, AGENT_TOKEN)) return false;
    return proto;
  },
});

wss.on("listening", () => {
  log(`listening on 0.0.0.0:${AGENT_PORT}/ws`);
});

wss.on("connection", (ws, req) => {
  // Belt-and-braces token recheck (handleProtocols already rejected mismatches).
  const got = extractBearerProto(req.headers["sec-websocket-protocol"]);
  if (!got || !tokenMatches(got.token, AGENT_TOKEN)) {
    try {
      ws.close(1008, "unauthorized");
    } catch {
      // ignore
    }
    return;
  }

  const id = randomUUID();
  const entry = { id, ws, ready: false };
  clients.add(entry);
  disarmGraceTimer();
  log(`client connected id=${id} total=${clients.size}`);

  // Send hello.
  try {
    ws.send(JSON.stringify({ type: "hello", proto: HELLO_PROTO_VERSION }));
  } catch {
    // ignore
  }

  // Await ready.
  const readyTimer = setTimeout(() => {
    if (!entry.ready) {
      log(`client id=${id} did not send ready within ${READY_TIMEOUT_MS}ms — closing`);
      try {
        ws.close(1002, "ready_timeout");
      } catch {
        // ignore
      }
    }
  }, READY_TIMEOUT_MS);

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      try {
        ws.send(JSON.stringify({ type: "error", error: { code: "bad_json", message: "invalid JSON" } }));
      } catch {
        // ignore
      }
      return;
    }

    if (msg && msg.type === "ready") {
      entry.ready = true;
      clearTimeout(readyTimer);
      return;
    }

    if (!entry.ready) {
      // Tolerate ops before ready by treating first op as implicit ready.
      entry.ready = true;
      clearTimeout(readyTimer);
    }

    if (!msg || typeof msg.id !== "string" || typeof msg.op !== "string") {
      try {
        ws.send(
          JSON.stringify({
            id: msg?.id ?? "_",
            type: "result",
            ok: false,
            error: { code: "bad_request", message: "expected { id, op, args? }" },
          }),
        );
      } catch {
        // ignore
      }
      return;
    }

    const handler = handlers[msg.op];
    if (!handler) {
      try {
        ws.send(
          JSON.stringify({
            id: msg.id,
            type: "result",
            ok: false,
            error: { code: "unknown_op", message: `unknown op: ${msg.op}` },
          }),
        );
      } catch {
        // ignore
      }
      return;
    }

    const abort = new AbortController();
    inFlight.set(msg.id, { abort });
    const sendStream = (chunk) => {
      try {
        ws.send(JSON.stringify({ id: msg.id, type: "stream", chunk }));
      } catch {
        // ignore
      }
    };
    try {
      const data = await handler(msg.args ?? {}, { id: msg.id, ws, abort, sendStream });
      try {
        ws.send(JSON.stringify({ id: msg.id, type: "result", ok: true, data: data ?? {} }));
      } catch {
        // ignore
      }
    } catch (err) {
      const code = err?.code ?? "handler_error";
      const message = err?.message ?? String(err);
      try {
        ws.send(
          JSON.stringify({
            id: msg.id,
            type: "result",
            ok: false,
            error: { code, message, stack: err?.stack },
          }),
        );
      } catch {
        // ignore
      }
    } finally {
      inFlight.delete(msg.id);
    }
  });

  ws.on("close", () => {
    clearTimeout(readyTimer);
    clients.delete(entry);
    log(`client disconnected id=${id} remaining=${clients.size}`);
    if (clients.size === 0) armGraceTimer();
  });

  ws.on("error", (err) => {
    log(`client id=${id} error: ${err?.message ?? err}`);
  });
});

wss.on("error", (err) => {
  log(`ws server error: ${err?.message ?? err}`);
});

// No clients yet — arm the grace timer at boot so the container doesn't sit
// idle forever if nothing ever connects.
armGraceTimer();

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const handlers = {
  ping: async () => ({}),

  write_file: async (args) => {
    const mode = args.mode ?? "overwrite";
    const abs = safePath(args.path);
    const body = typeof args.body === "string" ? args.body : "";

    if (mode === "patch") {
      const tmp = path.join(os.tmpdir(), `agent-patch-${randomUUID()}.diff`);
      await fsp.writeFile(tmp, body, "utf8");
      try {
        const res = spawnSync("git", ["apply", "--3way", tmp], {
          cwd: WORKSPACE,
          encoding: "utf8",
        });
        if (res.status !== 0) {
          const err = new Error(res.stderr?.trim() || res.stdout?.trim() || "git apply failed");
          err.code = "patch_failed";
          throw err;
        }
        return { mode, path: abs };
      } finally {
        await fsp.rm(tmp, { force: true });
      }
    }

    await fsp.mkdir(path.dirname(abs), { recursive: true });

    if (mode === "create") {
      await fsp.writeFile(abs, body, { encoding: "utf8", flag: "wx" });
      return { mode, path: abs, bytes: Buffer.byteLength(body, "utf8") };
    }

    // overwrite — atomic via tmp + rename on same fs.
    const tmp = `${abs}.agent-tmp-${randomUUID()}`;
    await fsp.writeFile(tmp, body, "utf8");
    await fsp.rename(tmp, abs);
    return { mode: "overwrite", path: abs, bytes: Buffer.byteLength(body, "utf8") };
  },

  read_file: async (args) => {
    const abs = safePath(args.path);
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) {
      const err = new Error(`not a file: ${args.path}`);
      err.code = "not_a_file";
      throw err;
    }
    if (stat.size > MAX_READ_SIZE) {
      const err = new Error(`file too large: ${stat.size} > ${MAX_READ_SIZE}`);
      err.code = "file_too_large";
      throw err;
    }
    const buf = await fsp.readFile(abs);
    // Reject obvious binaries — null byte heuristic.
    if (buf.includes(0)) {
      const err = new Error("binary file refused");
      err.code = "binary_file";
      throw err;
    }
    const content = buf.toString("utf8");
    const sha256 = createHash("sha256").update(buf).digest("hex");
    return { content, size: stat.size, sha256 };
  },

  list_dir: async (args) => {
    const abs = safePath(args.path ?? ".");
    const recursive = Boolean(args.recursive);
    const glob = typeof args.glob === "string" ? args.glob : null;
    const regex = typeof args.regex === "string" ? new RegExp(args.regex) : null;
    const entries = [];

    async function walk(dir, depth) {
      const dirents = await fsp.readdir(dir, { withFileTypes: true });
      for (const d of dirents) {
        if (LIST_DIR_SKIP.has(d.name)) continue;
        const full = path.join(dir, d.name);
        const rel = path.relative(WORKSPACE, full);
        const item = {
          name: d.name,
          path: full,
          rel,
          type: d.isDirectory() ? "dir" : d.isSymbolicLink() ? "symlink" : "file",
        };
        let matches = true;
        if (glob) matches = item.name.includes(glob);
        if (matches && regex) matches = regex.test(item.rel);
        if (matches) entries.push(item);
        if (recursive && d.isDirectory() && depth < LIST_DIR_MAX_DEPTH) {
          await walk(full, depth + 1);
        }
      }
    }

    await walk(abs, 0);
    return { path: abs, entries };
  },

  delete_file: async (args) => {
    const abs = safePath(args.path);
    if (abs === WORKSPACE) {
      const err = new Error("refusing to delete workspace root");
      err.code = "refused_root_delete";
      throw err;
    }
    await fsp.rm(abs, { recursive: Boolean(args.recursive), force: Boolean(args.force) });
    return { path: abs };
  },

  move_file: async (args) => {
    const from = safePath(args.from);
    const to = safePath(args.to);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
    return { from, to };
  },

  run_shell: async (args, ctx) => {
    const cmd = String(args.cmd ?? "");
    if (!SHELL_ALLOWLIST.has(cmd)) {
      const err = new Error(`binary not allowed: ${cmd}`);
      err.code = "binary_not_allowed";
      throw err;
    }
    const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
    const cwd = args.cwd ? safePath(args.cwd) : WORKSPACE;
    const timeoutMs = Math.min(
      Math.max(Number.parseInt(args.timeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS, 10), 1000),
      MAX_SHELL_TIMEOUT_MS,
    );
    const env = { ...process.env, ...(args.env && typeof args.env === "object" ? args.env : {}) };

    return await runStreaming({ cmd, args: cmdArgs, cwd, env, timeoutMs, ctx });
  },

  ts_check: async (args, ctx) => {
    const res = await runStreaming({
      cmd: "pnpm",
      args: ["exec", "tsc", "--noEmit"],
      cwd: WORKSPACE,
      env: process.env,
      timeoutMs: MAX_SHELL_TIMEOUT_MS,
      ctx,
    });
    const diagnostics = parseTscDiagnostics(res.stdout + "\n" + res.stderr);
    return { exitCode: res.exitCode, diagnostics, stdout: res.stdout, stderr: res.stderr };
  },

  eslint: async (args, ctx) => {
    const paths = Array.isArray(args.paths) && args.paths.length ? args.paths.map(String) : ["."];
    const cmdArgs = ["exec", "eslint", ...paths, "--format=json"];
    if (args.fix) cmdArgs.push("--fix");
    const res = await runStreaming({
      cmd: "pnpm",
      args: cmdArgs,
      cwd: WORKSPACE,
      env: process.env,
      timeoutMs: MAX_SHELL_TIMEOUT_MS,
      ctx,
    });
    const diagnostics = parseEslintJson(res.stdout);
    return { exitCode: res.exitCode, diagnostics, stderr: res.stderr };
  },

  cancel: async (args) => {
    const targetId = String(args.targetId ?? "");
    const entry = inFlight.get(targetId);
    if (!entry) return { cancelled: false, reason: "not_found" };
    try {
      entry.abort?.abort?.();
    } catch {
      // ignore
    }
    if (entry.child && !entry.child.killed) {
      try {
        entry.child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    return { cancelled: true };
  },
};

// ---------------------------------------------------------------------------
// Streaming subprocess runner
// ---------------------------------------------------------------------------

function runStreaming({ cmd, args, cwd, env, timeoutMs, ctx }) {
  return new Promise((resolve, reject) => {
    let cp;
    try {
      cp = spawn(cmd, args, { cwd, env, shell: false });
    } catch (err) {
      reject(err);
      return;
    }

    // Register child handle for cancel.
    const entry = inFlight.get(ctx.id);
    if (entry) entry.child = cp;

    let stdout = "";
    let stderr = "";
    let killed = false;

    const t = setTimeout(() => {
      killed = true;
      try {
        cp.kill("SIGTERM");
      } catch {
        // ignore
      }
      setTimeout(() => {
        if (!cp.killed) {
          try {
            cp.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
      }, 5000);
    }, timeoutMs);

    const onAbort = () => {
      killed = true;
      try {
        cp.kill("SIGTERM");
      } catch {
        // ignore
      }
    };
    ctx.abort.signal.addEventListener("abort", onAbort, { once: true });

    cp.stdout?.on("data", (buf) => {
      const data = buf.toString("utf8");
      stdout += data;
      ctx.sendStream({ stream: "stdout", data });
    });
    cp.stderr?.on("data", (buf) => {
      const data = buf.toString("utf8");
      stderr += data;
      ctx.sendStream({ stream: "stderr", data });
    });
    cp.on("error", (err) => {
      clearTimeout(t);
      ctx.abort.signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    cp.on("close", (code, signal) => {
      clearTimeout(t);
      ctx.abort.signal.removeEventListener("abort", onAbort);
      if (killed && ctx.abort.signal.aborted) {
        const err = new Error("cancelled");
        err.code = "cancelled";
        reject(err);
        return;
      }
      if (killed) {
        const err = new Error(`timed out after ${timeoutMs}ms`);
        err.code = "timeout";
        reject(err);
        return;
      }
      resolve({ exitCode: code ?? null, signal: signal ?? null, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Diagnostic parsers
// ---------------------------------------------------------------------------

const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

function parseTscDiagnostics(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = TSC_LINE.exec(line);
    if (!m) continue;
    out.push({
      file: m[1],
      line: Number.parseInt(m[2], 10),
      col: Number.parseInt(m[3], 10),
      severity: m[4] === "error" ? "error" : "warning",
      code: m[5],
      message: m[6],
    });
  }
  return out;
}

function parseEslintJson(stdout) {
  // ESLint prints a single JSON array on success; on lint errors it still
  // prints the JSON and exits 1. On config error there may be no JSON.
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  // Find first '[' — pnpm sometimes prepends progress noise; tolerate it.
  const idx = trimmed.indexOf("[");
  if (idx < 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(trimmed.slice(idx));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const file of parsed) {
    if (!file || !Array.isArray(file.messages)) continue;
    for (const m of file.messages) {
      out.push({
        file: file.filePath,
        line: m.line ?? 1,
        col: m.column ?? 1,
        severity: m.severity === 2 ? "error" : "warning",
        code: m.ruleId ?? "eslint",
        message: m.message,
      });
    }
  }
  return out;
}
