import { useState, useRef, useEffect } from "react";

const C = {
  bg: "#000", surface: "#111", surface2: "#181818",
  border: "#1e1e1e", border2: "#2a2a2a",
  text: "#fff", muted: "#666", dim: "#333",
  accent: "#e8294c", green: "#22c55e", yellow: "#f59e0b",
};
const ff = { h: "'Barlow Condensed',sans-serif", b: "'Barlow',sans-serif" };

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #000; color: #fff; font-family: 'Barlow', sans-serif; }
  input, textarea, select { font-family: inherit; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  .fade-up { animation: fadeUp 0.3s ease; }
`;

const Spinner = ({ color = C.accent }) => (
  <div style={{ width: 18, height: 18, border: `2px solid #333`, borderTop: `2px solid ${color}`, borderRadius: "50%", animation: "spin .7s linear infinite", display: "inline-block" }} />
);

// ── CONNECT MODAL ─────────────────────────────
function ConnectModal({ onConnect, onClose }) {
  const [raw, setRaw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    setLoading(true); setErr("");
    const r = await fetch("/api/parse-creds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const data = await r.json();
    setLoading(false);
    if (data.error) { setErr(data.error); return; }
    onConnect(data);
  };

  const valid = raw.includes("real-auth-info");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}>
      <div style={{ background: "#141414", borderRadius: 18, padding: 28, width: "100%", maxWidth: 460, border: `1px solid ${C.border2}` }} className="fade-up">
        <h2 style={{ fontFamily: ff.h, fontSize: 24, fontWeight: 900, marginBottom: 6 }}>Connect Account</h2>
        <p style={{ color: C.muted, fontFamily: ff.b, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
          Open Charles / Proxyman, capture any request to <code style={{ background: "#1a1a1a", padding: "1px 6px", borderRadius: 4 }}>api.real.vg</code> from the Real app, then paste the full raw request below.
        </p>
        <textarea
          value={raw} onChange={e => setRaw(e.target.value)}
          placeholder={"GET /user/username?... HTTP/1.1\nHost: api.real.vg\nreal-auth-info: ...\nreal-device-uuid: ..."}
          style={{ width: "100%", height: 150, background: "#0a0a0a", border: `1px solid ${C.border2}`, borderRadius: 10, color: "#aaa", fontFamily: "monospace", fontSize: 11, padding: 12, resize: "none", outline: "none", lineHeight: 1.6 }}
        />
        {valid && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "#081a08", borderRadius: 8, border: "1px solid #155a15" }}>
            <p style={{ color: C.green, fontFamily: ff.b, fontSize: 12 }}>✓ Real app request detected</p>
          </div>
        )}
        {err && <p style={{ color: C.accent, fontFamily: ff.b, fontSize: 12, marginTop: 8 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "13px 0", borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.muted, cursor: "pointer", fontFamily: ff.h, fontWeight: 700, fontSize: 15 }}>Cancel</button>
          <button onClick={handle} disabled={!valid || loading} style={{ flex: 2, padding: "13px 0", borderRadius: 8, border: "none", background: valid ? "#fff" : C.dim, color: "#000", cursor: valid ? "pointer" : "default", fontFamily: ff.h, fontWeight: 800, fontSize: 15 }}>
            {loading ? "Connecting..." : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── LOG ENTRY ─────────────────────────────────
function LogEntry({ msg, type }) {
  const colors = {
    checking: C.muted,
    available: C.green,
    claimed: C.green,
    claim_failed: C.accent,
    stopped: C.yellow,
    log: "#aaa",
    error: C.accent,
    auth_error: C.accent,
    started: C.yellow,
    done: C.green,
  };
  return (
    <div style={{ padding: "4px 0", fontFamily: "monospace", fontSize: 12, color: colors[type] || "#aaa", lineHeight: 1.6, borderBottom: `1px solid #111` }}>
      <span style={{ color: "#444", marginRight: 8 }}>{new Date().toLocaleTimeString()}</span>
      {msg}
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────
export default function App() {
  const [creds, setCreds] = useState(() => {
    try {
      const saved = localStorage.getItem("realCreds");
      return saved ? JSON.parse(saved) : null;
    } catch {
      localStorage.removeItem("realCreds");
      return null;
    }
  });
  const [showConnect, setShowConnect] = useState(false);
  const [username, setUsername] = useState("");
  const [interval, setInterval_] = useState("5");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const logsRef = useRef();

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const addLog = (msg, type) => setLogs(l => [...l, { msg, type, id: Date.now() + Math.random() }]);

  const disconnectExpiredSession = () => {
    localStorage.removeItem("realCreds");
    setCreds(null);
  };

  // Check once
  const handleCheck = async () => {
    if (!creds || !username.trim()) return;
    setChecking(true);
    setCheckResult(null);

    try {
      const r = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), creds }),
      });
      const data = await r.json();

      if (r.status === 401 || r.status === 403 || data.authError) {
        disconnectExpiredSession();
        setCheckResult({ error: data.error || "Your session expired. Reconnect your account." });
        setShowConnect(true);
        return;
      }

      if (!r.ok || data.error) {
        setCheckResult({ error: data.error || `Request failed (${r.status})` });
        return;
      }

      setCheckResult(data);
    } catch (error) {
      setCheckResult({ error: error.message || "Could not reach the server." });
    } finally {
      setChecking(false);
    }
  };

  // Start snipe
  const handleStart = async () => {
    if (!creds || !username.trim()) return;
    setRunning(true); setLogs([]); setResult(null);

    const r = await fetch("/api/snipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), creds, interval: parseInt(interval) * 1000 || 5000 }),
    });

    if (!r.ok || !r.body) {
      let message = `Could not start (${r.status})`;
      try {
        const data = await r.json();
        message = data.error || message;
      } catch (_) {}
      addLog(message, "error");
      if (r.status === 401 || r.status === 403) {
        disconnectExpiredSession();
        setShowConnect(true);
      }
      setRunning(false);
      return;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      const parts = buf.split("\n\n");
      buf = parts.pop();
      for (const part of parts) {
        const line = part.replace("data: ", "").trim();
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.jobId) setJobId(evt.jobId);
          if (evt.message) addLog(evt.message, evt.type);
          if (evt.type === "auth_error") {
            disconnectExpiredSession();
            setShowConnect(true);
          }
          if (evt.type === "done" || evt.type === "claimed" || evt.type === "stopped") {
            setResult({ success: evt.success, message: evt.message });
          }
        } catch (_) {}
      }
    }
    setRunning(false);
  };

  const handleStop = async () => {
    if (!jobId) { setRunning(false); return; }
    await fetch("/api/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    setRunning(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "rgba(0,0,0,.9)", backdropFilter: "blur(12px)", zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: C.accent, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: ff.h, fontWeight: 900, fontSize: 16 }}>R</div>
          <span style={{ fontFamily: ff.h, fontWeight: 900, fontSize: 20, letterSpacing: "0.01em" }}>ReavesBot</span>
        </div>
        {creds ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, boxShadow: `0 0 8px ${C.green}` }} />
            <span style={{ fontFamily: ff.b, fontSize: 13, color: "#aaa" }}>{creds.deviceName || "Connected"}</span>
            <button   onClick={() => {     localStorage.removeItem("realCreds");     setCreds(null);   }} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
          </div>
        ) : (
          <button onClick={() => setShowConnect(true)} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontFamily: ff.h, fontWeight: 800, fontSize: 14 }}>Connect Account</button>
        )}
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 24px" }} className="fade-up">

        {/* Hero */}
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <h1 style={{ fontFamily: ff.h, fontSize: 36, fontWeight: 900, marginBottom: 8 }}>Username Sniper</h1>
          <p style={{ color: C.muted, fontFamily: ff.b, fontSize: 14, lineHeight: 1.6 }}>
            Continuously monitors a username on the Real app.<br />The moment it's available, it claims it instantly.
          </p>
        </div>

        {/* Input card */}
        <div style={{ background: C.surface, borderRadius: 16, padding: 24, border: `1px solid ${C.border}`, marginBottom: 16 }}>

          {/* Username input */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: ff.h, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: C.muted, marginBottom: 8, textTransform: "uppercase" }}>Target Username</div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", background: "#0d0d0d", border: `1px solid ${C.border2}`, borderRadius: 8, padding: "0 14px" }}>
                <span style={{ color: C.muted, fontFamily: ff.b, fontSize: 15, marginRight: 4 }}>@</span>
                <input
                  value={username} onChange={e => { setUsername(e.target.value); setCheckResult(null); }}
                  placeholder="username"
                  style={{ flex: 1, padding: "12px 0", background: "transparent", border: "none", color: C.text, fontFamily: ff.b, fontSize: 15, outline: "none" }}
                />
              </div>
              <button onClick={handleCheck} disabled={!creds || !username.trim() || checking} style={{
                padding: "12px 16px", borderRadius: 8, border: `1px solid ${C.border2}`,
                background: "#0d0d0d", color: C.text, cursor: creds && username.trim() ? "pointer" : "default",
                fontFamily: ff.h, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6,
                opacity: creds && username.trim() ? 1 : 0.5,
              }}>
                {checking ? <Spinner /> : "Check"}
              </button>
            </div>

            {/* Check result */}
            {checkResult && (
              <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 8, background: checkResult.available === true ? "#081a08" : "#1a0808", border: `1px solid ${checkResult.available === true ? "#155a15" : "#4a1515"}` }}>
                <p style={{ color: checkResult.available === true ? C.green : C.accent, fontFamily: ff.b, fontSize: 13 }}>
                  {checkResult.error
                    ? checkResult.error
                    : checkResult.available === true
                      ? `✓ @${username} is available!`
                      : checkResult.available === false
                        ? `✗ @${username} is taken`
                        : "Could not determine availability."}
                </p>
              </div>
            )}
          </div>

          {/* Check interval */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: ff.h, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: C.muted, marginBottom: 8, textTransform: "uppercase" }}>Check Interval (seconds)</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["3", "5", "10", "30", "60"].map(s => (
                <button key={s} onClick={() => setInterval_(s)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 8, cursor: "pointer",
                  border: interval === s ? "none" : `1px solid ${C.border2}`,
                  background: interval === s ? C.accent : "#0d0d0d",
                  color: interval === s ? "#fff" : C.muted,
                  fontFamily: ff.h, fontWeight: 700, fontSize: 13,
                }}>{s}s</button>
              ))}
            </div>
            <p style={{ color: C.dim, fontFamily: ff.b, fontSize: 11, marginTop: 6 }}>Lower = faster but higher rate limit risk. 5s recommended.</p>
          </div>

          {/* Start/Stop button */}
          {!creds ? (
            <button onClick={() => setShowConnect(true)} style={{ width: "100%", padding: "15px 0", borderRadius: 10, border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontFamily: ff.h, fontWeight: 800, fontSize: 16 }}>
              Connect Account to Start
            </button>
          ) : running ? (
            <button onClick={handleStop} style={{ width: "100%", padding: "15px 0", borderRadius: 10, border: "none", background: "#1a1a1a", color: C.accent, cursor: "pointer", fontFamily: ff.h, fontWeight: 800, fontSize: 16, border: `1px solid ${C.accent}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <div style={{ width: 10, height: 10, background: C.accent, borderRadius: 2, animation: "pulse 1s infinite" }} />
              Sniping @{username}... — Stop
            </button>
          ) : (
            <button onClick={handleStart} disabled={!username.trim()} style={{ width: "100%", padding: "15px 0", borderRadius: 10, border: "none", background: username.trim() ? "#fff" : C.dim, color: "#000", cursor: username.trim() ? "pointer" : "default", fontFamily: ff.h, fontWeight: 800, fontSize: 16, opacity: username.trim() ? 1 : 0.6 }}>
              ▶ Start Sniping
            </button>
          )}
        </div>

        {/* Result banner */}
        {result && (
          <div style={{ padding: "16px 20px", borderRadius: 12, background: result.success ? "#081a08" : "#1a0808", border: `1px solid ${result.success ? "#155a15" : "#4a1515"}`, marginBottom: 16 }}>
            <p style={{ color: result.success ? C.green : C.accent, fontFamily: ff.h, fontWeight: 700, fontSize: 18 }}>
              {result.success ? "🎉 Username Claimed!" : "❌ Claim Failed"}
            </p>
            <p style={{ color: result.success ? "#aaa" : "#888", fontFamily: ff.b, fontSize: 13, marginTop: 4 }}>{result.message}</p>
          </div>
        )}

        {/* Logs */}
        {logs.length > 0 && (
          <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: ff.h, fontWeight: 700, fontSize: 13, color: C.muted }}>ACTIVITY LOG</span>
              <button onClick={() => setLogs([])} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontFamily: ff.b, fontSize: 12 }}>Clear</button>
            </div>
            <div ref={logsRef} style={{ maxHeight: 300, overflowY: "auto", padding: "8px 16px" }}>
              {logs.map(l => <LogEntry key={l.id} msg={l.msg} type={l.type} />)}
            </div>
          </div>
        )}

        {/* Info cards */}
        {!running && logs.length === 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
            {[
              { emoji: "👀", title: "Watches 24/7", desc: "Checks the username on an interval you set" },
              { emoji: "⚡", title: "Instant Claim", desc: "The moment it's free, claims it automatically" },
              { emoji: "🔔", title: "Real-time logs", desc: "See every check and result as it happens" },
              { emoji: "🔒", title: "Your creds", desc: "Saved in this browser until you disconnect or they expire" },
            ].map(c => (
              <div key={c.title} style={{ background: C.surface, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>{c.emoji}</div>
                <div style={{ fontFamily: ff.h, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{c.title}</div>
                <div style={{ color: C.muted, fontFamily: ff.b, fontSize: 12, lineHeight: 1.5 }}>{c.desc}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showConnect && (   <ConnectModal     onConnect={c => {       localStorage.setItem("realCreds", JSON.stringify(c));       setCreds(c);       setShowConnect(false);     }}     onClose={() => setShowConnect(false)}   /> )}
    </div>
  );
}
