const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const BASE = "https://api.real.vg";
const jobs = new Map();
let currentJobId = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseCreds(raw) {
  const result = {};
  const wanted = {
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

  for (const line of String(raw || "").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (wanted[key]) result[wanted[key]] = value;
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
    "real-native-request-token": creds.nativeToken,
    "real-device-name": creds.deviceName || "iPhone14,7",
    "real-device-type": creds.deviceType || "ios",
    "real-version": creds.version || "34",
    "User-Agent": creds.userAgent || "real/1 CFNetwork/3826.600.41.2.1 Darwin/24.6.0",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    baggage: creds.baggage,
    "sentry-trace": creds.sentryTrace,
  };

  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function normalizeUsernames(input) {
  const values = Array.isArray(input) ? input : [input];
  return [...new Set(
    values
      .flatMap(value => String(value || "").split(/[\s,]+/))
      .map(value => value.trim().replace(/^@+/, ""))
      .filter(Boolean)
  )].slice(0, 50);
}

async function checkUsername(username, creds) {
  try {
    const response = await axios.get(
      `${BASE}/user/${encodeURIComponent(username)}?_=${Date.now()}`,
      {
        headers: makeHeaders(creds),
        validateStatus: () => true,
        timeout: 15000,
      }
    );

    if (response.status === 404) return { username, available: true, status: 404 };
    if (response.status === 200) {
      if (response.data?.user === null) return { username, available: true, status: 200 };
      return { username, available: false, user: response.data?.user, status: 200 };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        username,
        available: null,
        authError: true,
        error: `Authentication rejected with status ${response.status}`,
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
    const timedOut = error.code === "ECONNABORTED";
    return {
      username,
      available: null,
      error: timedOut ? "Username check timed out" : error.message,
    };
  }
}

async function claimUsername(username, creds) {
  try {
    const response = await axios.post(
      `${BASE}/user/changeusername`,
      { userName: username },
      {
        headers: makeHeaders(creds),
        validateStatus: () => true,
        timeout: 15000,
      }
    );

    return {
      ok: response.status === 200 || response.status === 201,
      status: response.status,
      data: response.data,
      authError: response.status === 401 || response.status === 403,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.code === "ECONNABORTED" ? "Claim request timed out" : error.message,
    };
  }
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    usernames: job.usernames,
    interval: job.interval,
    running: job.running,
    state: job.state,
    cycle: job.cycle,
    checks: job.checks,
    startedAt: job.startedAt,
    stoppedAt: job.stoppedAt,
    lastCheckAt: job.lastCheckAt,
    results: job.results,
    logs: job.logs,
    authFailures: job.authFailures,
  };
}

function emitJobEvent(job, type, data = {}) {
  const event = {
    id: ++job.eventSequence,
    type,
    timestamp: new Date().toISOString(),
    ...data,
  };

  job.logs.push(event);
  if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500);

  const payload = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of job.clients) {
    try {
      client.write(payload);
    } catch (_) {
      job.clients.delete(client);
    }
  }

  return event;
}

async function runJob(job) {
  if (job.workerRunning) return;
  job.workerRunning = true;

  emitJobEvent(job, "started", {
    jobId: job.id,
    usernames: job.usernames,
    message: `Monitoring ${job.usernames.length} username${job.usernames.length === 1 ? "" : "s"}.`,
  });

  try {
    while (job.running) {
      job.cycle += 1;
      emitJobEvent(job, "checking", {
        cycle: job.cycle,
        message: `Cycle ${job.cycle} started.`,
      });

      for (const username of job.usernames) {
        if (!job.running) break;

        const result = await checkUsername(username, job.creds);
        job.checks += 1;
        job.lastCheckAt = new Date().toISOString();

        if (result.authError) {
          job.authFailures += 1;
          job.results[username] = {
            username,
            available: null,
            status: "auth_warning",
            error: result.error,
            checkedAt: job.lastCheckAt,
          };

          if (job.authFailures < 3) {
            emitJobEvent(job, "warning", {
              username,
              status: result.status,
              message: `Temporary authentication failure (${job.authFailures}/3). The server will retry.`,
            });
            await sleep(3000);
            continue;
          }

          job.state = "auth_error";
          job.running = false;
          emitJobEvent(job, "auth_error", {
            username,
            status: result.status,
            message: "Real rejected the saved credentials three times in a row. Capture a fresh request and reconnect.",
          });
          break;
        }

        job.authFailures = 0;

        if (result.error) {
          job.results[username] = {
            username,
            available: null,
            status: "error",
            error: result.error,
            checkedAt: job.lastCheckAt,
          };
          emitJobEvent(job, "error", {
            username,
            message: `@${username}: ${result.error}`,
          });
          continue;
        }

        if (result.available === false) {
          job.results[username] = {
            username,
            available: false,
            status: "taken",
            checkedAt: job.lastCheckAt,
          };
          emitJobEvent(job, "taken", {
            username,
            available: false,
            message: `@${username} is taken.`,
          });
          continue;
        }

        job.results[username] = {
          username,
          available: true,
          status: "available",
          checkedAt: job.lastCheckAt,
        };
        emitJobEvent(job, "available", {
          username,
          available: true,
          message: `@${username} is available. Attempting claim.`,
        });

        const claim = await claimUsername(username, job.creds);
        if (claim.authError) {
          job.state = "auth_error";
          job.running = false;
          emitJobEvent(job, "auth_error", {
            username,
            status: claim.status,
            message: "Real rejected the credentials while attempting the claim.",
          });
          break;
        }

        if (claim.ok) {
          job.results[username] = {
            username,
            available: true,
            status: "claimed",
            checkedAt: new Date().toISOString(),
          };
          job.state = "claimed";
          job.running = false;
          emitJobEvent(job, "claimed", {
            username,
            success: true,
            message: `Successfully claimed @${username}.`,
          });
          break;
        }

        job.results[username] = {
          username,
          available: true,
          status: "claim_failed",
          error: claim.error || `Claim failed with status ${claim.status || "unknown"}`,
          checkedAt: new Date().toISOString(),
        };
        emitJobEvent(job, "claim_failed", {
          username,
          success: false,
          status: claim.status,
          message: `Claim failed for @${username}${claim.status ? ` with status ${claim.status}` : ""}.`,
        });
      }

      if (job.running) {
        emitJobEvent(job, "waiting", {
          message: `Next cycle in ${Math.round(job.interval / 1000)} seconds.`,
        });
        await sleep(job.interval);
      }
    }
  } catch (error) {
    job.state = "error";
    job.running = false;
    emitJobEvent(job, "error", {
      message: `Monitor stopped unexpectedly: ${error.message}`,
    });
  } finally {
    job.workerRunning = false;
    job.stoppedAt = new Date().toISOString();
    if (job.state === "running") job.state = "stopped";
    emitJobEvent(job, "stopped", {
      message: job.state === "claimed" ? "Monitor completed after a successful claim." : "Monitor stopped.",
    });
  }
}

function createJob({ usernames, creds, interval }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    usernames,
    creds,
    interval: Math.max(1000, Number(interval) || 5000),
    running: true,
    workerRunning: false,
    state: "running",
    cycle: 0,
    checks: 0,
    authFailures: 0,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    lastCheckAt: null,
    results: Object.fromEntries(
      usernames.map(username => [username, { username, status: "queued", available: null }])
    ),
    logs: [],
    clients: new Set(),
    eventSequence: 0,
  };

  jobs.set(id, job);
  currentJobId = id;
  setImmediate(() => runJob(job));
  return job;
}

app.post("/api/parse-creds", (req, res) => {
  const { raw } = req.body;
  if (!raw) return res.status(400).json({ error: "No raw request provided" });
  const creds = parseCreds(raw);
  if (!creds.authInfo) return res.status(400).json({ error: "Could not find real-auth-info header" });
  res.json(creds);
});

app.post("/api/check", async (req, res) => {
  const usernames = normalizeUsernames(req.body.usernames || req.body.username);
  const { creds } = req.body;
  if (!usernames.length || !creds) {
    return res.status(400).json({ error: "Missing usernames or creds" });
  }

  const results = await Promise.all(usernames.map(username => checkUsername(username, creds)));
  const authError = results.find(result => result.authError);
  if (authError) return res.status(authError.status || 401).json(authError);
  res.json({ results });
});

app.post("/api/start", (req, res) => {
  const usernames = normalizeUsernames(req.body.usernames || req.body.username);
  const { creds, interval = 5000 } = req.body;

  if (!usernames.length || !creds) {
    return res.status(400).json({ error: "Missing usernames or creds" });
  }

  const existing = currentJobId ? jobs.get(currentJobId) : null;
  if (existing?.running) {
    return res.status(409).json({
      error: "A monitoring job is already running",
      job: publicJob(existing),
    });
  }

  const job = createJob({ usernames, creds, interval });
  return res.status(201).json({ job: publicJob(job) });
});

app.get("/api/jobs/current", (req, res) => {
  const job = currentJobId ? jobs.get(currentJobId) : null;
  if (!job) return res.status(404).json({ error: "No monitoring job found" });
  res.json({ job: publicJob(job) });
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ job: publicJob(job) });
});

app.get("/api/jobs/:jobId/events", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  job.clients.add(res);
  res.write(`event: snapshot\ndata: ${JSON.stringify(publicJob(job))}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch (_) {
      clearInterval(heartbeat);
      job.clients.delete(res);
    }
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    job.clients.delete(res);
  });
});

app.post("/api/stop", (req, res) => {
  const jobId = req.body.jobId || currentJobId;
  const job = jobId ? jobs.get(jobId) : null;
  if (!job) return res.status(404).json({ ok: false, error: "Job not found" });

  job.running = false;
  if (job.state === "running") job.state = "stopping";
  emitJobEvent(job, "stop_requested", { message: "Stop requested." });
  res.json({ ok: true, job: publicJob(job) });
});


// Prediction market helpers and controlled repeat jobs.
const predictionJobs = new Map();
let currentPredictionJobId = null;

function predictionJobPublic(job) {
  if (!job) return null;
  return {
    id: job.id, running: job.running, state: job.state, marketId: job.marketId,
    outcomeId: job.outcomeId, amount: job.amount, minSharesExpected: job.minSharesExpected,
    intervalMs: job.intervalMs, maxRepeats: job.maxRepeats, completed: job.completed,
    failedAttempts: job.failedAttempts, consecutiveErrors: job.consecutiveErrors,
    startedAt: job.startedAt, stoppedAt: job.stoppedAt, lastStatus: job.lastStatus,
    lastError: job.lastError, logs: job.logs
  };
}

function predictionLog(job, type, message, extra = {}) {
  const entry = { id: `${Date.now()}-${Math.random()}`, timestamp: new Date().toISOString(), type, message, ...extra };
  job.logs.push(entry);
  if (job.logs.length > 250) job.logs.splice(0, job.logs.length - 250);
}

function randomOrderInstanceId() {
  return require("crypto").randomBytes(9).toString("base64url");
}

async function fetchPredictionMarkets(sport, creds) {
  const response = await axios.get(`${BASE}/predictions/gamemarkets/${encodeURIComponent(sport)}?_=${Date.now()}`, {
    headers: makeHeaders(creds), validateStatus: () => true, timeout: 15000
  });
  return response;
}

async function addPredictionPosition({ marketId, outcomeId, amount, minSharesExpected, creds }) {
  try {
    const response = await axios.post(`${BASE}/predictions/addposition`, {
      marketId: Number(marketId), outcomeId: Number(outcomeId), amount: Number(amount),
      minSharesExpected: Number(minSharesExpected), orderInstanceId: randomOrderInstanceId()
    }, { headers: makeHeaders(creds), validateStatus: () => true, timeout: 15000 });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, data: response.data };
  } catch (error) {
    return { ok: false, status: null, error: error.code === "ECONNABORTED" ? "Prediction request timed out" : error.message };
  }
}

async function runPredictionJob(job) {
  while (job.running && job.completed < job.maxRepeats) {
    const result = await addPredictionPosition(job);
    job.lastStatus = result.status;
    if (result.ok) {
      job.completed += 1;
      job.consecutiveErrors = 0;
      job.lastError = null;
      predictionLog(job, "success", `Position ${job.completed}/${job.maxRepeats} accepted.`, { status: result.status });
      if (!job.running || job.completed >= job.maxRepeats) break;
      await sleep(job.intervalMs);
      continue;
    }

    job.failedAttempts += 1;
    job.consecutiveErrors += 1;
    job.lastError = result.error || `Request failed with status ${result.status}`;

    if (result.status === 401 || result.status === 403) {
      job.state = "reauth_required";
      job.running = false;
      predictionLog(job, "auth_error", "Authentication was rejected. Reconnect before continuing.", { status: result.status });
      break;
    }

    if (result.status && result.status >= 400 && result.status < 500 && result.status !== 429) {
      job.state = "failed";
      job.running = false;
      predictionLog(job, "error", `Request rejected with status ${result.status}; repeat job stopped.`, { status: result.status });
      break;
    }

    const retryMs = Math.min(5000 * (2 ** Math.min(job.consecutiveErrors - 1, 4)), 60000);
    job.state = "retrying";
    predictionLog(job, "retry", `${job.lastError}. Retrying in ${Math.round(retryMs / 1000)}s.`, { status: result.status, retryMs });
    await sleep(retryMs);
    if (job.running) job.state = "running";
  }

  if (job.running && job.completed >= job.maxRepeats) job.state = "completed";
  job.running = false;
  job.stoppedAt = new Date().toISOString();
  if (job.state === "running") job.state = "stopped";
}

app.post("/api/predictions/markets", async (req, res) => {
  const { creds, sport = "mlb" } = req.body || {};
  if (!creds) return res.status(400).json({ error: "Missing credentials" });
  try {
    const response = await fetchPredictionMarkets(sport, creds);
    if (response.status === 401 || response.status === 403) return res.status(response.status).json({ error: "Authentication rejected", authError: true });
    if (response.status < 200 || response.status >= 300) return res.status(response.status).json({ error: `Market fetch failed with status ${response.status}`, details: response.data });
    res.json({ ok: true, markets: response.data });
  } catch (error) {
    res.status(502).json({ error: error.code === "ECONNABORTED" ? "Market fetch timed out" : error.message });
  }
});

app.post("/api/predictions/repeat/start", (req, res) => {
  const { creds, marketId, outcomeId, amount, minSharesExpected, intervalMs = 3000, maxRepeats = 20 } = req.body || {};
  if (!creds || !marketId || !outcomeId || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !Number.isFinite(Number(minSharesExpected)) || Number(minSharesExpected) < 0) {
    return res.status(400).json({ error: "Missing or invalid prediction fields" });
  }
  const existing = currentPredictionJobId ? predictionJobs.get(currentPredictionJobId) : null;
  if (existing?.running) return res.status(409).json({ error: "A prediction repeat job is already running", job: predictionJobPublic(existing) });

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id, creds, marketId: Number(marketId), outcomeId: Number(outcomeId), amount: Number(amount),
    minSharesExpected: Number(minSharesExpected), intervalMs: Math.max(3000, Number(intervalMs) || 3000),
    maxRepeats: Math.min(100, Math.max(1, Number(maxRepeats) || 20)), completed: 0, failedAttempts: 0,
    consecutiveErrors: 0, running: true, state: "running", startedAt: new Date().toISOString(), stoppedAt: null,
    lastStatus: null, lastError: null, logs: []
  };
  predictionJobs.set(id, job);
  currentPredictionJobId = id;
  predictionLog(job, "started", `Repeat job started for market ${job.marketId}, outcome ${job.outcomeId}.`);
  setImmediate(() => runPredictionJob(job));
  res.status(201).json({ job: predictionJobPublic(job) });
});

app.get("/api/predictions/repeat/current", (req, res) => {
  const job = currentPredictionJobId ? predictionJobs.get(currentPredictionJobId) : null;
  if (!job) return res.status(404).json({ error: "No prediction repeat job found" });
  res.json({ job: predictionJobPublic(job) });
});

app.post("/api/predictions/repeat/stop", (req, res) => {
  const id = req.body?.jobId || currentPredictionJobId;
  const job = id ? predictionJobs.get(id) : null;
  if (!job) return res.status(404).json({ error: "Prediction repeat job not found" });
  job.running = false;
  job.state = "stopping";
  predictionLog(job, "stop_requested", "Stop requested.");
  res.json({ ok: true, job: predictionJobPublic(job) });
});

app.use(express.static(path.join(__dirname, "../client/build")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build/index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ReavesBot running on port ${PORT}`));
