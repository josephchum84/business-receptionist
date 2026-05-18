const fs = require('fs');
const path = require('path');
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Business Receptionist Monitor</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f1117;--card:#161b22;--border:#21262d;--text:#c9d1d9;--text-muted:#8b949e;
  --green:#3fb950;--red:#f85149;--yellow:#d29922;--blue:#58a6ff;--purple:#d2a8ff;
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.topbar{display:flex;align-items:center;gap:12px;padding:12px 24px;background:var(--card);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
.topbar svg{width:28px;height:28px;fill:var(--green)}
.topbar h1{font-size:16px;font-weight:600;white-space:nowrap}
.topbar .spacer{flex:1}
.topbar .clock{font-size:13px;color:var(--text-muted);font-variant-numeric:tabular-nums}
.live-dot{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--green);margin-left:12px}
.live-dot::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.tabs{display:flex;gap:0;background:var(--card);border-bottom:1px solid var(--border);padding:0 24px}
.tab{padding:10px 20px;font-size:14px;font-weight:500;color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent;transition:color .15s,border-color .15s;user-select:none}
.tab:hover{color:var(--text)}
.tab.active{color:var(--text);border-bottom-color:var(--blue)}
.tab .badge{background:var(--red);color:#fff;font-size:11px;padding:1px 6px;border-radius:10px;margin-left:6px;vertical-align:middle}
.content{padding:20px 24px;display:none}
.content.active{display:block}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px}
.card .label{font-size:12px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
.card .value{font-size:24px;font-weight:700}
.card .value.green{color:var(--green)}
.card .value.red{color:var(--red)}
.card .value.yellow{color:var(--yellow)}
.card .value.blue{color:var(--blue)}
.section-title{font-size:14px;font-weight:600;margin-bottom:12px;color:var(--text)}
.services{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px}
.service-item{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px 14px;font-size:13px}
.status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.status-dot.ok{background:var(--green)}
.status-dot.fail{background:var(--red)}
.status-dot.unknown{background:var(--yellow)}
.session-card{background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;cursor:pointer;transition:border-color .15s}
.session-card:hover{border-color:var(--text-muted)}
.session-header{display:flex;align-items:center;gap:10px;padding:12px 16px}
.session-jid{font-size:13px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.state-badge{font-size:11px;padding:2px 8px;border-radius:12px;font-weight:600;text-transform:uppercase;letter-spacing:.3px}
.state-badge.idle{background:rgba(63,185,80,.15);color:var(--green)}
.state-badge.booking{background:rgba(210,153,34,.15);color:var(--yellow)}
.state-badge.error{background:rgba(248,81,73,.15);color:var(--red)}
.msg-counts{font-size:12px;color:var(--text-muted)}
.session-history{display:none;border-top:1px solid var(--border);padding:12px 16px;max-height:300px;overflow-y:auto}
.session-card.expanded .session-history{display:block}
.history-item{margin-bottom:8px;font-size:13px;line-height:1.5;word-break:break-word}
.history-user{color:var(--purple)}
.history-agent{color:var(--green)}
.history-agent.empty{color:var(--red);font-weight:700}
.log-controls{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
.log-controls select,.log-controls input{background:var(--card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:13px}
.log-controls input{width:240px}
.log-controls button{background:var(--card);border:1px solid var(--border);color:var(--text);padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;transition:background .15s}
.log-controls button:hover{background:var(--border)}
.log-controls label{display:flex;align-items:center;gap:5px;font-size:13px;color:var(--text-muted);cursor:pointer}
.log-box{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;max-height:70vh;overflow-y:auto;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:12px;line-height:1.7}
.log-entry{padding:3px 6px;border-radius:3px;margin-bottom:2px}
.log-entry.error-row{background:rgba(248,81,73,.08)}
.log-entry.warn-row{background:rgba(210,153,34,.08)}
.log-timestamp{color:var(--text-muted);margin-right:8px}
.log-level{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;margin-right:8px;text-transform:uppercase}
.log-level.info{background:rgba(88,166,255,.15);color:var(--blue)}
.log-level.error{background:rgba(248,81,73,.15);color:var(--red)}
.log-level.warn{background:rgba(210,153,34,.15);color:var(--yellow)}
.log-msg{color:var(--text)}
.log-data{color:var(--text-muted);margin-left:6px}
</style>
</head>
<body>
<div class="topbar">
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.05 21.785c-1.89 0-3.703-.508-5.284-1.467l-.378-.224-3.915 1.027 1.045-3.813-.246-.391C2.16 15.163 1.498 13.312 1.498 11.39c0-5.048 4.114-9.163 9.163-9.163 2.448 0 4.752.955 6.48 2.682a9.106 9.106 0 012.682 6.48c0 5.048-4.113 9.163-9.162 9.163h-.011zM12.05.165C5.495.165.16 5.5.16 12.055c0 2.094.547 4.14 1.587 5.945L.057 24l6.305-1.654a11.58 11.58 0 005.683 1.489h.005c6.554 0 11.89-5.335 11.89-11.89 0-3.174-1.237-6.16-3.483-8.408A11.815 11.815 0 0012.066.165h-.016z"/></svg>
  <h1>Business Receptionist Monitor</h1>
  <div class="spacer"></div>
  <div class="clock" id="clock"></div>
  <span class="live-dot">Live</span>
</div>
<div class="tabs">
  <div class="tab active" data-tab="health">Health</div>
  <div class="tab" data-tab="messages">Messages<span class="badge" id="unanswered-badge" style="display:none">0</span></div>
  <div class="tab" data-tab="logs">Troubleshooting Log</div>
</div>
<div class="content active" id="tab-health">
  <div class="card-grid">
    <div class="card"><div class="label">Agent Status</div><div class="value" id="h-status">-</div></div>
    <div class="card"><div class="label">Requests Served</div><div class="value" id="h-requests">-</div></div>
    <div class="card"><div class="label">Errors</div><div class="value" id="h-errors">-</div></div>
    <div class="card"><div class="label">Active Sessions</div><div class="value" id="h-active">-</div></div>
    <div class="card"><div class="label">Messages Handled</div><div class="value" id="h-handled">-</div></div>
    <div class="card"><div class="label">Unanswered</div><div class="value" id="h-unanswered">-</div></div>
  </div>
  <div class="section-title">Service Connectivity</div>
  <div class="services">
    <div class="service-item"><span class="status-dot unknown" id="svc-whatsapp"></span>WhatsApp Bridge</div>
    <div class="service-item"><span class="status-dot unknown" id="svc-ollama"></span>Ollama AI</div>
    <div class="service-item"><span class="status-dot unknown" id="svc-calendar"></span>Google Calendar</div>
    <div class="service-item"><span class="status-dot unknown" id="svc-express"></span>Express Server</div>
  </div>
</div>
<div class="content" id="tab-messages">
  <div class="card-grid">
    <div class="card"><div class="label">Sessions</div><div class="value blue" id="m-sessions">-</div></div>
    <div class="card"><div class="label">User Messages</div><div class="value" id="m-user-msgs" style="color:var(--purple)">-</div></div>
    <div class="card"><div class="label">Answered</div><div class="value green" id="m-answered">-</div></div>
    <div class="card"><div class="label">Unanswered</div><div class="value red" id="m-unanswered">-</div></div>
  </div>
  <div class="section-title">Sessions</div>
  <div id="sessions-list"></div>
</div>
<div class="content" id="tab-logs">
  <div class="log-controls">
    <select id="log-level-filter"><option value="all">All Levels</option><option value="info">Info</option><option value="error">Error</option><option value="warn">Warn</option></select>
    <input type="text" id="log-search" placeholder="Search logs...">
    <button id="log-refresh" onclick="fetchLogs()">Refresh</button>
    <button id="log-clear" onclick="clearLogView()">Clear View</button>
    <label><input type="checkbox" id="log-autoscroll" checked> Auto-scroll</label>
  </div>
  <div class="log-box" id="log-box"></div>
</div>
<script>
let sessionsData={};let logEntries=[];let refreshInterval=null;
function updateClock(){const now=new Date();const opts={timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false};document.getElementById('clock').textContent=now.toLocaleTimeString('en-GB',opts)}
setInterval(updateClock,1000);updateClock();
document.querySelectorAll('.tab').forEach(tab=>{tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.content').forEach(c=>c.classList.remove('active'));tab.classList.add('active');document.getElementById('tab-'+tab.dataset.tab).classList.add('active')})});
document.getElementById('sessions-list').addEventListener('click',e=>{const card=e.target.closest('.session-card');if(card)card.classList.toggle('expanded')});
async function fetchJSON(url){try{const r=await fetch(url);return await r.json()}catch{return null}}
async function refreshHealth(){
  const health=await fetchJSON('/api/health');
  const sessions=await fetchJSON('/api/monitor/sessions');
  if(health){
    const s=health.status||'unknown';const el=document.getElementById('h-status');el.textContent=s;el.className='value '+(s==='running'?'green':s==='error'?'red':'yellow');
    document.getElementById('h-requests').textContent=health.requestCount??'-';
    document.getElementById('h-errors').textContent=health.errorCount??'-';
    const errEl=document.getElementById('h-errors');errEl.className='value '+((health.errorCount||0)>0?'red':'green');
  }
  if(sessions){
    const active=sessions.activeSessions??0;const handled=sessions.totalMessages??0;const unanswered=sessions.unansweredCount??0;
    document.getElementById('h-active').textContent=active;document.getElementById('h-active').className='value '+(active>0?'blue':'green');
    document.getElementById('h-handled').textContent=handled;document.getElementById('h-handled').className='value blue';
    document.getElementById('h-unanswered').textContent=unanswered;document.getElementById('h-unanswered').className='value '+(unanswered>0?'red':'green');
  }
  const svcs=[
    {id:'svc-whatsapp',url:'/api/monitor/whatsapp-status',key:'connected'},
    {id:'svc-ollama',url:'/api/monitor/ollama-status',key:'available'},
    {id:'svc-calendar',url:'/api/monitor/calendar-status',key:'available'},
    {id:'svc-express',url:'/api/health',key:'status',val:'running'}
  ];
  for(const svc of svcs){const dot=document.getElementById(svc.id);const data=await fetchJSON(svc.url);if(data){const ok=svc.val?data[svc.key]===svc.val:!!data[svc.key];dot.className='status-dot '+(ok?'ok':'fail')}else{dot.className='status-dot fail'}}
}
async function refreshMessages(){
  const data=await fetchJSON('/api/monitor/sessions');if(!data)return;sessionsData=data.sessions||{};
  const sessions=Object.entries(sessionsData);let totalUser=0,answered=0;
  sessions.forEach(([jid,s])=>{const h=s.history||[];let uc=0,ac=0;h.forEach(e=>{if(e.startsWith('User: '))uc++;else if(e.startsWith('Agent: ')){if(e.substring(7).trim())ac++}});totalUser+=uc;answered+=Math.min(uc,ac)});
  const unanswered=data.unansweredCount||0;
  document.getElementById('m-sessions').textContent=sessions.length;
  document.getElementById('m-user-msgs').textContent=totalUser;
  document.getElementById('m-answered').textContent=answered;
  document.getElementById('m-unanswered').textContent=unanswered;
  const badge=document.getElementById('unanswered-badge');if(unanswered>0){badge.textContent=unanswered;badge.style.display=''}else{badge.style.display='none'}
  const list=document.getElementById('sessions-list');
  const expanded=new Set([...list.querySelectorAll('.session-card.expanded')].map(c=>c.dataset.jid));
  list.innerHTML=sessions.map(([jid,s])=>{const state=s.state||'idle';const h=s.history||[];let uc=0,ac=0;h.forEach(e=>{if(e.startsWith('User: '))uc++;else if(e.startsWith('Agent: ')&&e.substring(7).trim())ac++});const isExp=expanded.has(jid)?' expanded':'';const histHTML=h.map(e=>{if(e.startsWith('User: '))return '<div class="history-item"><span class="history-user">User:</span> '+escHtml(e.substring(6))+'</div>';const at=e.substring(7);if(!at.trim())return '<div class="history-item"><span class="history-agent empty">EMPTY (no reply sent)</span></div>';return '<div class="history-item"><span class="history-agent">Agent:</span> '+escHtml(at)+'</div>'}).join('');return '<div class="session-card'+isExp+'" data-jid="'+escAttr(jid)+'"><div class="session-header"><span class="session-jid">'+escHtml(jid)+'</span><span class="state-badge '+state+'">'+state+'</span><span class="msg-counts">'+uc+'U / '+ac+'A</span></div><div class="session-history">'+histHTML+'</div></div>'}).join('')
}
function escHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function escAttr(s){return s.replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
async function fetchLogs(){const data=await fetchJSON('/api/logs');if(!data)return;logEntries=data;renderLogs()}
function renderLogs(){
  const box=document.getElementById('log-box');const lf=document.getElementById('log-level-filter').value;const q=document.getElementById('log-search').value.toLowerCase();
  const filtered=logEntries.filter(e=>{if(e.raw)return true;if(lf!=='all'&&e.level&&e.level.toLowerCase()!==lf)return false;if(q&&!((e.message||'').toLowerCase().includes(q)||(e.data||'').toLowerCase().includes(q)))return false;return true});
  box.innerHTML=filtered.map(e=>{if(e.raw)return '<div class="log-entry">'+escHtml(e.raw)+'</div>';const lvl=(e.level||'info').toLowerCase();const rc=lvl==='error'?' error-row':lvl==='warn'?' warn-row':'';return '<div class="log-entry'+rc+'"><span class="log-timestamp">'+escHtml(e.timestamp||'')+'</span><span class="log-level '+lvl+'">'+escHtml(e.level||'')+'</span><span class="log-msg">'+escHtml(e.message||'')+'</span>'+(e.data?'<span class="log-data">'+escHtml(e.data)+'</span>':'')+'</div>'}).reverse().join('');
  if(document.getElementById('log-autoscroll').checked)box.scrollTop=0
}
function clearLogView(){document.getElementById('log-box').innerHTML=''}
document.getElementById('log-level-filter').addEventListener('change',renderLogs);
document.getElementById('log-search').addEventListener('input',renderLogs);
async function refreshAll(){await Promise.all([refreshHealth(),refreshMessages(),fetchLogs()])}
refreshAll();refreshInterval=setInterval(refreshAll,5000);
</script>
</body>
</html>`;
fs.writeFileSync(path.join('C:','Imago','Business Receptionist','public','monitor.html'), html);
console.log('Written ' + html.length + ' bytes');
