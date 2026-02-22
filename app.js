/* PPL Tracker - single page app
   Data: window.PPL_PROGRAM
   Storage:
     ppl_settings
     ppl_logs (array)
*/
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const Storage = {
  get(key, fallback){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }catch(e){ return fallback; }
  },
  set(key, value){
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const DEFAULT_SETTINGS = {
  startDate: null,      // YYYY-MM-DD
  units: "kg",
  sound: "on"
};

let settings = Storage.get("ppl_settings", DEFAULT_SETTINGS);
let logs = Storage.get("ppl_logs", []); // {dateISO, phaseIdx, weekIdx, dayName, entries:[...]}
if (!Array.isArray(logs)) logs = [];

function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._to);
  toast._to = setTimeout(()=> t.hidden = true, 2400);
}

// Tabs
$$(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".tab").forEach(b => b.classList.remove("active"));
    $$(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $("#tab-" + btn.dataset.tab).classList.add("active");
    if(btn.dataset.tab === "log") renderLog();
    if(btn.dataset.tab === "prs") renderPRs();
  });
});

// Program selectors
const phaseSelect = $("#phaseSelect");
const weekSelect = $("#weekSelect");
const daySelect = $("#daySelect");

function initSelectors(){
  phaseSelect.innerHTML = "";
  window.PPL_PROGRAM.phases.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = p.phase + " — " + (p.title || "");
    phaseSelect.appendChild(opt);
  });
  phaseSelect.value = "0";
  phaseSelect.addEventListener("change", () => {
    populateWeeks();
    populateDays();
    renderProgram();
  });
  weekSelect.addEventListener("change", () => {
    populateDays();
    renderProgram();
  });
  daySelect.addEventListener("change", renderProgram);
  populateWeeks();
  populateDays();
  renderProgram();
}

function populateWeeks(){
  const p = window.PPL_PROGRAM.phases[Number(phaseSelect.value)];
  weekSelect.innerHTML = "";
  p.weeks.forEach((w, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = w.week;
    weekSelect.appendChild(opt);
  });
  weekSelect.value = "0";
}

function populateDays(){
  const p = window.PPL_PROGRAM.phases[Number(phaseSelect.value)];
  const w = p.weeks[Number(weekSelect.value)];
  daySelect.innerHTML = "";
  w.days.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = d.day;
    daySelect.appendChild(opt);
  });
  daySelect.value = "0";
}

function currentProgramDay(){
  const pIdx = Number(phaseSelect.value);
  const wIdx = Number(weekSelect.value);
  const dIdx = Number(daySelect.value);
  const phase = window.PPL_PROGRAM.phases[pIdx];
  const week = phase.weeks[wIdx];
  const day = week.days[dIdx];
  return {pIdx,wIdx,dIdx,phase,week,day};
}

function fmtMeta(ex){
  const parts = [];
  if (ex.warmup_sets != null) parts.push(`WU: ${ex.warmup_sets}`);
  if (ex.working_sets != null) parts.push(`WS: ${ex.working_sets}`);
  if (ex.reps) parts.push(`Reps: ${ex.reps}`);
  if (ex.rpe != null) parts.push(`RPE: ${ex.rpe}`);
  if (ex.rest) parts.push(`Rest: ${ex.rest}`);
  return parts.join(" • ");
}

function parseRestSeconds(rest){
  if(!rest) return 90;
  const s = String(rest).toLowerCase();
  // "~2-3 min" -> 2 min
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if(m){
    const num = parseFloat(m[1]);
    if(s.includes("sec")) return Math.round(num);
    return Math.round(num * 60);
  }
  return 90;
}

function exerciseCard(ex, context){
  const el = document.createElement("div");
  el.className = "exercise";
  const meta = fmtMeta(ex);
  const sub = [
    meta,
    ex.sub1 ? `Sub 1: ${ex.sub1}` : null,
    ex.sub2 ? `Sub 2: ${ex.sub2}` : null,
    ex.notes ? `Notes: ${ex.notes}` : null
  ].filter(Boolean).join("<br/>");

  const last = getLastEntry(context.dateISO, ex.name);

  el.innerHTML = `
    <div class="exercise-head">
      <div>
        <div class="exercise-title">${escapeHtml(ex.name)}</div>
        <div class="exercise-sub">${sub || ""}</div>
        <div class="tags">
          ${ex.video ? `<span class="tag">📺 Video</span>` : ``}
          ${last ? `<span class="tag">Last: ${escapeHtml(last.summary)}</span>` : ``}
        </div>
      </div>
      <div class="actions">
        ${ex.video ? `<button class="btn ghost" data-action="video">YouTube</button>` : ``}
        <button class="btn ghost" data-action="timer">Rest</button>
      </div>
    </div>

    <hr class="sep"/>

    <div class="kpi">
      <input class="mini" inputmode="numeric" placeholder="Set#" value="1" data-field="setNo"/>
      <input inputmode="decimal" placeholder="Weight (${context.units})" data-field="weight"/>
      <input inputmode="numeric" placeholder="Reps" data-field="repsDone"/>
      <input inputmode="decimal" placeholder="RPE" data-field="rpeDone"/>
      <button class="btn" data-action="saveSet">Save set</button>
      <button class="btn ghost" data-action="finishEx">Finish</button>
    </div>

    <div class="exercise-sub small" data-field="recent"></div>
  `;

  // actions
  el.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const action = btn.dataset.action;
      if(action==="video" && ex.video){
        window.open(ex.video, "_blank");
        return;
      }
      if(action==="timer"){
        openTimer(parseRestSeconds(ex.rest), ex.name);
        return;
      }
      if(action==="saveSet"){
        const setNo = Number(el.querySelector('[data-field="setNo"]').value || "1");
        const weight = parseFloat(el.querySelector('[data-field="weight"]').value || "0");
        const repsDone = Number(el.querySelector('[data-field="repsDone"]').value || "0");
        const rpeDone = parseFloat(el.querySelector('[data-field="rpeDone"]').value || "0");
        if(!repsDone){
          toast("Enter reps to save a set.");
          return;
        }
        addSet(context, ex, {setNo, weight, reps: repsDone, rpe: rpeDone});
        el.querySelector('[data-field="repsDone"]').value = "";
        toast("Saved set ✅");
        renderRecent(el, context.dateISO, ex.name);
        return;
      }
      if(action==="finishEx"){
        markExerciseFinished(context, ex);
        toast("Exercise marked finished ✅");
        renderRecent(el, context.dateISO, ex.name);
        return;
      }
    });
  });

  renderRecent(el, context.dateISO, ex.name);
  return el;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getLog(dateISO, pIdx, wIdx, dayName){
  return logs.find(l => l.dateISO===dateISO && l.phaseIdx===pIdx && l.weekIdx===wIdx && l.dayName===dayName);
}

function ensureLog(dateISO, pIdx, wIdx, dayName){
  let l = getLog(dateISO, pIdx, wIdx, dayName);
  if(!l){
    l = {dateISO, phaseIdx:pIdx, weekIdx:wIdx, dayName, entries:[], completed:false, createdAt: new Date().toISOString()};
    logs.unshift(l);
    Storage.set("ppl_logs", logs);
  }
  return l;
}

function addSet(context, ex, set){
  const l = ensureLog(context.dateISO, context.pIdx, context.wIdx, context.dayName);
  l.entries.push({
    exercise: ex.name,
    video: ex.video || null,
    setNo: set.setNo,
    weight: Number.isFinite(set.weight) ? set.weight : 0,
    reps: set.reps,
    rpe: Number.isFinite(set.rpe) ? set.rpe : null,
    at: new Date().toISOString()
  });
  Storage.set("ppl_logs", logs);
}

function markExerciseFinished(context, ex){
  const l = ensureLog(context.dateISO, context.pIdx, context.wIdx, context.dayName);
  // store a finish marker
  l.entries.push({exercise: ex.name, type:"finish", at:new Date().toISOString()});
  Storage.set("ppl_logs", logs);
}

function getLastEntry(dateISO, exerciseName){
  // show last set from any date (not just dateISO) for that exercise
  for(const l of logs){
    const sets = l.entries.filter(e => e.exercise===exerciseName && !e.type);
    if(sets.length){
      const last = sets[0];
      const best = sets.reduce((a,b)=> (b.at>a.at?b:a), sets[0]);
      const summary = `${best.weight ?? 0}${settings.units} x ${best.reps}`;
      return {summary, date: l.dateISO};
    }
  }
  return null;
}

function renderRecent(cardEl, dateISO, exerciseName){
  // show saved sets today for this exercise
  const recentEl = cardEl.querySelector('[data-field="recent"]');
  const l = logs.find(x => x.dateISO===dateISO && x.entries.some(e=>e.exercise===exerciseName));
  if(!l){
    recentEl.textContent = "No sets logged yet.";
    return;
  }
  const sets = l.entries.filter(e=>e.exercise===exerciseName && !e.type);
  if(!sets.length){
    recentEl.textContent = "No sets logged yet.";
    return;
  }
  const txt = sets
    .sort((a,b)=> (a.setNo-b.setNo))
    .map(s => `Set ${s.setNo}: ${s.weight ?? 0}${settings.units} x ${s.reps}${s.rpe ? ` (RPE ${s.rpe})` : ""}`)
    .join(" • ");
  recentEl.textContent = txt;
}

// Render Program
function renderProgram(){
  const {pIdx,wIdx,phase,week,day} = currentProgramDay();
  const container = $("#programExercises");
  container.innerHTML = "";

  // Rest day message
  if(day.day === "Mandatory Rest Day"){
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `<div class="h1">Mandatory Rest Day</div><div class="muted">Recover, walk, mobility, sleep.</div>`;
    container.appendChild(c);
    return;
  }

  const context = {
    pIdx, wIdx,
    dayName: day.day,
    dateISO: new Date().toISOString().slice(0,10),
    units: settings.units
  };

  const head = document.createElement("div");
  head.className="card";
  head.innerHTML = `<div class="h1">${escapeHtml(phase.phase)} • ${escapeHtml(week.week)} • ${escapeHtml(day.day)}</div>
                    <div class="muted">${escapeHtml(phase.title || "")}</div>`;
  container.appendChild(head);

  day.exercises.forEach(ex => container.appendChild(exerciseCard(ex, context)));
}

// Today workout selection based on startDate and 7-day pattern (6 workouts + rest)
const DAY_PATTERN = ["Push #1","Pull #1","Legs #1","Push #2","Pull #2","Legs #2","Mandatory Rest Day"];

function getTodayPlan(){
  const today = new Date();
  const dateISO = today.toISOString().slice(0,10);

  // Default: use Phase 1 Week 1 day 1 if no start date
  const startISO = settings.startDate || dateISO;
  const start = new Date(startISO + "T00:00:00");
  const diffDays = Math.max(0, Math.floor((today - start) / (24*3600*1000)));
  const patternIdx = diffDays % 7;
  const dayName = DAY_PATTERN[patternIdx];

  // Choose phase/week progression:
  // 6 weeks per phase (as typical), but we will clamp to what's in the provided spreadsheet.
  // Every 7 days = 1 week; weekIdx increments each 7 days.
  const weekNumber = Math.floor(diffDays / 7); // 0-based global week count
  // Map to phases sequentially: Phase1->Phase2->Phase3 based on available weeks
  const phaseWeeks = window.PPL_PROGRAM.phases.map(p => p.weeks.length);
  let remaining = weekNumber;
  let pIdx = 0;
  while(pIdx < phaseWeeks.length - 1 && remaining >= phaseWeeks[pIdx]){
    remaining -= phaseWeeks[pIdx];
    pIdx++;
  }
  const wIdx = Math.min(remaining, window.PPL_PROGRAM.phases[pIdx].weeks.length - 1);

  const phase = window.PPL_PROGRAM.phases[pIdx];
  const week = phase.weeks[wIdx];
  const day = week.days.find(d => d.day === dayName) || week.days[0];

  return {dateISO, pIdx, wIdx, dayName: day.day, phase, week, day};
}

function renderToday(){
  const plan = getTodayPlan();
  $("#todayTitle").textContent = plan.dayName;
  $("#todayMeta").textContent = `${plan.phase.phase} • ${plan.week.week} • ${plan.dateISO}`;
  const container = $("#todayExercises");
  container.innerHTML = "";

  if(plan.dayName === "Mandatory Rest Day"){
    const c = document.createElement("div");
    c.className="card";
    c.innerHTML = `<div class="h1">Rest Day</div><div class="muted">Light walk, mobility, hydration. Log optional.</div>`;
    container.appendChild(c);
    return;
  }

  const context = {pIdx:plan.pIdx,wIdx:plan.wIdx,dayName:plan.dayName,dateISO:plan.dateISO,units:settings.units};
  plan.day.exercises.forEach(ex => container.appendChild(exerciseCard(ex, context)));
}

$("#startWorkoutBtn").addEventListener("click", ()=>{
  const plan = getTodayPlan();
  ensureLog(plan.dateISO, plan.pIdx, plan.wIdx, plan.dayName);
  toast("Workout started ✅");
});
$("#markDoneBtn").addEventListener("click", ()=>{
  const plan = getTodayPlan();
  const l = ensureLog(plan.dateISO, plan.pIdx, plan.wIdx, plan.dayName);
  l.completed = true;
  l.completedAt = new Date().toISOString();
  Storage.set("ppl_logs", logs);
  toast("Marked day done ✅");
});

// Log tab
function renderLog(){
  const list = $("#logList");
  list.innerHTML = "";
  if(!logs.length){
    const c = document.createElement("div");
    c.className="card";
    c.innerHTML = `<div class="muted">No workouts logged yet. Go to Today → Start.</div>`;
    list.appendChild(c);
    return;
  }

  logs.slice(0,60).forEach((l)=>{
    const c = document.createElement("div");
    c.className="card";
    const phase = window.PPL_PROGRAM.phases[l.phaseIdx];
    const week = phase?.weeks?.[l.weekIdx];
    const sets = l.entries.filter(e=>!e.type).length;
    c.innerHTML = `
      <div class="row">
        <div>
          <div class="h2">${escapeHtml(l.dateISO)} • ${escapeHtml(l.dayName)}</div>
          <div class="muted small">${escapeHtml(phase?.phase || "")} • ${escapeHtml(week?.week || "")} • Sets logged: ${sets} ${l.completed ? "• ✅ Done" : ""}</div>
        </div>
        <div class="row">
          <button class="btn ghost" data-act="open">Open</button>
          <button class="btn danger ghost" data-act="delete">Delete</button>
        </div>
      </div>
      <div class="muted small" data-body hidden></div>
    `;
    const body = c.querySelector('[data-body]');
    c.querySelector('[data-act="open"]').addEventListener("click", ()=>{
      body.hidden = !body.hidden;
      if(!body.hidden){
        const grouped = groupByExercise(l.entries.filter(e=>!e.type));
        body.innerHTML = Object.entries(grouped).map(([ex, arr])=>{
          const lines = arr
            .sort((a,b)=>a.setNo-b.setNo)
            .map(s=>`Set ${s.setNo}: ${s.weight ?? 0}${settings.units} x ${s.reps}${s.rpe ? ` (RPE ${s.rpe})` : ""}`)
            .join("<br/>");
          return `<div style="margin-top:10px"><b>${escapeHtml(ex)}</b><br/>${lines}</div>`;
        }).join("") || "No sets";
      }
    });
    c.querySelector('[data-act="delete"]').addEventListener("click", ()=>{
      logs = logs.filter(x => x !== l);
      Storage.set("ppl_logs", logs);
      toast("Deleted log.");
      renderLog();
    });
    list.appendChild(c);
  });
}

function groupByExercise(entries){
  const m = {};
  for(const e of entries){
    if(!m[e.exercise]) m[e.exercise]=[];
    m[e.exercise].push(e);
  }
  return m;
}

$("#clearLogBtn").addEventListener("click", ()=>{
  if(confirm("Clear ALL logs and PRs? This cannot be undone.")){
    logs = [];
    Storage.set("ppl_logs", logs);
    Storage.set("ppl_prs", {});
    toast("Cleared ✅");
    renderLog();
    renderPRs();
  }
});

// PRs
function computePRs(){
  const prs = {};
  for(const l of logs){
    for(const e of l.entries){
      if(e.type) continue;
      const name = e.exercise;
      const key = name;
      const score = (e.weight ?? 0) * 1000 + (e.reps ?? 0); // weight priority, reps tie-break
      if(!prs[key] || score > prs[key].score){
        prs[key] = {
          exercise: name,
          weight: e.weight ?? 0,
          reps: e.reps ?? 0,
          rpe: e.rpe ?? null,
          dateISO: l.dateISO,
          score
        };
      }
    }
  }
  Storage.set("ppl_prs", prs);
  return prs;
}

function renderPRs(){
  const prList = $("#prList");
  prList.innerHTML = "";
  const prs = Storage.get("ppl_prs", {});
  const items = Object.values(prs).sort((a,b)=> (b.score - a.score));
  if(!items.length){
    const c = document.createElement("div");
    c.className="card";
    c.innerHTML = `<div class="muted">No PRs yet. Log some sets first.</div>`;
    prList.appendChild(c);
    return;
  }
  items.forEach(p=>{
    const c = document.createElement("div");
    c.className="card";
    c.innerHTML = `<div class="row">
      <div>
        <div class="h2">${escapeHtml(p.exercise)}</div>
        <div class="muted small">Best: <b>${p.weight}${settings.units} × ${p.reps}</b>${p.rpe ? ` • RPE ${p.rpe}` : ""} • ${p.dateISO}</div>
      </div>
      <button class="btn ghost" data-act="video">Find Video</button>
    </div>`;
    c.querySelector('[data-act="video"]').addEventListener("click", ()=>{
      // try to find a video link from program
      const url = findVideoForExercise(p.exercise);
      if(url) window.open(url, "_blank");
      else toast("No video link found for this exercise in the spreadsheet.");
    });
    prList.appendChild(c);
  });
}

function findVideoForExercise(name){
  for(const ph of window.PPL_PROGRAM.phases){
    for(const wk of ph.weeks){
      for(const d of wk.days){
        for(const ex of d.exercises || []){
          if(ex.name === name && ex.video) return ex.video;
        }
      }
    }
  }
  return null;
}

$("#recalcPrBtn").addEventListener("click", ()=>{
  computePRs();
  toast("PRs recalculated ✅");
  renderPRs();
});

// Settings
function initSettingsUI(){
  $("#startDate").value = settings.startDate || "";
  $("#soundSelect").value = settings.sound || "on";
  $("#unitSelect").value = settings.units || "kg";

  $("#saveSettingsBtn").addEventListener("click", ()=>{
    settings.startDate = $("#startDate").value || null;
    settings.sound = $("#soundSelect").value;
    settings.units = $("#unitSelect").value;
    Storage.set("ppl_settings", settings);
    toast("Saved settings ✅");
    renderToday();
    renderProgram();
    renderLog();
    renderPRs();
  });

  $("#exportBtn").addEventListener("click", ()=>{
    const payload = {
      settings,
      logs,
      prs: Storage.get("ppl_prs", {}),
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ppl_backup.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  $("#importFile").addEventListener("change", async (ev)=>{
    const file = ev.target.files?.[0];
    if(!file) return;
    try{
      const txt = await file.text();
      const payload = JSON.parse(txt);
      if(payload.settings) settings = payload.settings;
      if(Array.isArray(payload.logs)) logs = payload.logs;
      Storage.set("ppl_settings", settings);
      Storage.set("ppl_logs", logs);
      if(payload.prs) Storage.set("ppl_prs", payload.prs);
      toast("Imported ✅");
      initSettingsUI();
      renderToday();
      renderProgram();
      renderLog();
      renderPRs();
    }catch(e){
      toast("Import failed. Make sure it's a valid backup file.");
    }
  });
}

// Rest Timer
let timerState = {total:90, remaining:90, running:false, interval:null};
function openTimer(seconds, label){
  timerState.total = seconds;
  timerState.remaining = seconds;
  timerState.running = false;
  $("#timerLabel").textContent = label ? `For: ${label}` : "";
  $("#timerTime").textContent = fmtTime(timerState.remaining);
  $("#timerStartPause").textContent = "Start";
  $("#timer").hidden = false;
}
function closeTimer(){
  stopTimer();
  $("#timer").hidden = true;
}
function fmtTime(sec){
  const m = Math.floor(sec/60);
  const s = sec%60;
  return String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");
}
function tick(){
  if(!timerState.running) return;
  timerState.remaining = Math.max(0, timerState.remaining - 1);
  $("#timerTime").textContent = fmtTime(timerState.remaining);
  if(timerState.remaining === 0){
    stopTimer();
    $("#timerStartPause").textContent = "Restart";
    if(settings.sound === "on") beep();
    toast("Rest finished ✅");
  }
}
function startTimer(){
  if(timerState.running) return;
  timerState.running = true;
  timerState.interval = setInterval(tick, 1000);
  $("#timerStartPause").textContent = "Pause";
}
function stopTimer(){
  timerState.running = false;
  if(timerState.interval) clearInterval(timerState.interval);
  timerState.interval = null;
}
function toggleTimer(){
  if(timerState.remaining===0){
    timerState.remaining = timerState.total;
  }
  if(timerState.running) { stopTimer(); $("#timerStartPause").textContent="Start"; }
  else { startTimer(); }
}
function adjustTimer(delta){
  timerState.remaining = Math.max(0, timerState.remaining + delta);
  $("#timerTime").textContent = fmtTime(timerState.remaining);
}

$("#timerClose").addEventListener("click", closeTimer);
$("#timerStartPause").addEventListener("click", toggleTimer);
$("#timerMinus").addEventListener("click", ()=>adjustTimer(-10));
$("#timerPlus").addEventListener("click", ()=>adjustTimer(10));

// tiny beep using WebAudio
function beep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(()=>{o.stop(); ctx.close();}, 160);
  }catch(e){}
}

// PWA install prompt
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const btn = $("#installBtn");
  btn.hidden = false;
  btn.addEventListener("click", async ()=>{
    btn.hidden = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  }, {once:true});
});

// Service worker
async function initSW(){
  const status = $("#swStatus");
  if("serviceWorker" in navigator){
    try{
      const reg = await navigator.serviceWorker.register("./service-worker.js");
      status.textContent = "Service worker: active ✅";
      $("#swUpdateBtn").addEventListener("click", async ()=>{
        await reg.update();
        toast("Checked for updates ✅");
      });
    }catch(e){
      status.textContent = "Service worker: failed";
    }
  } else {
    status.textContent = "Service worker: not supported";
  }
}

// Boot
(function init(){
  // If the spreadsheet has Phase 2/3 shorter weeks, show that in subtitle
  const phaseInfo = window.PPL_PROGRAM.phases.map(p => `${p.phase}: ${p.weeks.length} weeks`).join(" • ");
  $("#subtitle").textContent = phaseInfo;

  initSelectors();
  initSettingsUI();
  renderToday();

  // preload PRs once
  if(!Storage.get("ppl_prs", null)){
    computePRs();
  }

  initSW();
})();
