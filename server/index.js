const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const BASE = "https://api.real.vg";
const jobs = {};

function parseCreds(raw) {
  const result = {};
  const want = {
    "real-auth-info": "authInfo",
    "real-device-uuid": "deviceUuid",
    "real-request-token": "requestToken",
    "real-native-request-token": "nativeToken",
    "real-device-name": "deviceName",
    "real-device-type": "deviceType",
    "real-version": "version",
    "user-agent": "userAgent",
    baggage: "baggage",
    "sentry-trace": "sentryTrace",
  };

  for (const line of raw.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (want[key]) result[want[key]] = value;
  }
  return result;
}

function makeHeaders(creds) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "real-auth-info": creds.authInfo,
    "real-device-uuid": creds.deviceUuid,
    "real-request-token": creds.requestToken,
    "real-device-name": creds.deviceName || "iPhone14,7",
    "real-device-type": creds.deviceType || "ios",
    "real-version": creds.version || "34",
    "real-native-request-token": creds.nativeToken,
    "User-Agent": creds.userAgent || "real/1 CFNetwork/3826.600.41.2.1 Darwin/24.6.0",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    baggage: creds.baggage,
    "sentry-trace": creds.sentryTrace,
  };

  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeUsernames(input) {
  const values = Array.isArray(input) ? input : [input];
  return [...new Set(values
    .flatMap(value => String(value || "").split(/[\s,]+/))
    .map(value => value.trim().replace(/^@+/, ""))
    .filter(Boolean))]
    .slice(0, 50);
}

function findUsername(value, depth = 0) {
  if (!value || depth > 5) return null;
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (/^[a-zA-Z0-9._-]{2,40}$/.test(cleaned)) return cleaned;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findUsername(item, depth + 1);
      if (match) return match;
    }
    return null;
  }
  if (typeof value === "object") {
    const preferred = ["userName", "username", "handle", "displayName"];
    for (const key of preferred) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim().replace(/^@/, "");
    }
    for (const key of ["user", "profile", "account", "data", "me"]) {
      if (value[key]) {
        const match = findUsername(value[key], depth + 1);
        if (match) return match;
      }
    }
  }
  return null;
}

function decodeAuthInfo(authInfo) {
  if (!authInfo) return [];
  const candidates = [authInfo];
  const parts = authInfo.split(".");
  if (parts.length >= 2) candidates.push(parts[1]);
  const decoded = [];

  for (const candidate of candidates) {
    try { decoded.push(JSON.parse(candidate)); } catch (_) {}
    try {
      const normalized = candidate.replace(/-/g, "+").replace(/_/g, "/");
      decoded.push(JSON.parse(Buffer.from(normalized, "base64").toString("utf8")));
    } catch (_) {}
    try { decoded.push(JSON.parse(decodeURIComponent(candidate))); } catch (_) {}
  }
  return decoded;
}

async function resolveAccountUsername(creds) {
  for (const decoded of decodeAuthInfo(creds.authInfo)) {
    const username = findUsername(decoded);
    if (username) return username;
  }

  const endpoints = ["/user/me", "/users/me", "/profile"];
  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(`${BASE}${endpoint}`, {
        headers: makeHeaders(creds),
        validateStatus: () => true,
      });
      if (response.status === 401 || response.status === 403) {
        return null;
      }
      if (response.status >= 200 && response.status < 300) {
        const username = findUsername(response.data);
        if (username) return username;
      }
    } catch (_) {}
  }
  return null;
}

async function checkUsername(username, creds) {
  try {
    const response = await axios.get(`${BASE}/user/${encodeURIComponent(username)}?_=${Date.now()}`, {
      headers: makeHeaders(creds),
      validateStatus: () => true,
    });

    if (response.status === 404) return { username, available: true };
    if (response.status === 200) {
      if (response.data?.user === null) return { username, available: true };
      return { username, available: false, user: response.data?.user };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        username,
        available: null,
        authError: true,
        error: "Your saved Real credentials are expired or invalid. Reconnect with a fresh captured request.",
        status: response.status,
      };
    }
    return {
      username,
      available: null,
      error: `Username check failed with status ${response.status}`,
      status: response.status,
    };
  } catch (error) {
    return { username, available: null, error: error.message };
  }
}

async function claimUsername(username, creds) {
  try {
    const response = await axios.post(`${BASE}/user/changeusername`, { userName: username }, {
      headers: makeHeaders(creds),
      validateStatus: () => true,
    });
    return {
      ok: response.status === 200 || response.status === 201,
      status: response.status,
      data: response.data,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

app.post("/api/parse-creds", async (req, res) => {
  const { raw } = req.body;
  if (!raw) return res.status(400).json({ error: "No raw request provided" });
  const creds = parseCreds(raw);
  if (!creds.authInfo) return res.status(400).json({ error: "Could not find real-auth-info header" });
  creds.accountUsername = await resolveAccountUsername(creds);
  res.json(creds);
});

app.post("/api/account", async (req, res) => {
  const { creds } = req.body;
  if (!creds) return res.status(400).json({ error: "Missing creds" });
  const accountUsername = await resolveAccountUsername(creds);
  res.json({ accountUsername });
});

app.post("/api/check", async (req, res) => {
  const usernames = normalizeUsernames(req.body.usernames || req.body.username);
  const { creds } = req.body;
  if (!usernames.length || !creds) return res.status(400).json({ error: "Missing usernames or creds" });

  const results = await Promise.all(usernames.map(username => checkUsername(username, creds)));
  const authError = results.find(result => result.authError);
  if (authError) return res.status(authError.status || 401).json(authError);
  res.json({ results });
});

app.post("/api/snipe", async (req, res) => {
  const usernames = normalizeUsernames(req.body.usernames || req.body.username);
  const { creds, interval = 5000 } = req.body;
  if (!usernames.length || !creds) return res.status(400).json({ error: "Missing usernames or creds" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering","no");
  if (typeof res.flushHeaders==="function") res.flushHeaders();
  res.setHeader("Connection", "keep-alive");

  const send = (type, data = {}) => {
    try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch (_) {}
  };

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  jobs[jobId]={running:true};
  const heartbeat=setInterval(()=>{try{res.write(`: ping ${Date.now()}\n\n`)}catch(e){}},15000);
  send("started", { jobId, usernames, message: `Monitoring ${usernames.length} username${usernames.length === 1 ? "" : "s"}.` });

  let cycle = 0;
  while (jobs[jobId]?.running) {
    cycle += 1;
    send("checking", { cycle, message: `Cycle ${cycle} started.` });

    for (const username of usernames) {
      if (!jobs[jobId]?.running) break;
      const result = await checkUsername(username, creds);

      if (result.authError) {
        send("warning",{username,message:"Temporary auth failure; retrying."});
        continue;
      }
      if (result.error) {
        send("error", { username, message: `@${username}: ${result.error}` });
        continue;
      }
      if (result.available === false) {
        send("taken", { username, available: false, message: `@${username} is taken.` });
        continue;
      }

      send("available", { username, available: true, message: `@${username} is available. Attempting claim.` });
      const claim = await claimUsername(username, creds);
      if (claim.ok) {
        send("claimed", { username, success: true, message: `Successfully claimed @${username}.` });
        send("done", { username, success: true, message: `@${username} is now yours.` });
        jobs[jobId].running = false;
        break;
      }
      send("claim_failed", { username, success: false, message: `Claim failed for @${username}.` });
    }

    if (jobs[jobId]?.running) {
      send("waiting", { message: `Next cycle in ${Math.max(1, interval / 1000)} seconds.` });
      await sleep(Math.max(1000, Number(interval) || 5000));
    }
  }

  clearInterval(heartbeat);
  if (jobs[jobId]) delete jobs[jobId];
  res.end();
});

app.post("/api/stop", (req, res) => {
  const { jobId } = req.body;
  if (jobs[jobId]) {
    jobs[jobId].running = false;
    return res.json({ ok: true });
  }
  res.json({ ok: false, error: "Job not found" });
});

app.use(express.static(path.join(__dirname, "../client/build")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../client/build/index.html")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ReavesBot running on port ${PORT}`));
