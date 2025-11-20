import http from "http";
import fs from "fs";
import path from "path";
import url from "url";

const LOG_DIR = process.env.LOG_DIR || "/var/www/log-buffers";
const PORT = Number(process.env.PORT || 4000);
const TTL_HOURS = Number(process.env.TTL_HOURS || 72);
const CLEAN_INTERVAL_SECONDS = Number(process.env.CLEAN_INTERVAL_SECONDS || 900);
const DONE_GRACE_SECONDS = Number(process.env.DONE_GRACE_SECONDS || 3600);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);

const TTL_MS = TTL_HOURS * 60 * 60 * 1000;
const CLEAN_INTERVAL_MS = CLEAN_INTERVAL_SECONDS * 1000;
const DONE_GRACE_MS = DONE_GRACE_SECONDS * 1000;

fs.mkdirSync(LOG_DIR, { recursive: true });

const INDEX_PATH = path.join(LOG_DIR, "index.json");
const INDEX_TMP_PATH = path.join(LOG_DIR, "index.tmp.json");

const sanitize = (segment) =>
  segment && /^[A-Za-z0-9._-]+$/.test(segment) ? segment : null;

const branchKey = (org, repo, branch) => `${org}/${repo}/${branch}`;

const parseLogFileName = (filename) => {
  const parts = filename.replace(/\.log$/, "").split("__");
  if (parts.length < 4) return null;
  const [org, repo, branch, ts] = parts;
  if (![org, repo, branch, ts].every((p) => sanitize(p))) return null;
  return { org, repo, branch, ts: Number(ts) };
};

const listLogFiles = () => {
  try {
    return fs
      .readdirSync(LOG_DIR)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({ file: f, meta: parseLogFileName(f) }))
      .filter((f) => f.meta);
  } catch (e) {
    console.error("Failed to list log files", e);
    return [];
  }
};

const rebuildIndexFromFiles = () => {
  const latest = {};
  for (const { file, meta } of listLogFiles()) {
    const key = branchKey(meta.org, meta.repo, meta.branch);
    const stat = fs.statSync(path.join(LOG_DIR, file));
    const prev = latest[key];
    if (!prev || stat.mtimeMs > prev.mtimeMs) {
      latest[key] = {
        logFile: file,
        updatedAt: new Date(stat.mtimeMs).toISOString(),
        done: false,
        mtimeMs: stat.mtimeMs,
      };
    }
  }
  Object.values(latest).forEach((v) => delete v.mtimeMs);
  return latest;
};

const loadIndex = () => {
  try {
    const raw = fs.readFileSync(INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    console.warn("Index missing or unreadable; rebuilding", e.message);
    return rebuildIndexFromFiles();
  }
};

let index = loadIndex();

const persistIndex = () => {
  fs.writeFileSync(INDEX_TMP_PATH, JSON.stringify(index, null, 2));
  fs.renameSync(INDEX_TMP_PATH, INDEX_PATH);
};

const ensureActiveLog = (org, repo, branch) => {
  const key = branchKey(org, repo, branch);
  const current = index[key];
  if (current && !current.done) {
    const existingPath = path.join(LOG_DIR, current.logFile);
    if (fs.existsSync(existingPath)) {
      return current;
    }
  }
  const filename = `${org}__${repo}__${branch}__${Date.now()}.log`;
  index[key] = {
    logFile: filename,
    updatedAt: new Date().toISOString(),
    done: false,
  };
  persistIndex();
  return index[key];
};

const findLogForBranch = (org, repo, branch) => {
  const key = branchKey(org, repo, branch);
  const entry = index[key];
  if (entry && fs.existsSync(path.join(LOG_DIR, entry.logFile))) {
    return entry;
  }

  // Fallback: inspect files on disk
  const matches = listLogFiles().filter(
    ({ meta }) => meta.org === org && meta.repo === repo && meta.branch === branch
  );
  if (!matches.length) return null;
  matches.sort((a, b) => b.meta.ts - a.meta.ts);
  const chosen = matches[0].file;
  index[key] = {
    logFile: chosen,
    updatedAt: new Date(fs.statSync(path.join(LOG_DIR, chosen)).mtimeMs).toISOString(),
    done: false,
  };
  persistIndex();
  return index[key];
};

const appendToLog = (org, repo, branch, body, markDone) => {
  const entry = ensureActiveLog(org, repo, branch);
  const filePath = path.join(LOG_DIR, entry.logFile);
  if (body && body.length) {
    const text = body.endsWith("\n") ? body : `${body}\n`;
    fs.appendFileSync(filePath, text);
  }
  entry.updatedAt = new Date().toISOString();
  if (markDone) entry.done = true;
  index[branchKey(org, repo, branch)] = entry;
  persistIndex();
};

const routes = {
  ingest: async (req, res, parts, query) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      return res.end("Only POST allowed");
    }
    const [org, repo, branch] = parts.map(sanitize);
    if (!org || !repo || !branch) {
      res.writeHead(400);
      return res.end("Invalid org/repo/branch");
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) {
        // Prevent runaway uploads
        res.writeHead(413);
        res.end("Body too large");
        req.destroy();
      }
    });
    req.on("end", () => {
      const markDone = query.has("done");
      try {
        appendToLog(org, repo, branch, body, markDone);
        res.writeHead(200);
        res.end("ok");
      } catch (e) {
        console.error("Failed to append log", e);
        res.writeHead(500);
        res.end("error");
      }
    });
  },

  sse: async (req, res, parts, query) => {
    const [org, repo, branch] = parts.map(sanitize);
    if (!org || !repo || !branch) {
      res.writeHead(400);
      return res.end("Invalid org/repo/branch");
    }
    const entry = findLogForBranch(org, repo, branch);
    if (!entry) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const filePath = path.join(LOG_DIR, entry.logFile);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const startParam = query.get("start") || "start";
    const followParam = (query.get("follow") || "true").toLowerCase();
    const follow = followParam !== "false";

    let startOffset = 0;
    if (startParam === "tail") {
      startOffset = stat.size;
    } else if (startParam?.startsWith("bytes:")) {
      const n = Number(startParam.split(":")[1]);
      if (!Number.isNaN(n) && n >= 0) {
        startOffset = Math.max(stat.size - n, 0);
      }
    } else {
      startOffset = 0;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":ok\n\n");

    let cursor = startOffset;
    let pending = "";
    let closed = false;
    let lastActivity = Date.now();

    const sendLines = (chunk) => {
      pending += chunk.toString();
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() || "";
      for (const line of parts) {
        res.write(`data: ${line}\n\n`);
      }
      lastActivity = Date.now();
    };

    const flushPending = () => {
      if (pending.length) {
        res.write(`data: ${pending}\n\n`);
        pending = "";
      }
    };

    const readRange = (from, to) =>
      new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath, {
          start: from,
          end: to ? to - 1 : undefined,
        });
        stream.on("data", (chunk) => {
          cursor += chunk.length;
          sendLines(chunk);
        });
        stream.on("end", resolve);
        stream.on("error", reject);
      });

    const finish = () => {
      if (closed) return;
      closed = true;
      flushPending();
      res.end();
    };

    res.on("close", () => {
      closed = true;
    });

    try {
      await readRange(startOffset, stat.size);
      if (!follow) {
        flushPending();
        return finish();
      }
    } catch (e) {
      console.error("Error reading log", e);
      return finish();
    }

    const key = branchKey(org, repo, branch);
    const poller = setInterval(() => {
      if (closed) {
        clearInterval(poller);
        return;
      }

      // Refresh done flag from current index entry
      const nowEntry = index[key];
      const doneFlag = nowEntry?.done === true;

      fs.stat(filePath, (err, st) => {
        if (err) {
          clearInterval(poller);
          return finish();
        }
        if (st.size > cursor) {
          readRange(cursor, st.size).catch((readErr) => {
            console.error("Error tailing log", readErr);
            clearInterval(poller);
            finish();
          });
          return;
        }

        const idleTooLong =
          doneFlag && Date.now() - lastActivity > DONE_GRACE_MS;
        if (idleTooLong) {
          clearInterval(poller);
          finish();
        }
      });
    }, POLL_INTERVAL_MS);
  },
};

const notFound = (res) => {
  res.writeHead(404);
  res.end("Not found");
};

const cleanupStale = () => {
  const now = Date.now();
  const files = listLogFiles();
  const keep = new Set();
  for (const { file, meta } of files) {
    const fullPath = path.join(LOG_DIR, file);
    try {
      const st = fs.statSync(fullPath);
      const age = now - st.mtimeMs;
      if (age > TTL_MS) {
        fs.unlinkSync(fullPath);
        continue;
      }
      keep.add(file);
    } catch (e) {
      console.error("Error inspecting file", file, e);
    }
  }

  // Drop index entries pointing to missing files
  Object.entries(index).forEach(([key, value]) => {
    if (!keep.has(value.logFile)) {
      delete index[key];
    }
  });
  persistIndex();
};

setInterval(cleanupStale, CLEAN_INTERVAL_MS);

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const query = new URLSearchParams(parsed.query || "");
  const parts = (parsed.pathname || "").split("/").filter(Boolean);
  if (parts.length < 2) return notFound(res);

  const [route, ...args] = parts;
  const handler = routes[route];
  if (handler) {
    return handler(req, res, args, query);
  }
  return notFound(res);
});

server.listen(PORT, () => {
  console.log(`Log relay listening on ${PORT}, log dir ${LOG_DIR}`);
});
