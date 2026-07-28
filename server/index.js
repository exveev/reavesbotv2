const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const BASE = "https://api.real.vg";

// ── Active snipe jobs (in-memory) ────────────
const jobs = {};

// ── Parse raw HTTP request ────────────────────
function parseCreds(raw) {
  const result = {};
  const want = {
    "real-auth-info":            "authInfo",
    "real-device-uuid":          "deviceUuid",
    "real-request-token":        "requestToken",
    "real-native-request-token": "nativeToken",
    "real-device-name":          "deviceName",
    "real-device-type":          "deviceType",
    "real-version":              "version",
    "user-agent":                "userAgent",
    "baggage":                   "baggage",
    "sentry-trace":              "sentryTrace",
  };
  for (const line of raw.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const k = line.slice(0, colon).trim().toLowerCase();
    const v = line.slice(colon + 1).trim();
    if (want[k]) result[want[k]] = v;
  }
  return result;
}

// ── Build headers ─────────────────────────────
function makeHeaders(creds) {
  const headers = {
    "Accept":                    "application/json",
    "Content-Type":              "application/json",
    "real-auth-info":            creds.authInfo,
    "real-device-uuid":          creds.deviceUuid,
    "real-request-token":        creds.requestToken,
    "real-device-name":          creds.deviceName || "iPhone14,7",
    "real-device-type":          creds.deviceType || "ios",
    "real-version":              creds.version || "34",
    "real-native-request-token": creds.nativeToken,
    "User-Agent":                creds.userAgent || "real/1 CFNetwork/3826.600.41.2.1 Darwin/24.6.0",
    "Accept-Language":           "en-US,en;q=0.9",
    "Accept-Encoding":           "gzip, deflate, br",
    "Connection":                "keep-alive",
    "baggage":                   creds.baggage || "sentry-environment=production,sentry-public_key=00e61a8109694360a8db52afe3f9a4fa,sentry-release=vg.real-10.163",
    "sentry-trace":              creds.sentryTrace || "0000000000000000000000000000000000000000-0000000000000000-0",
  };
  // Let axios calculate Content-Length. Rewriting signed/token headers can cause 401s.
  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Check if username is available ───────────
async function checkUsername(username, creds) {
  try {
    const res = await axios.get(
      `${BASE}/user/${encodeURIComponent(username)}?_=${Date.now()}`,
      {
        headers: makeHeaders(creds),
        validateStatus: () => true,
      }
    );

    console.log("Username:", username);
    console.log("Status:", res.status);
    console.log("Response:", res.data);

    if (res.status === 404) {
      return { available: true };
    }

 if (res.status === 200) {
  if (res.data?.user === null) {
    return { available: true };
  }

  return {
    available: false,
    user: res.data.user,
  };
}

    if (res.status === 401 || res.status === 403) {
      return {
        available: null,
        authError: true,
        error: "Your saved Real credentials are expired or invalid. Reconnect with a fresh captured request.",
        status: res.status,
        data: res.data,
      };
    }

    return {
      available: null,
      error: `Username check failed with status ${res.status}`,
      status: res.status,
      data: res.data,
    };
  } catch (e) {
    console.error(e);
    return { available: null, error: e.message };
  }
}

// ── Claim username ────────────────────────────
async function claimUsername(username, creds) {
  const body = JSON.stringify({ userName: username });
  try {
    const res = await axios.post(`${BASE}/user/changeusername`, body, {
      headers: makeHeaders(creds),
      validateStatus: () => true,
    });
    return { ok: res.status === 200 || res.status === 201, status: res.status, data: res.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Routes ────────────────────────────────────

// Parse creds from raw request
app.post("/api/parse-creds", (req, res) => {
  const { raw } = req.body;
  if (!raw) return res.status(400).json({ error: "No raw request provided" });
  const creds = parseCreds(raw);
  if (!creds.authInfo) return res.status(400).json({ error: "Could not find real-auth-info header" });
  res.json(creds);
});

// Check a username once
app.post("/api/check", async (req, res) => {
  const { username, creds } = req.body;
  if (!username || !creds) return res.status(400).json({ error: "Missing username or creds" });
  const result = await checkUsername(username, creds);
  if (result.authError) return res.status(result.status || 401).json(result);
  if (result.error) return res.status(result.status || 502).json(result);
  res.json(result);
});

// Start a snipe job (SSE stream)
app.post("/api/snipe", async (req, res) => {
  const { username, creds, interval = 5000 } = req.body;
  if (!username || !creds) return res.status(400).json({ error: "Missing username or creds" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type, data) => {
    try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch (_) {}
  };

  const jobId = Date.now().toString();
  jobs[jobId] = { running: true };

  send("started", { jobId, username, message: `👀 Watching for @${username}...` });

  let checks = 0;

  while (jobs[jobId]?.running) {
    checks++;
    send("checking", { message: `🔍 Check #${checks} — is @${username} available?` });

    const result = await checkUsername(username, creds);

    if (result.authError) {
      send("auth_error", {
        status: result.status,
        message: result.error,
      });
      send("done", { success: false, message: result.error });
      break;
    } else if (result.error) {
      send("error", { message: `Check failed: ${result.error}` });
    } else if (result.available === true) {
      send("available", { message: `✅ @${username} is AVAILABLE! Claiming now...` });

      // Try to claim it
      const claim = await claimUsername(username, creds);
      if (claim.ok) {
        send("claimed", { message: `🎉 Successfully claimed @${username}!` });
        send("done", { success: true, message: `@${username} is now yours!` });
      } else {
        send("claim_failed", { message: `❌ Claim failed: ${JSON.stringify(claim.data || claim.error)}` });
        send("done", { success: false, message: "Available but claim failed — try manually" });
      }
      break;
    } else if (result.available === false) {
      send("log", { message: `@${username} is taken — waiting ${interval / 1000}s...` });
    } else {
      send("error", { message: "The API returned an unknown availability result." });
    }

    // Wait before next check
    await sleep(interval);
  }

  if (!jobs[jobId]?.running) {
    send("stopped", { message: "🛑 Snipe job stopped." });
  }

  delete jobs[jobId];
  res.end();
});

// Stop a snipe job
app.post("/api/stop", (req, res) => {
  const { jobId } = req.body;
  if (jobs[jobId]) {
    jobs[jobId].running = false;
    res.json({ ok: true });
  } else {
    res.json({ ok: false, error: "Job not found" });
  }
});

// Serve React build in production
app.use(express.static(path.join(__dirname, "../client/build")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build/index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✦ ReavesBot running on port ${PORT}`));
