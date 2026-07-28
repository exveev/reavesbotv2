import { useEffect, useMemo, useRef, useState } from "react";

const css = `
:root{--bg:#0b0d10;--panel:#111419;--panel2:#0e1115;--line:#242a33;--line2:#343c48;--text:#f4f6f8;--muted:#8b96a5;--dim:#596575;--accent:#ef476f;--green:#35c98a;--yellow:#e8b44f;--blue:#62a8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,textarea{font:inherit}button{cursor:pointer}.app{min-height:100vh}.topbar{height:58px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;background:rgba(11,13,16,.94);backdrop-filter:blur(14px);z-index:10}.brand{display:flex;align-items:center;gap:11px;font-weight:760;letter-spacing:-.02em}.mark{width:28px;height:28px;border:1px solid var(--line2);display:grid;place-items:center;font-family:"JetBrains Mono",monospace;font-size:12px}.account{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:13px}.dot{width:7px;height:7px;border-radius:50%;background:var(--green)}.shell{max-width:1180px;margin:0 auto;padding:28px 24px 48px}.eyebrow{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);letter-spacing:.12em;text-transform:uppercase}.heading{font-size:30px;letter-spacing:-.045em;margin:6px 0 6px}.sub{color:var(--muted);font-size:14px;margin:0}.grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(360px,.95fr);gap:16px;margin-top:24px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px}.panelHead{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}.panelTitle{font-size:13px;font-weight:700}.panelBody{padding:16px}.label{display:block;font-family:"JetBrains Mono",monospace;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:8px}.textarea{width:100%;min-height:126px;resize:vertical;background:var(--panel2);border:1px solid var(--line2);border-radius:5px;color:var(--text);padding:12px;outline:none;line-height:1.55}.textarea:focus{border-color:#667386}.hint{font-size:12px;color:var(--dim);margin-top:7px}.toolbar{display:flex;gap:8px;align-items:center;margin-top:14px}.select{background:var(--panel2);color:var(--text);border:1px solid var(--line2);border-radius:5px;padding:10px 11px}.btn{border:1px solid var(--line2);border-radius:5px;background:var(--panel2);color:var(--text);padding:10px 14px;font-weight:650}.btnPrimary{background:var(--text);color:#0b0d10;border-color:var(--text)}.btnDanger{border-color:#653143;color:#ff7897}.btn:disabled{opacity:.42;cursor:not-allowed}.statusRow{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}.metric{border-left:2px solid var(--line2);padding:8px 10px;background:var(--panel2)}.metricValue{font-size:18px;font-weight:730}.metricLabel{font-family:"JetBrains Mono",monospace;font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-top:3px}.results{display:flex;flex-direction:column}.resultRow{display:grid;grid-template-columns:minmax(0,1fr) 96px 76px;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--line);font-size:13px}.resultRow:last-child{border-bottom:0}.user{font-family:"JetBrains Mono",monospace}.state{font-size:11px;text-transform:uppercase;letter-spacing:.08em}.available{color:var(--green)}.taken{color:var(--muted)}.error{color:var(--accent)}.pending{color:var(--yellow)}.smallBtn{border:0;background:transparent;color:var(--muted);font-size:12px;text-align:right}.logs{height:340px;overflow:auto;background:#0a0c0f;font-family:"JetBrains Mono",monospace;font-size:11px}.log{display:grid;grid-template-columns:76px 76px 1fr;gap:8px;padding:7px 12px;border-bottom:1px solid #171b21;color:#b9c1cc}.time{color:#596575}.type{color:#7f8b9b;text-transform:uppercase}.log.success{border-left:2px solid var(--green)}.log.warn{border-left:2px solid var(--yellow)}.log.fail{border-left:2px solid var(--accent)}.empty{padding:38px 18px;text-align:center;color:var(--dim);font-size:13px}.modalWrap{position:fixed;inset:0;background:rgba(3,4,6,.82);display:grid;place-items:center;padding:20px;z-index:30}.modal{width:min(560px,100%);background:var(--panel);border:1px solid var(--line2);border-radius:8px}.modal h2{font-size:20px;margin:0}.modal p{font-size:13px;color:var(--muted);line-height:1.6}.raw{width:100%;height:180px;background:#090b0e;color:#c5ced9;border:1px solid var(--line2);border-radius:5px;padding:11px;font-family:"JetBrains Mono",monospace;font-size:11px;resize:none}.errorBox{border-left:2px solid var(--accent);background:#1a1115;color:#ff8aa3;padding:10px 12px;font-size:12px;margin-top:10px}@media(max-width:860px){.grid{grid-template-columns:1fr}.statusRow{grid-template-columns:repeat(2,1fr)}.topbar{padding:0 16px}.shell{padding:22px 16px}.resultRow{grid-template-columns:minmax(0,1fr) 82px 60px}}
`;

function cleanNames(value) {
  return [...new Set(value.split(/[\s,]+/).map(v => v.trim().replace(/^@+/, "")).filter(Boolean))].slice(0, 50);
}

function ConnectModal({ onConnect, onClose }) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const valid = raw.toLowerCase().includes("real-auth-info");

  async function connect() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/parse-creds", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ raw }) });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Could not connect account");
      onConnect(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return <div className="modalWrap"><div className="modal">
    <div className="panelHead"><h2>Connect Real account</h2><button className="smallBtn" onClick={onClose}>Close</button></div>
    <div className="panelBody">
      <p>Paste a complete captured request to <code>api.real.vg</code>. ReavesBot uses its authentication headers and attempts to resolve the signed-in username.</p>
      <textarea className="raw" value={raw} onChange={e=>setRaw(e.target.value)} placeholder={"GET /... HTTP/1.1\nHost: api.real.vg\nreal-auth-info: ..."}/>
      {error && <div className="errorBox">{error}</div>}
      <div className="toolbar" style={{justifyContent:"flex-end"}}><button className="btn" onClick={onClose}>Cancel</button><button className="btn btnPrimary" disabled={!valid||loading} onClick={connect}>{loading?"Connecting...":"Connect account"}</button></div>
    </div>
  </div></div>;
}

export default function App() {
  const [creds, setCreds] = useState(() => { try { return JSON.parse(localStorage.getItem("realCreds")) || null; } catch { return null; } });
  const [showConnect, setShowConnect] = useState(false);
  const [input, setInput] = useState("");
  const [interval, setIntervalValue] = useState("5");
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [results, setResults] = useState({});
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);
  const usernames = useMemo(() => cleanNames(input), [input]);

  const counts = useMemo(() => Object.values(results).reduce((a,r)=>{ a.total++; if(r.available===true)a.available++; else if(r.available===false)a.taken++; else if(r.error)a.errors++; return a; },{total:0,available:0,taken:0,errors:0}),[results]);

  useEffect(()=>{ if(logRef.current) logRef.current.scrollTop=logRef.current.scrollHeight; },[logs]);
  useEffect(()=>{
    if (!creds || creds.accountUsername) return;
    fetch("/api/account",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({creds})}).then(r=>r.json()).then(data=>{
      if(data.accountUsername){ const next={...creds,accountUsername:data.accountUsername}; setCreds(next); localStorage.setItem("realCreds",JSON.stringify(next)); }
    }).catch(()=>{});
  },[creds]);

  function addLog(type, message) { setLogs(old=>[...old,{id:`${Date.now()}-${Math.random()}`,time:new Date().toLocaleTimeString(),type,message}]); }
  function expire() { localStorage.removeItem("realCreds"); setCreds(null); setRunning(false); setShowConnect(true); }

  async function checkAll() {
    if(!creds||!usernames.length)return;
    setChecking(true);
    setResults(Object.fromEntries(usernames.map(username=>[username,{username,status:"checking"}])));
    try{
      const response=await fetch("/api/check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({usernames,creds})});
      const data=await response.json();
      if(response.status===401||response.status===403||data.authError){ addLog("auth","Session expired. Reconnect your account."); expire(); return; }
      if(!response.ok) throw new Error(data.error||`Check failed (${response.status})`);
      const next={}; data.results.forEach(item=>{next[item.username]=item;}); setResults(next);
      addLog("check",`Checked ${data.results.length} usernames.`);
    }catch(e){ addLog("error",e.message); }
    finally{setChecking(false);}
  }

  async function start() {
    if(!creds||!usernames.length)return;
    setRunning(true); setLogs([]); setResults(Object.fromEntries(usernames.map(username=>[username,{username,status:"queued"}])));
    try{
      const response=await fetch("/api/snipe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({usernames,creds,interval:Number(interval)*1000})});
      if(!response.ok||!response.body){ const data=await response.json().catch(()=>({})); throw new Error(data.error||`Could not start (${response.status})`); }
      const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer="";
      while(true){ const {done,value}=await reader.read(); if(done)break; buffer+=decoder.decode(value,{stream:true}); const chunks=buffer.split("\n\n"); buffer=chunks.pop();
        for(const chunk of chunks){ const line=chunk.split("\n").find(x=>x.startsWith("data: ")); if(!line)continue; const event=JSON.parse(line.slice(6));
          if(event.jobId)setJobId(event.jobId); if(event.message)addLog(event.type,event.message);
          if(event.username&&["taken","available","claimed","claim_failed","error"].includes(event.type)) setResults(old=>({...old,[event.username]:{username:event.username,available:event.available,error:event.type==="error"?event.message:null,status:event.type}}));
          if(event.type==="auth_error"){expire();return;}
        }
      }
    }catch(e){addLog("error",e.message);}finally{setRunning(false);setJobId(null);}
  }

  async function stop(){ if(jobId) await fetch("/api/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobId})}); setRunning(false); }
  function disconnect(){localStorage.removeItem("realCreds");setCreds(null);}

  return <div className="app"><style>{css}</style>
    <header className="topbar"><div className="brand"><div className="mark">RB</div><span>ReavesBot</span></div>
      {creds?<div className="account"><span className="dot"/><span>{creds.accountUsername?`@${creds.accountUsername}`:"Connected account"}</span><button className="smallBtn" onClick={disconnect}>Disconnect</button></div>:<button className="btn btnPrimary" onClick={()=>setShowConnect(true)}>Connect account</button>}
    </header>
    <main className="shell">
      <div className="eyebrow">Username operations console</div><h1 className="heading">Monitor multiple targets from one session.</h1><p className="sub">Check up to 50 usernames, review each result, and run one shared monitoring job.</p>
      <div className="grid">
        <section className="panel"><div className="panelHead"><span className="panelTitle">Targets</span><span className="eyebrow">{usernames.length}/50 loaded</span></div><div className="panelBody">
          <label className="label">Usernames</label><textarea className="textarea" value={input} onChange={e=>setInput(e.target.value)} placeholder={"\username_one\nusername_two\nusername_three"}/><div className="hint">Separate names with spaces, commas, or new lines. Leading @ symbols are removed automatically.</div>
          <div className="toolbar"><select className="select" value={interval} onChange={e=>setIntervalValue(e.target.value)}><option value="3">3 second interval</option><option value="5">5 second interval</option><option value="10">10 second interval</option><option value="30">30 second interval</option><option value="60">60 second interval</option></select><button className="btn" disabled={!creds||!usernames.length||checking||running} onClick={checkAll}>{checking?"Checking...":"Check all"}</button>{running?<button className="btn btnDanger" onClick={stop}>Stop monitor</button>:<button className="btn btnPrimary" disabled={!creds||!usernames.length} onClick={start}>Start monitor</button>}</div>
          <div className="statusRow"><div className="metric"><div className="metricValue">{counts.total||usernames.length}</div><div className="metricLabel">Targets</div></div><div className="metric"><div className="metricValue">{counts.available}</div><div className="metricLabel">Available</div></div><div className="metric"><div className="metricValue">{counts.taken}</div><div className="metricLabel">Taken</div></div><div className="metric"><div className="metricValue">{counts.errors}</div><div className="metricLabel">Errors</div></div></div>
        </div>
        <div className="panelHead"><span className="panelTitle">Current results</span><button className="smallBtn" onClick={()=>setResults({})}>Clear</button></div><div className="results">{Object.keys(results).length?Object.values(results).map(r=><div className="resultRow" key={r.username}><span className="user">@{r.username}</span><span className={`state ${r.error?"error":r.available===true?"available":r.available===false?"taken":"pending"}`}>{r.error?"Error":r.status==="claimed"?"Claimed":r.available===true?"Available":r.available===false?"Taken":r.status||"Pending"}</span><button className="smallBtn" onClick={()=>setInput(r.username)}>Focus</button></div>):<div className="empty">No checks have run yet.</div>}</div>
        </section>
        <section className="panel"><div className="panelHead"><span className="panelTitle">Live activity</span><button className="smallBtn" onClick={()=>setLogs([])}>Clear</button></div><div className="logs" ref={logRef}>{logs.length?logs.map(log=><div className={`log ${["claimed","available"].includes(log.type)?"success":["waiting","checking","started"].includes(log.type)?"warn":["error","auth_error","claim_failed"].includes(log.type)?"fail":""}`} key={log.id}><span className="time">{log.time}</span><span className="type">{log.type}</span><span>{log.message}</span></div>):<div className="empty">Activity will appear here while checking or monitoring.</div>}</div></section>
      </div>
    </main>
    {showConnect&&<ConnectModal onClose={()=>setShowConnect(false)} onConnect={data=>{localStorage.setItem("realCreds",JSON.stringify(data));setCreds(data);setShowConnect(false);}}/>}
  </div>;
}
