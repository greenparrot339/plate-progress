





/* ============ STATE ============ */
let DB = { splits: [], exercises: [], sets: [], exerciseClassificationOverrides: {}, exerciseDatabase: null };
let state = { tab:'log', logDayId:null, logExerciseId:null, logDate:null, logHistoryDate:null, logHistoryOpen:false, splitEditId:null, splitViewId:null, splitViewMode:'list', splitGalleryDayIndex:0, progressSplitId:null, progressExerciseId:null, progressMetric:'weight', progressMode:'exercise', progressDaySessionDate:null, progressSplitAId:null, progressSplitBId:null, progressSplitSharedKey:null, statsRange:'week', statsSelectedGroup:null, statsExpanded:false, logRenameMode:false };
let DB_META = { lastAutoAssignDate:null };
let charts = {};
const $main = document.getElementById('main');
const $modalRoot = document.getElementById('modal-root');

function uid(p){ return p+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

const STATS_GROUPS = ['chest','back','shoulders','arms','legs','core'];
const STATS_LABELS = {chest:'CHEST',back:'BACK',shoulders:'SHOULDERS',arms:'ARMS',legs:'LEGS',core:'CORE'};
const EXERCISE_ALIAS_REPLACEMENTS = [
  [/\bdb\b/g,'dumbbell'], [/\bdd\b/g,'dumbbell'],
  [/\bbb\b/g,'barbell'], [/\bohp\b/g,'overhead press'],
  [/\brdl\b/g,'romanian deadlift'], [/\brdl\b/g,'romanian deadlift'],
  [/\bcgbp\b/g,'close grip bench press'], [/\bskullcrushers?\b/g,'skull crusher']
];
const EXERCISE_INTELLIGENCE_SCHEMA_VERSION = 1;
let exerciseClassificationIndex = null;

function normalizeExerciseName(name){
  let s = String(name||'').toLowerCase().trim();
  s = s.replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  EXERCISE_ALIAS_REPLACEMENTS.forEach(([re,rep])=>{ s=s.replace(re,rep); });
  return s.replace(/\s+/g,' ').trim();
}
function normalizeStatsGroup(group){
  const normalized = String(group||'').trim().toLowerCase();
  return STATS_GROUPS.includes(normalized) ? normalized : null;
}
function exactExerciseNameKey(name){
  return String(name||'').toLowerCase().trim().replace(/\s+/g,' ');
}
function buildExerciseClassificationIndex(){
  exerciseClassificationIndex = new Map();
  const bundled = (window.PLATE_PROGRESS_EXERCISE_DATABASE && window.PLATE_PROGRESS_EXERCISE_DATABASE.exercises) || [];
  const local = (DB.exerciseDatabase && Array.isArray(DB.exerciseDatabase.exercises)) ? DB.exerciseDatabase.exercises : [];
  // Imported records supplement the bundled catalog; when names overlap, imported
  // records are considered first so a user can carry a corrected/custom database.
  const records = [...local, ...bundled];
  records.forEach(r=>{
    // Catalog and user-entered names must use exactly the same canonical path.
    // `normalized_name` is retained as source metadata, but earlier catalog data
    // contains punctuation/whitespace variants that are not safe lookup keys.
    const key = normalizeExerciseName(r.name);
    if(!key || !normalizeStatsGroup(r.radar_group)) return;
    const recordsForKey = exerciseClassificationIndex.get(key) || [];
    recordsForKey.push(r);
    exerciseClassificationIndex.set(key,recordsForKey);
  });
}
function builtInExerciseRecord(name){
  if(!exerciseClassificationIndex) buildExerciseClassificationIndex();
  const records = exerciseClassificationIndex.get(normalizeExerciseName(name)) || [];
  if(!records.length) return null;
  // A few catalog names collapse to one canonical key (for example, punctuation
  // variants). Preserve exact catalog-name recognition before applying the
  // established Plate & Progress source preference for an ambiguous alias.
  const exact = records.find(r=>exactExerciseNameKey(r.name)===exactExerciseNameKey(name));
  return exact || records.find(r=>(r.sources||[]).includes('plate_progress')) || records[0];
}
// Foundation for future intelligence providers. Current behavior deliberately
// remains exact catalog recognition plus persistent manual classification only.
function resolveExerciseIntelligence(name){
  const key = normalizeExerciseName(name);
  const override = DB.exerciseClassificationOverrides && DB.exerciseClassificationOverrides[key];
  if(override && STATS_GROUPS.includes(override.group)){
    return { group:override.group, source:'manual', recordId:null,
      resolvedAt:override.updatedAt || null,
      schemaVersion:override.schemaVersion || 0 };
  }
  const record = builtInExerciseRecord(name);
  const group = record && normalizeStatsGroup(record.radar_group);
  if(group){
    return { group, source:'database', recordId:record.id || null,
      resolvedAt:null, schemaVersion:EXERCISE_INTELLIGENCE_SCHEMA_VERSION };
  }
  return { group:null, source:'unknown', recordId:null,
    resolvedAt:null, schemaVersion:EXERCISE_INTELLIGENCE_SCHEMA_VERSION };
}
function builtInExerciseClassification(name){
  const record = builtInExerciseRecord(name);
  return record ? normalizeStatsGroup(record.radar_group) : null;
}
function classifyExercise(name){
  return resolveExerciseIntelligence(name).group;
}
function classificationSource(name){
  return resolveExerciseIntelligence(name).source;
}
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtDate(s){ const d=new Date(s+'T00:00:00'); return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function esc(s){ return (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),1800); }

/* ============ LOCAL STORAGE (IndexedDB) ============ */
const DB_NAME = 'plate-progress-db';
const DB_VERSION = 1;
let idb = null;
function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('data')) db.createObjectStore('data');
    };
    req.onsuccess=()=>{ idb=req.result; resolve(idb); };
    req.onerror=()=>reject(req.error);
  });
}
function idbGet(key){
  return new Promise((resolve,reject)=>{
    const req=idb.transaction('data','readonly').objectStore('data').get(key);
    req.onsuccess=()=>resolve(req.result ?? null); req.onerror=()=>reject(req.error);
  });
}
function idbSet(key,value){
  return new Promise((resolve,reject)=>{
    const req=idb.transaction('data','readwrite').objectStore('data').put(value,key);
    req.onsuccess=()=>resolve(true); req.onerror=()=>reject(req.error);
  });
}
async function loadAll(){
  try{
    await openDB();
    const [s,e,st,ov,meta,exdb]=await Promise.all([idbGet('splits'),idbGet('exercises'),idbGet('sets'),idbGet('exerciseClassificationOverrides'),idbGet('appMeta'),idbGet('exerciseDatabase')]);
    DB.splits=s||[]; DB.exercises=e||[]; DB.sets=st||[]; DB.exerciseClassificationOverrides=ov||{}; DB.exerciseDatabase=exdb||null;
    DB_META = meta || { lastAutoAssignDate:null };
    buildExerciseClassificationIndex();
    ensureExerciseOrder();
    if(ensureSplitDayHistory()) await idbSet('splits',DB.splits);
  }catch(err){ console.error('IndexedDB load failed',err); DB={splits:[],exercises:[],sets:[],exerciseClassificationOverrides:{},exerciseDatabase:null}; toast('Could not open local storage'); }
}
// One-time migration: give any exercise missing an `order` a sequential value within its day,
// so existing splits (created before drag-reorder existed) sort predictably.
function ensureExerciseOrder(){
  const nextByDay = {};
  DB.exercises.forEach(ex=>{
    if(typeof ex.order !== 'number'){
      const n = nextByDay[ex.dayId] ?? 0;
      ex.order = n;
      nextByDay[ex.dayId] = n+1;
    } else {
      nextByDay[ex.dayId] = Math.max(nextByDay[ex.dayId] ?? -1, ex.order+1);
    }
  });
}
// Preserve every day ID that has ever belonged to a split. This lets permanent
// split deletion clean up exercises from days that were later removed while editing.
function ensureSplitDayHistory(){
  let changed = false;
  DB.splits.forEach(split=>{
    const current = Array.isArray(split.days) ? split.days.map(d=>d.id) : [];
    const previous = Array.isArray(split.dayIds) ? split.dayIds : [];
    const merged = [...new Set([...previous, ...current])];
    if(merged.length !== previous.length || merged.some((id,i)=>id!==previous[i])){
      split.dayIds = merged;
      changed = true;
    }
  });
  return changed;
}
async function save(key){
  try{ await idbSet(key,DB[key]); }
  catch(err){ console.error('IndexedDB save failed',err); toast('Save failed — try again'); }
}
async function exportBackup(){
  const backup={version:2,app:'Plate & Progress',exportedAt:new Date().toISOString(),data:DB};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='plate-progress-backup-'+todayStr()+'.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Backup exported');
}
function importBackup(){
  const input=document.createElement('input'); input.type='file'; input.accept='.json,application/json';
  input.onchange=async()=>{
    const file=input.files&&input.files[0]; if(!file) return;
    try{
      const parsed=JSON.parse(await file.text());
      if(!parsed.data || !Array.isArray(parsed.data.splits) || !Array.isArray(parsed.data.exercises) || !Array.isArray(parsed.data.sets)) throw new Error('Invalid backup');
      if(!confirm('Import this backup and replace the current local data?')) return;
      DB={splits:parsed.data.splits,exercises:parsed.data.exercises,sets:parsed.data.sets,exerciseClassificationOverrides:parsed.data.exerciseClassificationOverrides||{},exerciseDatabase:parsed.data.exerciseDatabase||null};
      await Promise.all(['splits','exercises','sets','exerciseClassificationOverrides'].map(save));
      await idbSet('exerciseDatabase',DB.exerciseDatabase); render(); toast('Backup imported');
    }catch(err){ console.error(err); toast('Invalid backup file'); }
  }; input.click();
}
async function exportExerciseDatabase(){
  const bundled=(window.PLATE_PROGRESS_EXERCISE_DATABASE && window.PLATE_PROGRESS_EXERCISE_DATABASE.exercises) || [];
  const local=(DB.exerciseDatabase && Array.isArray(DB.exerciseDatabase.exercises)) ? DB.exerciseDatabase.exercises : null;
  const payload={
    version:1,
    app:'Plate & Progress Exercise Database',
    exportedAt:new Date().toISOString(),
    exercises: local || bundled,
    manualClassifications: DB.exerciseClassificationOverrides || {}
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='plate-progress-exercise-database-'+todayStr()+'.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Exercise database exported');
}
function importExerciseDatabase(){
  const input=document.createElement('input'); input.type='file'; input.accept='.json,application/json';
  input.onchange=async()=>{
    const file=input.files&&input.files[0]; if(!file) return;
    try{
      const parsed=JSON.parse(await file.text());
      const exercises=Array.isArray(parsed.exercises) ? parsed.exercises : null;
      if(!exercises || !exercises.length) throw new Error('Invalid exercise database');
      const valid=exercises.filter(r=>r && typeof r.name==='string' && normalizeStatsGroup(r.radar_group));
      if(!valid.length) throw new Error('No supported exercises found');
      if(!confirm(`Import ${valid.length.toLocaleString()} exercises as the local exercise database? This replaces the currently imported local database, but does not change your workout history. The built-in database remains available as a fallback.`)) return;
      DB.exerciseDatabase={version:1,importedAt:new Date().toISOString(),sourceName:file.name,exercises:valid};
      if(parsed.manualClassifications && typeof parsed.manualClassifications==='object'){
        DB.exerciseClassificationOverrides={...DB.exerciseClassificationOverrides,...parsed.manualClassifications};
        await save('exerciseClassificationOverrides');
      }
      buildExerciseClassificationIndex();
      await idbSet('exerciseDatabase',DB.exerciseDatabase);
      render();
      toast(`Exercise database imported (${valid.length.toLocaleString()})`);
    }catch(err){ console.error(err); toast('Invalid exercise database file'); }
  }; input.click();
}
function registerPWA(){
  if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js').catch(console.error);
}

/* ============ QUERIES ============ */
function activeSplit(){ return DB.splits.find(s=>!s.archivedAt); }
function splitById(id){ return DB.splits.find(s=>s.id===id); }
function daysOf(split){ return split ? split.days : []; }
function exercisesOfDay(dayId){ return DB.exercises.filter(e=>e.dayId===dayId && !e.archived).sort((a,b)=>(a.order||0)-(b.order||0)); }
function allExercisesOfDay(dayId){ return DB.exercises.filter(e=>e.dayId===dayId).sort((a,b)=>(a.order||0)-(b.order||0)); }
function setsOfExercise(exId){ return DB.sets.filter(s=>s.exerciseId===exId).sort((a,b)=> a.date===b.date ? a.setNumber-b.setNumber : (a.date<b.date?-1:1) ); }
function exerciseById(id){ return DB.exercises.find(e=>e.id===id); }
function dayById(dayId){ for(const sp of DB.splits){ const d=(sp.days||[]).find(x=>x.id===dayId); if(d) return d; } return null; }
async function saveMeta(){ try{ await idbSet('appMeta', DB_META); }catch(err){ console.error('meta save failed',err); } }

/* ============ LOGGED SESSIONS (real logged workouts, not split templates) ============ */
// A "session" here means the actual logged data for a calendar date — grouping every
// set that was logged on that date, regardless of which exercises/day they belong to.
// This is intentionally distinct from a scheduled split-day template.
let _sessionsCache = null, _sessionsCacheKey = null;
function allLoggedSessions(){
  const cacheKey = DB.sets.length + ':' + (DB.sets.length ? DB.sets[DB.sets.length-1].id : '') + ':' + DB.exercises.length;
  if(_sessionsCache && _sessionsCacheKey===cacheKey) return _sessionsCache;
  const byDate = {};
  DB.sets.forEach(s=>{ (byDate[s.date]=byDate[s.date]||[]).push(s); });
  const sessions = Object.keys(byDate).sort().map(date=>{
    const daySets = byDate[date];
    const dayCounts = {};
    daySets.forEach(s=>{ const ex=exerciseById(s.exerciseId); if(ex) dayCounts[ex.dayId]=(dayCounts[ex.dayId]||0)+1; });
    const dayId = Object.keys(dayCounts).sort((a,b)=>dayCounts[b]-dayCounts[a])[0] || null;
    const day = dayId ? dayById(dayId) : null;
    const exIds = [...new Set(daySets.map(s=>s.exerciseId))];
    const exercises = exIds.map(id=>exerciseById(id)).filter(Boolean);
    const volume = daySets.reduce((a,s)=>a+s.weight*s.reps,0);
    return { date, dayId, dayName: day ? day.name : 'Session', exercises, sets:daySets.slice().sort((a,b)=>a.setNumber-b.setNumber || (a.exerciseId<b.exerciseId?-1:1)), volume, setCount:daySets.length, repCount:daySets.reduce((a,s)=>a+s.reps,0) };
  });
  _sessionsCache = sessions; _sessionsCacheKey = cacheKey;
  return sessions;
}
function sessionsForDay(dayId){ return allLoggedSessions().filter(s=>s.dayId===dayId); }
function sessionByDate(date){ return allLoggedSessions().find(s=>s.date===date) || null; }

// History for the currently selected Log day must be scoped to that exact day.
// A calendar date can contain more than one split day, so we intentionally
// group only sets belonging to the requested day instead of using the
// date-level session grouping above. This keeps Upper 1 history separate from
// Lower 1 history even when both were logged on the same date.
let _dayHistoryCache = new Map();
function historySessionsForDay(dayId){
  if(!dayId) return [];
  const cacheKey = dayId + '|' + DB.sets.length + '|' + DB.exercises.length;
  const cached = _dayHistoryCache.get(dayId);
  if(cached && cached.key===cacheKey) return cached.sessions;

  const byDate = {};
  DB.sets.forEach(s=>{
    const ex = exerciseById(s.exerciseId);
    if(!ex || ex.dayId!==dayId) return;
    (byDate[s.date]=byDate[s.date]||[]).push(s);
  });

  const day = dayById(dayId);
  const sessions = Object.keys(byDate).sort().map(date=>{
    const daySets = byDate[date];
    const exIds = [...new Set(daySets.map(s=>s.exerciseId))];
    const exercises = exIds.map(id=>exerciseById(id)).filter(Boolean);
    const volume = daySets.reduce((a,s)=>a+s.weight*s.reps,0);
    return {
      date, dayId, dayName: day ? day.name : 'Session', exercises,
      sets: daySets.slice().sort((a,b)=>a.setNumber-b.setNumber || (a.exerciseId<b.exerciseId?-1:1)),
      volume, setCount:daySets.length, repCount:daySets.reduce((a,s)=>a+s.reps,0)
    };
  });
  _dayHistoryCache.set(dayId, {key:cacheKey, sessions});
  return sessions;
}

/* ============ SMART NEXT-SESSION DEFAULT ============ */
// Runs once per calendar date (guarded by DB_META.lastAutoAssignDate) at app start.
// It only sets a sensible *default* day for today's Log view — it never touches
// logged history, never forces the date away from today, and any manual day
// selection the user makes afterward is respected for the rest of the day
// (this function won't run again until the next new calendar date).
async function applySmartLogDefault(){
  const today = todayStr();
  if(DB_META.lastAutoAssignDate === today) return; // already applied today
  DB_META.lastAutoAssignDate = today;
  await saveMeta();

  const split = activeSplit();
  if(!split || !split.days || !split.days.length) return;

  state.logDate = today;

  const orderedDayIds = split.days.map(d=>d.id);
  const sessions = allLoggedSessions().filter(s=> orderedDayIds.includes(s.dayId) && s.date <= today);
  if(!sessions.length) return; // no history yet — leave default (first day)

  const mostRecent = sessions[sessions.length-1]; // dates sorted ascending
  if(mostRecent.date === today){
    // Already logged something today — keep showing that day, don't jump ahead.
    state.logDayId = mostRecent.dayId;
    return;
  }
  // Nothing logged today yet: default to the day that follows the most recently
  // logged day in the split's ordered day list (wrapping around).
  const idx = orderedDayIds.indexOf(mostRecent.dayId);
  if(idx === -1) return;
  const nextDayId = orderedDayIds[(idx+1) % orderedDayIds.length];
  state.logDayId = nextDayId;
}

/* ============ RENDER ROOT ============ */
function setHeader(eyebrow, title, actionSvg, actionFn){
  document.getElementById('hdr-eyebrow').textContent = eyebrow;
  document.getElementById('hdr-title').textContent = title;
  const btn = document.getElementById('hdr-action');
  if(actionFn){ btn.style.display='flex'; btn.innerHTML = actionSvg; btn.onclick = actionFn; }
  else { btn.style.display='none'; }
}

const TAB_ORDER = ['log','split','progress','stats'];
function render(){
  document.querySelectorAll('.navbtn').forEach(b=> b.classList.toggle('active', b.dataset.tab===state.tab));
  const activeDot = TAB_ORDER.indexOf(state.tab);
  document.querySelectorAll('.plate-rule .dot').forEach(d=> d.classList.toggle('hot', +d.dataset.dot===activeDot));
  if(state.tab==='log') renderLog();
  else if(state.tab==='split') renderSplit();
  else if(state.tab==='progress') renderProgress();
  else if(state.tab==='stats') renderStats();
  // Keep the maximized Gallery overlay (lives outside #main) in sync with any
  // data-changing action anywhere in the app, since those all funnel through render().
  if(typeof galleryMaximizeOpen!=='undefined' && galleryMaximizeOpen) refreshGalleryMaximizeOverlay();
}

/* ============ TAB SWITCHING + SWIPE TRANSITION ============ */
// goToTab is the single entry point for changing tabs (nav taps and swipes both use it),
// so every tab change gets the same sliding "page turn" style transition, direction-aware:
// moving right through the tab order slides content out to the left / in from the right,
// and vice versa moving left.
let tabSwitching = false;
function goToTab(newTab){
  if(newTab===state.tab || tabSwitching) return;
  if(galleryMaximizeOpen) closeGalleryMaximize(); // never leave Split with the overlay still open
  const oldIdx = TAB_ORDER.indexOf(state.tab);
  const newIdx = TAB_ORDER.indexOf(newTab);
  const forward = newIdx > oldIdx;
  if(state.tab==='stats') destroyStats3D();
  if(state.tab==='progress') destroyCharts();
  tabSwitching = true;
  $main.classList.add(forward ? 'main-exit-left' : 'main-exit-right');
  setTimeout(()=>{
    state.tab = newTab;
    render();
    $main.classList.remove('main-exit-left','main-exit-right');
    $main.classList.add(forward ? 'main-enter-from-right' : 'main-enter-from-left');
    requestAnimationFrame(()=> requestAnimationFrame(()=>{
      $main.classList.remove('main-enter-from-right','main-enter-from-left');
      tabSwitching = false;
    }));
  }, 170);
}

document.querySelectorAll('.navbtn').forEach(b=>{
  b.addEventListener('click', ()=> goToTab(b.dataset.tab));
});

/* ============ SWIPE BETWEEN TABS ============ */
// Horizontal swipe anywhere in the app moves between Log <-> Split <-> Progress <-> Stats,
// in the same left-to-right order as the bottom nav and header dots.
(function initSwipeTabs(){
  const MIN_DX = 60;            // minimum horizontal distance to count as a swipe
  const MAX_OFF_AXIS_RATIO = 0.6; // vertical drift must stay well below the horizontal distance
  const MAX_DURATION_MS = 700;
  let sx=0, sy=0, st=0, tracking=false;

  document.addEventListener('touchstart', e=>{
    if(e.touches.length!==1) return;
    if($modalRoot.innerHTML.trim()!=='') return; // a modal is open, don't hijack its gestures
    if(galleryMaximizeOpen) return; // maximized Gallery overlay owns all gestures while open
    const t = e.target;
    // Protect controls and horizontally-scrollable areas. Exercise rows themselves
    // remain swipeable; vertical movement is handed back to scrolling/drag-reorder.
    // The Gallery card track owns its own horizontal drag (day swipe) — never let the
    // tab-swipe gesture compete with it.
    if(t.closest('.day-scroll') || t.closest('.chart-wrap') || t.closest('.segmented') ||
       t.closest('select') || t.closest('input') || t.closest('button') || t.closest('.stats3d-wrap') ||
       t.closest('.split-gallery-track') || t.closest('#gallery-max-overlay')) return;
    const touch = e.touches[0];
    sx=touch.clientX; sy=touch.clientY; st=Date.now(); tracking=true;
  }, {passive:true});

  document.addEventListener('touchmove', e=>{
    if(!tracking || e.touches.length!==1) return;
    const touch=e.touches[0];
    const dx=touch.clientX-sx, dy=touch.clientY-sy;
    // Once movement is clearly vertical, stop tracking so normal page scroll or
    // long-press exercise reordering can proceed without interference.
    if(Math.abs(dy)>10 && Math.abs(dy)>Math.abs(dx)*0.75) tracking=false;
  }, {passive:true});

  document.addEventListener('touchend', e=>{
    if(!tracking) return;
    tracking=false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - sx;
    const dy = touch.clientY - sy;
    const dt = Date.now() - st;
    if(dt > MAX_DURATION_MS) return;
    if(Math.abs(dx) < MIN_DX) return;
    if(Math.abs(dy) > Math.abs(dx) * MAX_OFF_AXIS_RATIO) return;

    const idx = TAB_ORDER.indexOf(state.tab);
    if(dx < 0 && idx < TAB_ORDER.length-1) goToTab(TAB_ORDER[idx+1]); // swiped left -> next tab
    else if(dx > 0 && idx > 0) goToTab(TAB_ORDER[idx-1]);              // swiped right -> previous tab
  }, {passive:true});

  document.addEventListener('touchcancel', ()=>{ tracking=false; }, {passive:true});
})();

/* ============ ONBOARDING ============ */
function renderOnboarding(){
  setHeader('Plate & Progress','Welcome',null,null);
  $main.innerHTML = `
    <div class="empty" style="margin-top:20px;">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8" stroke-linecap="round"/></svg>
      <h2 style="font-size:16px;margin-bottom:8px;">Set up your split</h2>
      <p>Name your routine and add the days you train — like Push, Pull, Legs — before logging any sets.</p>
      <button class="btn btn-accent btn-block" id="ob-start">Create your split</button>
    </div>`;
  document.getElementById('ob-start').onclick = ()=> openSplitModal(null);
}

/* ============ SPLIT MODAL (create/rename) ============ */
function openSplitModal(existingSplit){
  const isNew = !existingSplit;
  const days = isNew ? [{id:uid('day'),name:'Day 1'}] : existingSplit.days.map(d=>({...d}));
  let html = `
    <div class="modal-sheet">
      <div class="modal-close-row"><button class="icon-btn" id="m-close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button></div>
      <h2>${isNew ? 'New split' : 'Rename split'}</h2>
      <div class="field">
        <label class="field-label">Split name</label>
        <input type="text" id="m-splitname" placeholder="e.g. Upper Lower" value="${esc(isNew?'':existingSplit.name)}">
      </div>
      <div class="field">
        <label class="field-label">Training days</label>
        <div id="m-days"></div>
        <button class="btn btn-ghost btn-sm" id="m-addday" style="margin-top:6px;">+ Add day</button>
      </div>
      <button class="btn btn-accent btn-block" id="m-save">${isNew ? 'Create split' : 'Save changes'}</button>
      ${isNew && activeSplit() ? '<p style="font-size:11.5px;color:var(--text-faint);text-align:center;margin-top:10px;">Your current split and its history stay saved — this starts a fresh one.</p>' : ''}
    </div>`;
  $modalRoot.innerHTML = `<div class="modal-overlay" id="m-overlay">${html}</div>`;

  function renderDays(){
    document.getElementById('m-days').innerHTML = days.map((d,i)=>`
      <div class="field-grid" style="grid-template-columns:1fr auto;margin-bottom:8px;align-items:center;">
        <input type="text" data-i="${i}" class="m-day-input" value="${esc(d.name)}" placeholder="Day name">
        ${days.length>1 ? `<button class="icon-btn m-day-del" data-i="${i}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button>` : '<span></span>'}
      </div>`).join('');
    document.querySelectorAll('.m-day-input').forEach(inp=> inp.oninput = e=> days[+e.target.dataset.i].name = e.target.value);
    document.querySelectorAll('.m-day-del').forEach(btn=> btn.onclick = e=>{ days.splice(+e.currentTarget.dataset.i,1); renderDays(); });
  }
  renderDays();
  document.getElementById('m-addday').onclick = ()=>{ days.push({id:uid('day'),name:'Day '+(days.length+1)}); renderDays(); };
  document.getElementById('m-close').onclick = closeModal;
  document.getElementById('m-overlay').onclick = e=>{ if(e.target.id==='m-overlay') closeModal(); };

  document.getElementById('m-save').onclick = async ()=>{
    const name = document.getElementById('m-splitname').value.trim();
    if(!name){ toast('Give your split a name'); return; }
    const cleanDays = days.filter(d=>d.name.trim()).map(d=>({id:d.id,name:d.name.trim()}));
    if(cleanDays.length===0){ toast('Add at least one day'); return; }

    if(isNew){
      const prev = activeSplit();
      if(prev) prev.archivedAt = new Date().toISOString();
      DB.splits.push({ id:uid('split'), name, days:cleanDays, dayIds:cleanDays.map(d=>d.id), createdAt:new Date().toISOString(), archivedAt:null });
      await save('splits');
      if(prev) toast('New split started — old one saved in Archive');
      else toast('Split created');
    } else {
      existingSplit.name = name;
      const oldDayIds = new Set(existingSplit.days.map(d=>d.id));
      const historicalDayIds = new Set(existingSplit.dayIds || []);
      const newDayIds = new Set(cleanDays.map(d=>d.id));
      // exercises on removed days get archived (history kept), not deleted
      oldDayIds.forEach(id=>{ if(!newDayIds.has(id)) DB.exercises.forEach(ex=>{ if(ex.dayId===id) ex.archived=true; }); });
      existingSplit.days = cleanDays;
      existingSplit.dayIds = [...new Set([...historicalDayIds, ...oldDayIds, ...newDayIds])];
      await save('splits');
      await save('exercises');
      toast('Split updated');
    }
    closeModal();
    render();
  };
}

function closeModal(){ $modalRoot.innerHTML=''; }

// Rename a training day directly from the Log tab. The day name lives on the split's
// day record, so changing it here updates every view that reads that day (including
// Split and any future references) while preserving the same day ID and all history.
function openDayRenameModal(splitId, dayId){
  const split = splitById(splitId);
  const day = split && split.days.find(d=>d.id===dayId);
  if(!split || !day) return;

  const html = `
    <div class="modal-sheet">
      <div class="modal-close-row"><button class="icon-btn" id="m-close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button></div>
      <h2 style="font-size:16px;margin-bottom:16px;">Rename day</h2>
      <div class="field">
        <label class="field-label">Day name</label>
        <input type="text" id="m-dayname" placeholder="e.g. Push, Pull, Legs" value="${esc(day.name)}" maxlength="40">
      </div>
      <button class="btn btn-accent btn-block" id="m-save">Save name</button>
    </div>`;

  $modalRoot.innerHTML = `<div class="modal-overlay" id="m-overlay">${html}</div>`;
  const input = document.getElementById('m-dayname');
  const close = ()=>closeModal();
  document.getElementById('m-close').onclick = close;
  document.getElementById('m-overlay').onclick = e=>{ if(e.target.id==='m-overlay') close(); };
  document.getElementById('m-save').onclick = async ()=>{
    const name = input.value.trim();
    if(!name){ toast('Give the day a name'); input.focus(); return; }
    day.name = name;
    await save('splits');
    closeModal();
    render();
    toast('Day renamed');
  };
  requestAnimationFrame(()=>{ input.focus(); input.select(); });
}

// Swap which split is "active" (the one Log tab logs against). The split being promoted
// keeps its own createdAt/history; the previously-active split is archived, not deleted.
async function switchToSplit(splitId){
  const target = splitById(splitId);
  if(!target || !target.archivedAt) return;
  const current = activeSplit();
  if(current) current.archivedAt = new Date().toISOString();
  target.archivedAt = null;
  await save('splits');
  state.logDayId = null; // let Log tab re-pick a valid day for the newly active split
  toast(`Switched to "${target.name}"`);
  render();
}

/* ============ EXERCISE MODAL ============ */

function openMuscleClassificationModal(exerciseName, onSelect){
  $modalRoot.innerHTML = `
    <div class="modal-overlay" id="m-overlay">
      <div class="modal-sheet">
        <div class="modal-close-row"><button class="icon-btn" id="m-close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button></div>
        <h2>Muscle group not recognized</h2>
        <p style="font-size:13px;color:var(--text-dim);line-height:1.5;margin:8px 0 14px;">
          <strong style="color:var(--text);">${esc(exerciseName)}</strong> isn't classified in the local exercise database. Select its primary muscle group.
        </p>
        <div class="field-grid" style="grid-template-columns:1fr 1fr;">
          ${STATS_GROUPS.map(g=>`<button class="btn btn-ghost btn-block" data-pick-group="${g}">${STATS_LABELS[g]}</button>`).join('')}
        </div>
      </div>
    </div>`;
  document.getElementById('m-close').onclick=closeModal;
  document.getElementById('m-overlay').onclick=e=>{ if(e.target.id==='m-overlay') closeModal(); };
  document.querySelectorAll('[data-pick-group]').forEach(b=> b.onclick=async()=>{
    const group=b.dataset.pickGroup;
    await onSelect(group);
    closeModal();
  });
}
async function saveExerciseClassification(name, group){
  const key=normalizeExerciseName(name);
  if(!key || !STATS_GROUPS.includes(group)) return;
  // Legacy `{group, updatedAt}` overrides remain readable; new writes add
  // version/source metadata without changing the override key or behavior.
  DB.exerciseClassificationOverrides[key]={group,source:'manual',schemaVersion:EXERCISE_INTELLIGENCE_SCHEMA_VERSION,updatedAt:new Date().toISOString()};
  await save('exerciseClassificationOverrides');
}

/* ============ EXERCISE RENAME (long-press name in Log tab) ============ */
// Renames an exercise in place. The exercise ID never changes, so every set,
// PB, Progressive Overload record, and Progress/Stats calculation that keys
// off the exercise ID stays connected automatically. Classification lives in
// DB.exerciseClassificationOverrides keyed by *normalized name*, so if the
// exercise had a manual classification under its old name, that override is
// copied forward under the new name — the muscle group is not lost on rename.
async function renameExercise(ex, newName){
  const clean = newName.trim();
  if(!clean || clean===ex.name) return false;
  const oldName = ex.name;
  const oldGroup = classifyExercise(oldName);
  const oldSource = classificationSource(oldName);
  ex.name = clean;
  if(oldSource==='manual' && oldGroup){
    // carry the manual override forward to the new name's key
    await saveExerciseClassification(clean, oldGroup);
  }
  ex.classified = classificationSource(clean) !== 'unknown';
  await save('exercises');
  return true;
}
function openRenameExerciseModal(exerciseId){
  const ex = exerciseById(exerciseId);
  if(!ex) return;
  const html = `
    <div class="modal-sheet">
      <div class="modal-close-row"><button class="icon-btn" id="m-close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button></div>
      <h2 style="font-size:16px;margin-bottom:16px;">Edit exercise</h2>
      <div class="field">
        <label class="field-label">Exercise name</label>
        <input type="text" id="m-exrename" value="${esc(ex.name)}" maxlength="60">
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost btn-block" id="m-cancel">Cancel</button>
        <button class="btn btn-accent btn-block" id="m-save">Save</button>
      </div>
      <p style="font-size:11px;color:var(--text-faint);margin-top:12px;line-height:1.5;">All logged sets, personal bests and Progress history stay linked to this exercise.</p>
    </div>`;
  $modalRoot.innerHTML = `<div class="modal-overlay" id="m-overlay">${html}</div>`;
  const input = document.getElementById('m-exrename');
  const close = ()=>closeModal();
  document.getElementById('m-close').onclick = close;
  document.getElementById('m-cancel').onclick = close;
  document.getElementById('m-overlay').onclick = e=>{ if(e.target.id==='m-overlay') close(); };
  document.getElementById('m-save').onclick = async ()=>{
    const name = input.value.trim();
    if(!name){ toast('Name the exercise'); input.focus(); return; }
    const changed = await renameExercise(ex, name);
    closeModal();
    render();
    toast(changed ? 'Exercise renamed' : 'No changes made');
  };
  requestAnimationFrame(()=>{ input.focus(); input.select(); });
}

function openExerciseModal(splitId, dayId){
  $modalRoot.innerHTML = `
    <div class="modal-overlay" id="m-overlay">
      <div class="modal-sheet">
        <div class="modal-close-row"><button class="icon-btn" id="m-close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button></div>
        <h2>Add exercise</h2>
        <div class="field">
          <label class="field-label">Exercise name</label>
          <input type="text" id="m-exname" placeholder="e.g. Barbell bench press">
        </div>
        <button class="btn btn-accent btn-block" id="m-save">Add exercise</button>
      </div>
    </div>`;
  document.getElementById('m-close').onclick = closeModal;
  document.getElementById('m-overlay').onclick = e=>{ if(e.target.id==='m-overlay') closeModal(); };
  const inp = document.getElementById('m-exname');
  setTimeout(()=>inp.focus(),50);
  document.getElementById('m-save').onclick = async ()=>{
    const name = inp.value.trim();
    if(!name){ toast('Name the exercise'); return; }
    const knownGroup = classifyExercise(name);
    // The exercise is always created here, immediately — never gated behind the
    // muscle-classification step. That step (below) is a best-effort follow-up:
    // if the user closes it without picking a group, the exercise is already
    // saved and simply stays "Unclassified" until they classify it later
    // (from the Split tab's classify affordance).
    const dayExs = allExercisesOfDay(dayId);
    const nextOrder = dayExs.length ? Math.max(...dayExs.map(e=>e.order||0))+1 : 0;
    const newEx = { id:uid('ex'), splitId, dayId, name, archived:false, classified:!!knownGroup, order:nextOrder, createdAt:new Date().toISOString() };
    DB.exercises.push(newEx);
    await save('exercises');
    closeModal();
    render();
    toast('Exercise added');
    if(!knownGroup){
      // Offer classification as an optional follow-up. Closing this dialog
      // (X or overlay tap) does NOT remove or affect the exercise in any way.
      openMuscleClassificationModal(name, async group=>{
        await saveExerciseClassification(name, group);
        newEx.classified = true;
        await save('exercises');
        render();
        toast('Muscle group saved');
      });
    }
  };
}

// Permanently deletes an archived split, along with the exercises and logged sets that
// belong to it. Only meant to be reachable for archived splits — the active one can't be
// deleted directly, since it's always either the one you're logging against or gets
// archived automatically when you start/switch to a different split.
function confirmDeleteSplit(split){
  // Use the exercise's splitId as the primary relationship. The dayId fallback
  // also covers older records that may predate splitId being stored reliably.
  const dayIds = new Set([...(split.dayIds || []), ...(split.days || []).map(d=>d.id)]);
  const exIds = new Set(DB.exercises
    .filter(e=>e.splitId===split.id || dayIds.has(e.dayId))
    .map(e=>e.id));
  const setCount = DB.sets.filter(s=>exIds.has(s.exerciseId)).length;
  $modalRoot.innerHTML = `
    <div class="modal-overlay" id="m-overlay">
      <div class="modal-sheet">
        <div class="modal-close-row"><button class="icon-btn" id="m-close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button></div>
        <h2>Delete ${esc(split.name)}?</h2>
        <p style="font-size:13.5px;color:var(--text-dim);line-height:1.5;margin-bottom:16px;">
          This permanently deletes this split along with its ${exIds.size} exercise${exIds.size===1?'':'s'} and ${setCount} logged set${setCount===1?'':'s'}. This can't be undone.
        </p>
        <button class="btn btn-danger btn-block" id="m-confirm">Delete split</button>
      </div>
    </div>`;
  document.getElementById('m-close').onclick = closeModal;
  document.getElementById('m-overlay').onclick = e=>{ if(e.target.id==='m-overlay') closeModal(); };
  document.getElementById('m-confirm').onclick = async ()=>{
    DB.exercises = DB.exercises.filter(e=>!exIds.has(e.id));
    DB.sets = DB.sets.filter(s=>!exIds.has(s.exerciseId));
    DB.splits = DB.splits.filter(s=>s.id!==split.id);
    await Promise.all(['splits','exercises','sets'].map(save));
    if(state.splitViewId===split.id) state.splitViewId = null;
    if(state.progressSplitId===split.id) state.progressSplitId = null;
    closeModal(); render(); toast('Split deleted');
  };
}


function confirmRemoveExercise(ex){
  const hasSets = DB.sets.some(s=>s.exerciseId===ex.id);
  $modalRoot.innerHTML = `
    <div class="modal-overlay" id="m-overlay">
      <div class="modal-sheet">
        <div class="modal-close-row"><button class="icon-btn" id="m-close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button></div>
        <h2>Remove ${esc(ex.name)}?</h2>
        <p style="font-size:13.5px;color:var(--text-dim);line-height:1.5;margin-bottom:16px;">
          ${hasSets ? "It'll be hidden from logging but its history stays visible under Progress." : "It has no logged sets yet, so it'll be deleted."}
        </p>
        <button class="btn btn-danger btn-block" id="m-confirm">${hasSets ? 'Archive exercise' : 'Delete exercise'}</button>
      </div>
    </div>`;
  document.getElementById('m-close').onclick = closeModal;
  document.getElementById('m-overlay').onclick = e=>{ if(e.target.id==='m-overlay') closeModal(); };
  document.getElementById('m-confirm').onclick = async ()=>{
    if(hasSets){ ex.archived = true; }
    else { DB.exercises = DB.exercises.filter(e=>e.id!==ex.id); }
    await save('exercises');
    closeModal(); render(); toast(hasSets?'Exercise archived':'Exercise deleted');
  };
}

/* ============ SHARED: render a single day's card (used by List AND Gallery) ============
   One function, one markup source — List and Gallery are two presentations of the exact
   same day/exercise data. `opts.scrollable` switches on the fixed-window flex/scroll
   wrapper used only in Gallery; List mode renders identically to before. */
function renderDayCard(day, animateClass='', opts={}){
  const exs = exercisesOfDay(day.id);
  const listHtml = exs.length===0 ? `<p style="font-size:12.5px;color:var(--text-faint);padding:6px 0;">No exercises yet.</p>` :
    `<div class="exercise-list" data-daylist="${day.id}">` +
    exs.map(ex=>{
      const sets = setsOfExercise(ex.id);
      const last = sets[sets.length-1];
      return `<div class="exercise-row" data-exid="${ex.id}">
        <div class="grip" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="exname">
          <div class="name">${esc(ex.name)}</div>
          <div class="meta">${sets.length} set${sets.length===1?'':'s'} logged${last? ' &middot; last '+fmtDate(last.date):''}</div>
          <button class="classification-btn" data-classifyex="${ex.id}">${classifyExercise(ex.name) ? STATS_LABELS[classifyExercise(ex.name)] + (classificationSource(ex.name)==='manual' ? ' · custom' : '') : 'Classify muscle group'}</button>
        </div>
        <button class="icon-btn" data-delex="${ex.id}"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>`;
    }).join('') +
    `</div>`;
  const header = `<div class="row-between" style="margin-bottom:8px;">
    <h3 style="font-size:14px;">${esc(day.name)}</h3>
    <button class="btn btn-ghost btn-sm" data-addex="${day.id}">+ Exercise</button>
  </div>`;
  if(opts.scrollable){
    return `<div class="card split-day-card gallery-card-flex ${animateClass}" data-gallery-day="${day.id}">
      ${header}
      <div class="gallery-scroll">${listHtml}</div>
    </div>`;
  }
  return `<div class="card split-day-card ${animateClass}" data-gallery-day="${day.id}">
    ${header}
    ${listHtml}
  </div>`;
}

// Binds Add/Archive/Classify handlers for every exercise card action found under `root`.
// Used for the List/Gallery region inside $main AND for the maximized overlay (which lives
// outside $main), so there is exactly one implementation of these actions everywhere.
function bindExerciseCardActions(root, splitId){
  root.querySelectorAll('[data-addex]').forEach(b=> b.onclick = ()=> openExerciseModal(splitId, b.dataset.addex));
  root.querySelectorAll('[data-delex]').forEach(b=> b.onclick = ()=> confirmRemoveExercise(exerciseById(b.dataset.delex)));
  root.querySelectorAll('[data-classifyex]').forEach(b=> b.onclick = e=>{
    e.stopPropagation();
    const ex=exerciseById(b.dataset.classifyex);
    if(ex) openMuscleClassificationModal(ex.name, async group=>{
      await saveExerciseClassification(ex.name, group);
      render();
      toast('Muscle group updated');
    });
  });
}

// Builds the fixed-window card-stack markup (viewport + track + nav + hint). Used both for
// the normal in-page Gallery and for the maximized overlay — same function, same day data,
// just a different idPrefix so the two DOM trees never collide.
function buildGalleryHtml(split, idPrefix, opts={}){
  const days = split.days||[];
  const dayIndex = state.splitGalleryDayIndex;
  const day = days[dayIndex];
  const prevDay = dayIndex>0 ? days[dayIndex-1] : null;
  const nextDay = dayIndex<days.length-1 ? days[dayIndex+1] : null;
  const maximized = !!opts.maximized;
  return `<div class="split-gallery-viewport">
    <div class="split-gallery-shell">
      <div class="split-gallery-track" id="${idPrefix}-track">
        ${prevDay ? renderDayCard(prevDay,'is-stack-prev',{scrollable:true}) : ''}
        ${nextDay ? renderDayCard(nextDay,'is-stack-next',{scrollable:true}) : ''}
        ${day ? renderDayCard(day,'',{scrollable:true}) : ''}
      </div>
      ${!maximized ? `<button class="split-gallery-maxbtn" id="${idPrefix}-maxbtn" aria-label="Maximize gallery" title="Maximize"><svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ''}
      <div class="gallery-progress-pill" id="${idPrefix}-progress"></div>
      ${maximized && days.length>1 ? `
        <div class="fold-handle fold-tr" id="${idPrefix}-fold-tr" aria-label="Fold corner to go to next day"></div>
        <div class="fold-handle fold-tl" id="${idPrefix}-fold-tl" aria-label="Fold corner to go to previous day"></div>
        <div class="fold-flap fold-flap-tr" id="${idPrefix}-flap-tr"></div>
        <div class="fold-flap fold-flap-tl" id="${idPrefix}-flap-tl"></div>` : ''}
    </div>
  </div>
  <div class="split-gallery-nav">
    <button class="split-gallery-arrow ${dayIndex===0?'at-edge':''}" id="${idPrefix}-prev" aria-label="Previous day${dayIndex===0?' — start reached':''}" ${dayIndex===0?'disabled':''}>
      <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="split-gallery-position" aria-label="Day position">
      ${days.map((_,i)=>`<span class="split-gallery-dot ${i===dayIndex?'active':''}"></span>`).join('')}
    </div>
    <button class="split-gallery-arrow ${dayIndex===days.length-1?'at-edge':''}" id="${idPrefix}-next" aria-label="Next day${dayIndex===days.length-1?' — end reached':''}" ${dayIndex===days.length-1?'disabled':''}>
      <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
  ${days.length>1 ? `<p class="split-gallery-hint">${maximized ? 'Swipe, use the arrows, or fold a corner to change day' : 'Swipe left or right to view another day'}</p>` : ''}`;
}

// Wires up everything interactive for one Gallery instance: exercise reorder (reusing the
// exact List-mode reorder system), arrow buttons, drag-to-swipe card physics, and — in
// maximized mode — the paper-fold corner gesture and keyboard arrows. idPrefix scopes all
// DOM lookups so the same logic can run for the in-page Gallery and the maximized overlay
// without the two ever touching each other's elements.
function bindGallery(split, idPrefix, opts={}){
  const days = split.days||[];
  const track = document.getElementById(idPrefix+'-track');
  if(!track) return;
  const maximized = !!opts.maximized;
  const activeDayId = days[state.splitGalleryDayIndex]?.id||'';
  const activeCard = track.querySelector('.split-day-card[data-gallery-day="'+activeDayId+'"]');
  if(activeCard){
    const activeList = activeCard.querySelector('.exercise-list[data-daylist]');
    if(activeList) attachExerciseReorder(activeList, activeList.dataset.daylist);
  }

  let galleryTransitioning=false;
  const showProgressPill=(text)=>{
    const pill=document.getElementById(idPrefix+'-progress');
    if(!pill) return;
    if(text){ pill.textContent=text; pill.classList.add('show'); } else pill.classList.remove('show');
  };
  const setStackReveal=(amount)=>{
    const abs=Math.min(1,Math.abs(amount)/110);
    const revealScale=.97 + (.03*abs), revealY=12*(1-abs), revealOpacity=.62 + (.38*abs);
    track.querySelectorAll('.split-day-card.is-stack-next,.split-day-card.is-stack-prev').forEach(card=>{
      card.style.transform=`translate3d(0,${revealY}px,0) scale(${revealScale})`; card.style.opacity=String(revealOpacity);
    });
  };
  const resetStack=()=>track.querySelectorAll('.split-day-card.is-stack-next,.split-day-card.is-stack-prev').forEach(card=>{card.style.removeProperty('transform');card.style.removeProperty('opacity');card.classList.remove('stack-reveal');});
  const animateToDay=(nextIndex,direction)=>{
    if(galleryTransitioning || nextIndex<0 || nextIndex>=days.length || nextIndex===state.splitGalleryDayIndex) return false;
    const current=track.querySelector('.split-day-card[data-gallery-day="'+days[state.splitGalleryDayIndex].id+'"]');
    const incoming=track.querySelector('.split-day-card[data-gallery-day="'+days[nextIndex].id+'"]');
    if(!current || !incoming){ state.splitGalleryDayIndex=nextIndex; render(); return true; }
    galleryTransitioning=true; const sign=direction==='next'?-1:1;
    current.classList.add('gallery-fly'); incoming.classList.add('stack-reveal','gallery-promote');
    incoming.style.transform='translate3d(0,0,0) scale(1)'; incoming.style.opacity='1';
    current.style.transform=`translate3d(${sign*118}%,0,0) rotate(${sign*4}deg)`; current.style.opacity='.05';
    if(navigator.vibrate) navigator.vibrate(8);
    setTimeout(()=>{ state.splitGalleryDayIndex=nextIndex; render(); },300);
    return true;
  };

  const prevBtn=document.getElementById(idPrefix+'-prev'), nextBtn=document.getElementById(idPrefix+'-next');
  const flashEdge=(direction)=>{
    const btn=direction==='next'?nextBtn:prevBtn;
    if(!btn) return;
    btn.classList.add('at-edge','edge-flash');
    const label=direction==='next'?'End of days':'Start of days';
    showProgressPill(label);
    clearTimeout(btn._edgeTimer);
    btn._edgeTimer=setTimeout(()=>{btn.classList.remove('edge-flash');showProgressPill(null);},650);
  };
  if(prevBtn) prevBtn.onclick=()=>{ const target=state.splitGalleryDayIndex-1; if(target<0){flashEdge('prev');return;} animateToDay(target,'prev'); };
  if(nextBtn) nextBtn.onclick=()=>{ const target=state.splitGalleryDayIndex+1; if(target>=days.length){flashEdge('next');return;} animateToDay(target,'next'); };
  const maxBtn=document.getElementById(idPrefix+'-maxbtn');
  if(maxBtn) maxBtn.onclick=()=>openGalleryMaximize(split.id);

  if(track && days.length>1 && activeCard){
    let pointerId=null,startX=0,startY=0,dragging=false,axisLocked=false,swipeStarted=false; const threshold=72;
    const isInteractive=e=>!!e.target.closest('button,select,input,a,.fold-handle');

    // Pointer gestures keep mouse/desktop Gallery working. Touch is handled separately
    // below because mobile browsers can otherwise hand the gesture to the nested scroller
    // before the card's pointer stream becomes reliable.
    track.addEventListener('pointerdown',e=>{
      if(e.pointerType==='touch') return;
      if(isInteractive(e)) return; if(e.pointerType==='mouse'&&e.button!==0)return;
      pointerId=e.pointerId;startX=e.clientX;startY=e.clientY;dragging=true;axisLocked=false;swipeStarted=false;activeCard.classList.add('gallery-dragging');track.setPointerCapture?.(pointerId);
    });
    track.addEventListener('pointermove',e=>{
      if(!dragging||e.pointerId!==pointerId||galleryTransitioning)return; const dx=e.clientX-startX,dy=e.clientY-startY;
      if(!axisLocked){if(Math.abs(dx)<8&&Math.abs(dy)<8)return;if(Math.abs(dy)>Math.abs(dx)){dragging=false;activeCard.classList.remove('gallery-dragging');track.releasePointerCapture?.(pointerId);return;}axisLocked=true;}
      swipeStarted=true;const limited=Math.max(-150,Math.min(150,dx));activeCard.style.transform=`translate3d(${limited}px,0,0) rotate(${limited/42}deg)`;activeCard.style.opacity=String(1-Math.min(.5,Math.abs(limited)/300));setStackReveal(limited);
      const target=limited<0?state.splitGalleryDayIndex+1:state.splitGalleryDayIndex-1;
      showProgressPill(Math.abs(limited)>=threshold && target>=0 && target<days.length ? (limited<0?'Release for next day':'Release for previous day') : null);
    });
    const finishPointer=(e,cancelled=false)=>{
      if(!dragging||e.pointerId!==pointerId)return;dragging=false;track.releasePointerCapture?.(pointerId);activeCard.classList.remove('gallery-dragging');
      const dx=e.clientX-startX,dy=e.clientY-startY,target=dx<0?state.splitGalleryDayIndex+1:state.splitGalleryDayIndex-1;
      showProgressPill(null);
      if(!cancelled&&swipeStarted&&Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>=threshold){
        if(target>=0&&target<days.length){animateToDay(target,dx<0?'next':'prev');return;}
        flashEdge(dx<0?'next':'prev');
      }
      activeCard.classList.add('gallery-snap');activeCard.style.transform='translate3d(0,0,0) rotate(0deg)';activeCard.style.opacity='1';setStackReveal(0);
      setTimeout(()=>{activeCard.classList.remove('gallery-snap');resetStack();},300);
    };
    track.addEventListener('pointerup',e=>finishPointer(e,false));track.addEventListener('pointercancel',e=>finishPointer(e,true));

    // Dedicated mobile touch swipe. The gesture locks to horizontal movement only after
    // the user clearly moves sideways, so normal vertical scrolling inside the Gallery
    // remains intact. Once locked horizontally, preventDefault keeps the browser from
    // treating the gesture as page navigation/overscroll.
    let touchStartX=0,touchStartY=0,touchLastX=0,touchLastY=0,touchDragging=false,touchAxisLocked=false,touchSwipeStarted=false;
    track.addEventListener('touchstart',e=>{
      if(galleryTransitioning || isInteractive(e)) return;
      const t=e.touches[0]; if(!t) return;
      touchStartX=t.clientX; touchStartY=t.clientY; touchLastX=t.clientX; touchLastY=t.clientY; touchDragging=true; touchAxisLocked=false; touchSwipeStarted=false;
      activeCard.classList.add('gallery-dragging');
    },{passive:true});
    track.addEventListener('touchmove',e=>{
      if(!touchDragging||galleryTransitioning) return;
      const t=e.touches[0]; if(!t) return;
      touchLastX=t.clientX; touchLastY=t.clientY; const dx=t.clientX-touchStartX,dy=t.clientY-touchStartY;
      if(!touchAxisLocked){
        if(Math.abs(dx)<8&&Math.abs(dy)<8) return;
        if(Math.abs(dy)>Math.abs(dx)){
          touchDragging=false; activeCard.classList.remove('gallery-dragging');
          return;
        }
        touchAxisLocked=true;
      }
      touchSwipeStarted=true;
      e.preventDefault();
      const limited=Math.max(-150,Math.min(150,dx));
      activeCard.style.transform=`translate3d(${limited}px,0,0) rotate(${limited/42}deg)`;
      activeCard.style.opacity=String(1-Math.min(.5,Math.abs(limited)/300));
      setStackReveal(limited);
      const target=limited<0?state.splitGalleryDayIndex+1:state.splitGalleryDayIndex-1;
      showProgressPill(Math.abs(limited)>=threshold && target>=0 && target<days.length ? (limited<0?'Release for next day':'Release for previous day') : null);
    },{passive:false});
    const finishTouch=(cancelled=false)=>{
      if(!touchDragging) return;
      touchDragging=false; activeCard.classList.remove('gallery-dragging');
      const dx=touchLastX-touchStartX;
      const dy=touchLastY-touchStartY;
      const target=dx<0?state.splitGalleryDayIndex+1:state.splitGalleryDayIndex-1;
      showProgressPill(null);
      if(!cancelled&&touchSwipeStarted&&Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>=threshold){
        if(target>=0&&target<days.length){ animateToDay(target,dx<0?'next':'prev'); return; }
        flashEdge(dx<0?'next':'prev');
      }
      activeCard.classList.add('gallery-snap'); activeCard.style.transform='translate3d(0,0,0) rotate(0deg)'; activeCard.style.opacity='1'; setStackReveal(0);
      setTimeout(()=>{activeCard.classList.remove('gallery-snap');resetStack();},300);
    };
    track.addEventListener('touchend',()=>finishTouch(false),{passive:true});
    track.addEventListener('touchcancel',()=>finishTouch(true),{passive:true});
  }

  // Paper-fold corners — maximized mode only. Starts strictly on the small corner
  // handle element, so it never competes with the horizontal swipe-the-whole-card
  // gesture or the long-press exercise-reorder gesture above.
  if(maximized && activeCard && days.length>1){
    bindFoldCorner(idPrefix,'tr','next',track,activeCard,days,animateToDay,showProgressPill);
    bindFoldCorner(idPrefix,'tl','prev',track,activeCard,days,animateToDay,showProgressPill);
  }

  if(maximized){
    if(_galleryKeyHandler) document.removeEventListener('keydown', _galleryKeyHandler);
    _galleryKeyHandler = e=>{
      if(e.key==='ArrowLeft') animateToDay(state.splitGalleryDayIndex-1,'prev');
      else if(e.key==='ArrowRight') animateToDay(state.splitGalleryDayIndex+1,'next');
      else if(e.key==='Escape') closeGalleryMaximize();
    };
    document.addEventListener('keydown', _galleryKeyHandler);
  }
}

// One corner's fold-to-turn-the-page gesture. Dragging the small corner handle peels a
// triangular "flap" back and tilts the card in 3D; crossing ~42% of the card's shortest
// dimension commits to changing the day (the card finishes rotating away, then the next
// day becomes front); releasing before that snaps the flap back flat with no day change.
function bindFoldCorner(idPrefix,corner,direction,track,activeCard,days,animateToDay,showProgressPill){
  const handle = document.getElementById(idPrefix+'-fold-'+corner);
  const flap = document.getElementById(idPrefix+'-flap-'+corner);
  if(!handle || !flap) return;
  let dragging=false, pointerId=null, maxDiag=140, triggered=false;
  const canGo = ()=> direction==='next' ? state.splitGalleryDayIndex<days.length-1 : state.splitGalleryDayIndex>0;
  const reset=(animated)=>{
    flap.style.transition = animated ? 'width .2s ease,height .2s ease,opacity .2s ease' : '';
    flap.style.width='0'; flap.style.height='0'; flap.style.opacity='0'; flap.style.clipPath='';
    activeCard.style.transition = animated ? 'transform .2s ease' : '';
    activeCard.style.transform=''; activeCard.style.opacity='1';
    showProgressPill(null);
    if(animated) setTimeout(()=>{ flap.style.transition=''; activeCard.style.transition=''; },200);
  };
  handle.onpointerdown = e=>{
    if(!canGo()){ if(navigator.vibrate) navigator.vibrate(6); return; }
    const rect = activeCard.getBoundingClientRect();
    maxDiag = Math.max(80, Math.min(rect.width, rect.height));
    dragging=true; triggered=false; pointerId=e.pointerId;
    handle.setPointerCapture?.(pointerId);
    activeCard.classList.add('gallery-dragging');
  };
  handle.onpointermove = e=>{
    if(!dragging || e.pointerId!==pointerId) return;
    const rect = activeCard.getBoundingClientRect();
    const cx = corner==='tr' ? rect.right : rect.left, cy = rect.top;
    const dx = e.clientX-cx, dy = e.clientY-cy;
    const diag = Math.max(0, Math.min(maxDiag*0.75, Math.hypot(dx,dy)));
    const pct = diag/maxDiag;
    flap.style.width = diag+'px'; flap.style.height = diag+'px'; flap.style.opacity = String(Math.min(.95, pct*2));
    flap.style.clipPath = corner==='tr'
      ? `polygon(100% 0, ${Math.max(0,100-pct*100)}% 0, 100% ${Math.min(100,pct*100)}%)`
      : `polygon(0 0, ${Math.min(100,pct*100)}% 0, 0 ${Math.min(100,pct*100)}%)`;
    activeCard.style.transform = corner==='tr' ? `perspective(900px) rotateY(${-pct*11}deg)` : `perspective(900px) rotateY(${pct*11}deg)`;
    triggered = pct>0.42;
    showProgressPill(triggered ? (direction==='next'?'Release for next day':'Release for previous day') : null);
  };
  const finish = ()=>{
    if(!dragging) return; dragging=false;
    activeCard.classList.remove('gallery-dragging');
    if(triggered){
      const targetIndex = direction==='next' ? state.splitGalleryDayIndex+1 : state.splitGalleryDayIndex-1;
      flap.style.transition='width .22s ease,height .22s ease,opacity .22s ease';
      flap.style.width='100%'; flap.style.height='100%'; flap.style.opacity='1';
      activeCard.style.transition='transform .24s ease, opacity .24s ease';
      activeCard.style.transform = corner==='tr' ? 'perspective(900px) rotateY(-85deg)' : 'perspective(900px) rotateY(85deg)';
      activeCard.style.opacity='.12';
      showProgressPill(null);
      if(navigator.vibrate) navigator.vibrate(14);
      setTimeout(()=>{
        const clamped = Math.max(0, Math.min(days.length-1, targetIndex));
        flap.style.transition=''; flap.style.width='0'; flap.style.height='0'; flap.style.opacity='0'; flap.style.clipPath='';
        activeCard.style.transition=''; activeCard.style.transform=''; activeCard.style.opacity='1';
        if(clamped!==state.splitGalleryDayIndex){ state.splitGalleryDayIndex=clamped; render(); }
      },240);
    } else {
      reset(true);
    }
  };
  handle.onpointerup = finish;
  handle.onpointercancel = finish;
}

/* ============ MAXIMIZED GALLERY OVERLAY ============ */
let galleryMaximizeOpen = false;
let _galleryKeyHandler = null;
function openGalleryMaximize(splitId){
  if(galleryMaximizeOpen) return;
  const split = splitById(splitId); if(!split) return;
  galleryMaximizeOpen = true;
  const overlay = document.createElement('div');
  overlay.id = 'gallery-max-overlay';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  renderGalleryMaximizeContent(split);
}
function renderGalleryMaximizeContent(split){
  const overlay = document.getElementById('gallery-max-overlay');
  if(!overlay) return;
  overlay.innerHTML = `
    <div class="gmax-header">
      <span class="gmax-title">${esc(split.name)} &middot; Gallery</span>
      <button class="gmax-close" id="gmax-close" aria-label="Close maximized gallery"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button>
    </div>
    <div class="gmax-body">${buildGalleryHtml(split, 'gmax', {maximized:true})}</div>`;
  document.getElementById('gmax-close').onclick = closeGalleryMaximize;
  bindExerciseCardActions(overlay, split.id);
  bindGallery(split, 'gmax', {maximized:true});
}
// Called from the root render() dispatcher so ANY data-changing action anywhere in the app
// (add/archive/classify/reorder/rename, all of which already call the global render()) keeps
// the maximized overlay in sync automatically — no separate Gallery-only refresh path needed.
function refreshGalleryMaximizeOverlay(){
  if(!galleryMaximizeOpen) return;
  const split = splitById(state.splitViewId) || activeSplit() || DB.splits[0];
  if(!split){ closeGalleryMaximize(); return; }
  renderGalleryMaximizeContent(split);
}
function closeGalleryMaximize(){
  if(!galleryMaximizeOpen) return;
  galleryMaximizeOpen = false;
  const overlay = document.getElementById('gallery-max-overlay');
  if(overlay) overlay.remove();
  document.body.style.overflow = '';
  if(_galleryKeyHandler){ document.removeEventListener('keydown', _galleryKeyHandler); _galleryKeyHandler=null; }
}

/* ============ TAB: SPLIT ============ */
function renderSplit(){
  if(!DB.splits.length){ setHeader('Your routine','No split yet',null,null); renderOnboarding(); return; }
  if(!state.splitViewId || !DB.splits.some(s=>s.id===state.splitViewId)) state.splitViewId = (activeSplit()||DB.splits[0]).id;
  const split = splitById(state.splitViewId);
  if(!state.splitViewMode) state.splitViewMode = 'list';
  if(!Number.isInteger(state.splitGalleryDayIndex)) state.splitGalleryDayIndex = 0;
  state.splitGalleryDayIndex = Math.max(0, Math.min(state.splitGalleryDayIndex, Math.max(0, (split.days||[]).length-1)));

  setHeader('Your routine', split.name,
    '<svg viewBox="0 0 24 24"><path d="M4 21v-3.5L16.5 5a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L7.5 21.5H4z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ()=>openSplitModal(split)
  );

  const allSplits = DB.splits.slice().sort((a,b)=> b.createdAt.localeCompare(a.createdAt));
  const listIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>`;
  const galleryIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.3"/><path d="m4.5 17 4.5-4.5 3.2 3.2 2.2-2.2 5.1 5.1"/></svg>`;
  const currentViewIcon = state.splitViewMode==='gallery' ? galleryIcon : listIcon;
  const viewMenu = `<div class="split-view-picker" id="split-view-picker">
      <button class="split-view-trigger" id="split-view-trigger" aria-label="Change split view" aria-haspopup="menu" aria-expanded="false">${currentViewIcon}</button>
      <div class="split-view-menu" id="split-view-menu" role="menu">
        <button class="split-view-option ${state.splitViewMode==='list'?'active':''}" data-view-mode="list" role="menuitem">${listIcon}<span>List</span>${state.splitViewMode==='list'?'<span style="margin-left:auto">✓</span>':''}</button>
        <button class="split-view-option ${state.splitViewMode==='gallery'?'active':''}" data-view-mode="gallery" role="menuitem">${galleryIcon}<span>Gallery</span>${state.splitViewMode==='gallery'?'<span style="margin-left:auto">✓</span>':''}</button>
      </div>
    </div>`;
  let html = `<div class="split-switch-bar">
    <span class="ldb-label">Viewing</span>
    <select id="split-switcher">
      ${allSplits.map(s=>`<option value="${s.id}" ${s.id===split.id?'selected':''}>${esc(s.name)}${s.archivedAt?' (archived)':' (active)'}</option>`).join('')}
    </select>
    ${split.archivedAt
      ? `<button class="log-date-today" id="btn-setactive">Make active</button>`
      : `<span class="split-active-tag">&bull; active</span>`}
    ${viewMenu}
  </div>`;

  if(state.splitViewMode==='gallery'){
    html += buildGalleryHtml(split, 'split-gallery', {maximized:false});
  }else{
    split.days.forEach(day=>{ html += renderDayCard(day,'',{scrollable:false}); });
  }

  html += `<button class="btn btn-block" id="btn-newsplit" style="margin-top:6px;">Start a new split</button>
    <p style="font-size:11px;color:var(--text-faint);text-align:center;margin:8px 0 18px;">This archives your current split and its history, then starts fresh.</p>
    <div class="card" style="margin-top:4px;">
      <div class="card-title">Local backup</div>
      <p style="font-size:12px;color:var(--text-faint);line-height:1.45;margin:0 0 10px;">Your workout data is stored on this device. Export a backup before clearing browser data or changing phones.</p>
      <div class="field-grid"><button class="btn" id="btn-export">Export backup</button><button class="btn" id="btn-import">Import backup</button></div>
      <p style="font-size:12px;color:var(--text-faint);line-height:1.45;margin:12px 0 10px;">Move the exercise database separately between devices. This does not replace your workout backup.</p>
      <div class="field-grid"><button class="btn" id="btn-export-exdb">Export exercise database</button><button class="btn" id="btn-import-exdb">Import exercise database</button></div>
    </div>`;

  const archived = DB.splits.filter(s=>s.archivedAt).sort((a,b)=> b.archivedAt.localeCompare(a.archivedAt));
  if(archived.length){
    html += `<div class="card"><div class="card-title">Archive</div>`;
    archived.forEach(s=>{
      html += `<div class="archive-item">
        <div class="row-between">
          <div>
            <div class="name">${esc(s.name)}</div>
            <div class="dates">${fmtDate(s.createdAt.slice(0,10))} &rarr; ${fmtDate(s.archivedAt.slice(0,10))}</div>
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-sm" data-viewarchive="${s.id}">View progress</button>
            <button class="icon-btn" data-delsplit="${s.id}" style="color:var(--rust);"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          </div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  $main.innerHTML = html;
  const renameModeBtn=document.createElement('button');
  renameModeBtn.className='btn btn-ghost btn-sm'; renameModeBtn.textContent=state.logRenameMode?'✕ Edit mode':'✎ Rename'; renameModeBtn.style.margin='0 0 10px auto';
  renameModeBtn.onclick=()=>{state.logRenameMode=!state.logRenameMode;render();};
  $main.prepend(renameModeBtn);

  bindExerciseCardActions(document, split.id);
  const nsBtn = document.getElementById('btn-newsplit');
  if(nsBtn) nsBtn.onclick = ()=> openSplitModal(null);
  const exportBtn=document.getElementById('btn-export'); if(exportBtn) exportBtn.onclick=exportBackup;
  const importBtn=document.getElementById('btn-import'); if(importBtn) importBtn.onclick=importBackup;
  const exportExDbBtn=document.getElementById('btn-export-exdb'); if(exportExDbBtn) exportExDbBtn.onclick=exportExerciseDatabase;
  const importExDbBtn=document.getElementById('btn-import-exdb'); if(importExDbBtn) importExDbBtn.onclick=importExerciseDatabase;
  document.querySelectorAll('[data-viewarchive]').forEach(b=> b.onclick = ()=>{
    state.tab='progress'; state.progressSplitId=b.dataset.viewarchive; state.progressExerciseId=null; render();
  });
  document.querySelectorAll('[data-delsplit]').forEach(b=> b.onclick = (e)=>{
    e.stopPropagation();
    confirmDeleteSplit(splitById(b.dataset.delsplit));
  });
  const switcher = document.getElementById('split-switcher');
  if(switcher) switcher.onchange = e=>{ state.splitViewId = e.target.value; state.splitGalleryDayIndex=0; render(); };
  const setActiveBtn = document.getElementById('btn-setactive');
  if(setActiveBtn) setActiveBtn.onclick = ()=> switchToSplit(split.id);
  const viewPicker=document.getElementById('split-view-picker');
  const viewTrigger=document.getElementById('split-view-trigger');
  const viewMenuEl=document.getElementById('split-view-menu');
  const closeViewMenu=()=>{
    if(!viewMenuEl || !viewTrigger) return;
    viewMenuEl.classList.remove('open'); viewTrigger.setAttribute('aria-expanded','false');
  };
  if(viewTrigger && viewMenuEl){
    viewTrigger.onclick=e=>{
      e.stopPropagation();
      const open=!viewMenuEl.classList.contains('open');
      viewMenuEl.classList.toggle('open',open); viewTrigger.setAttribute('aria-expanded',String(open));
    };
    viewMenuEl.querySelectorAll('[data-view-mode]').forEach(option=>option.onclick=()=>{
      state.splitViewMode=option.dataset.viewMode==='gallery'?'gallery':'list';
      if(state.splitViewMode==='gallery') state.splitGalleryDayIndex=0;
      closeViewMenu(); render();
    });
    document.addEventListener('click',e=>{ if(viewPicker && !viewPicker.contains(e.target)) closeViewMenu(); },{once:true});
    document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeViewMenu(); },{once:true});
  }

  if(state.splitViewMode==='list'){
    document.querySelectorAll('.exercise-list[data-daylist]').forEach(list=> attachExerciseReorder(list, list.dataset.daylist));
  }else{
    bindGallery(split, 'split-gallery', {maximized:false});
  }
}

/* ============ LONG-PRESS REORDER (Split tab exercise lists) ============ */
const LONG_PRESS_MS = 420;
const MOVE_CANCEL_PX = 10;

function attachExerciseReorder(listEl, dayId){
  let pressTimer = null;
  let startX = 0, startY = 0;
  let drag = null; // active drag state, or null

  listEl.querySelectorAll('.exercise-row[data-exid]').forEach(row=>{
    row.addEventListener('touchstart', onTouchStart, {passive:true});
    row.addEventListener('mousedown', onMouseDown); // desktop testing convenience

    function onTouchStart(e){
      if(e.touches.length!==1 || e.target.closest('button')) return;
      const t = e.touches[0];
      armPress(row, t.clientX, t.clientY);
      row.addEventListener('touchmove', watchForCancel, {passive:true});
      row.addEventListener('touchend', disarm, {once:true});
      row.addEventListener('touchcancel', disarm, {once:true});
    }
    function onMouseDown(e){
      if(e.button!==0 || e.target.closest('button')) return;
      armPress(row, e.clientX, e.clientY);
      document.addEventListener('mousemove', watchForCancel);
      document.addEventListener('mouseup', disarm, {once:true});
    }
    function watchForCancel(e){
      if(drag) return;
      const p = e.touches ? e.touches[0] : e;
      if(Math.abs(p.clientX-startX) > MOVE_CANCEL_PX || Math.abs(p.clientY-startY) > MOVE_CANCEL_PX) disarm();
    }
    function disarm(){
      clearTimeout(pressTimer);
      row.classList.remove('press-armed');
      row.removeEventListener('touchmove', watchForCancel);
      document.removeEventListener('mousemove', watchForCancel);
    }
    function armPress(row, x, y){
      startX = x; startY = y;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(()=>{ row.classList.add('press-armed'); beginDrag(row, x, y); }, LONG_PRESS_MS);
    }
  });

  function beginDrag(row, clientX, clientY){
    const rows = Array.from(listEl.querySelectorAll('.exercise-row[data-exid]'));
    const rects = rows.map(r=>r.getBoundingClientRect());
    const index = rows.indexOf(row);
    drag = { row, rows, rects, index, currentIndex:index, startY:clientY };

    if(navigator.vibrate) navigator.vibrate(12);
    row.classList.remove('press-armed');
    row.classList.add('dragging');
    row.style.willChange = 'transform';
    rows.forEach(r=>{ if(r!==row) r.style.transition = 'transform 150ms ease'; });

    document.addEventListener('touchmove', onDragMove, {passive:false});
    document.addEventListener('touchend', endDrag, {once:true});
    document.addEventListener('touchcancel', endDrag, {once:true});
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', endDrag, {once:true});
  }

  function onDragMove(e){
    if(!drag) return;
    if(e.cancelable) e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    const deltaY = p.clientY - drag.startY;
    drag.row.style.transform = `translateY(${deltaY}px)`;

    const dRect = drag.rects[drag.index];
    const draggedCenter = dRect.top + dRect.height/2 + deltaY;

    let newIndex = drag.index;
    for(let i=drag.index+1;i<drag.rows.length;i++){
      const r = drag.rects[i];
      if(draggedCenter > r.top + r.height/2) newIndex = i;
    }
    for(let i=drag.index-1;i>=0;i--){
      const r = drag.rects[i];
      if(draggedCenter < r.top + r.height/2) newIndex = i;
    }

    if(newIndex !== drag.currentIndex){
      drag.currentIndex = newIndex;
      drag.rows.forEach((r,i)=>{
        if(i===drag.index) return;
        let shift = 0;
        if(i>drag.index && i<=newIndex) shift = -dRect.height;
        else if(i<drag.index && i>=newIndex) shift = dRect.height;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    }
  }

  async function endDrag(){
    if(!drag) return;
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('mousemove', onDragMove);

    const { rows, index, currentIndex, row } = drag;
    rows.forEach(r=>{ r.style.transition=''; r.style.transform=''; r.style.willChange=''; });
    row.classList.remove('dragging');
    drag = null;

    if(currentIndex !== index){
      const orderedIds = rows.map(r=>r.dataset.exid);
      const [movedId] = orderedIds.splice(index, 1);
      orderedIds.splice(currentIndex, 0, movedId);
      orderedIds.forEach((id, i)=>{ const ex = exerciseById(id); if(ex) ex.order = i; });
      await save('exercises');
      if(navigator.vibrate) navigator.vibrate(8);
      toast('Order updated');
    }
    render();
  }
}

/* ============ TAB: LOG ============ */
function renderLog(){
  const split = activeSplit();
  if(!state.logDate) state.logDate = todayStr();
  const isToday = state.logDate === todayStr();
  setHeader(isToday ? 'Today' : 'Logging for', fmtDate(state.logDate), null, null);
  if(!split){ renderOnboarding(); return; }

  if(!state.logDayId || !split.days.some(d=>d.id===state.logDayId)) state.logDayId = split.days[0].id;
  const exs = exercisesOfDay(state.logDayId);

  let html = `<div class="day-scroll">` +
    split.days.map(d=>`<button class="day-chip ${d.id===state.logDayId?'active':''}" data-day="${d.id}">${esc(d.name)}</button>`).join('') +
    `</div>`;

  html += `<div class="log-date-bar">
    <span class="ldb-label">Logging for</span>
    <input type="date" id="log-date-input" value="${state.logDate}">
    ${!isToday ? `<button class="log-date-today" id="log-today-btn">Today</button>` : ''}
  </div>`;

  html += buildHistoryCardHtml();

  if(exs.length===0){
    html += `<div class="empty">
      <svg viewBox="0 0 24 24"><path d="M6 4v16M18 4v16M2 9h4M2 15h4M18 9h4M18 15h4" stroke-linecap="round"/></svg>
      <p>No exercises on this day yet.</p>
      <button class="btn btn-accent" id="log-addex">+ Add exercise</button>
    </div>`;
  } else {
    html += exs.map(ex=>{
      const daySets = setsOfExercise(ex.id).filter(s=>s.date===state.logDate);
      return `<div class="card">
        <div class="row-between" style="margin-bottom:${daySets.length?'6px':'0'};">
          <h3 style="font-size:14.5px;"><span class="log-exname" data-quickex="${ex.id}">${esc(ex.name)}</span>${classificationSource(ex.name)==='unknown' ? '<span class="exname-badge">Unclassified</span>' : ''}${state.logRenameMode ? `<button class="icon-btn log-rename-toggle" data-renamex="${ex.id}" title="Rename exercise"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button>` : ''}</h3>
          <button class="btn btn-accent btn-sm" data-logset="${ex.id}">+ Set</button>
        </div>
        ${daySets.map(s=>{
          const isPr = s.weight === Math.max(...setsOfExercise(ex.id).map(x=>x.weight));
          return `<div class="set-log-row ${isPr?'pr':''}" data-editset="${s.id}" data-exid="${ex.id}">
            <div class="setnum">${s.setNumber}</div>
            <div class="val weight">${s.weight}<span class="unit">kg</span></div>
            <div class="val">${s.reps}<span class="unit">reps</span></div>
            <button class="icon-btn" data-delset="${s.id}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button>
          </div>`;
        }).join('')}
      </div>`;
    }).join('') + `<button class="btn btn-ghost btn-block" id="log-addex2" style="margin-top:2px;">+ Add exercise to this day</button>`;
  }

  $main.innerHTML = html;
  document.querySelectorAll('[data-day]').forEach(b=>{
    let timer = null;
    let longPressed = false;
    let startX = 0, startY = 0;

    const clearPress = ()=>{
      if(timer){ clearTimeout(timer); timer=null; }
      b.classList.remove('press-armed');
    };

    b.addEventListener('pointerdown', e=>{
      if(e.pointerType === 'mouse' && e.button !== 0) return;
      longPressed = false;
      startX = e.clientX; startY = e.clientY;
      b.classList.add('press-armed');
      timer = setTimeout(()=>{
        timer = null;
        longPressed = true;
        b.classList.remove('press-armed');
        openDayRenameModal(split.id, b.dataset.day);
      }, 650);
    });

    b.addEventListener('pointermove', e=>{
      if(!timer) return;
      if(Math.hypot(e.clientX-startX, e.clientY-startY) > 10) clearPress();
    });

    b.addEventListener('pointerup', e=>{
      const wasLong = longPressed;
      clearPress();
      if(!wasLong) { state.logDayId=b.dataset.day; render(); }
    });
    b.addEventListener('pointercancel', clearPress);
    b.addEventListener('pointerleave', e=>{
      if(e.pointerType === 'mouse') clearPress();
    });
    b.addEventListener('contextmenu', e=> e.preventDefault());
  });
  const a1=document.getElementById('log-addex'), a2=document.getElementById('log-addex2');
  if(a1) a1.onclick = ()=>openExerciseModal(split.id, state.logDayId);
  if(a2) a2.onclick = ()=>openExerciseModal(split.id, state.logDayId);
  // In LOG, long-press is a temporary Quick Info hold-preview. Renaming is
  // explicit via the edit-mode pencil, so workout gestures remain safe.
  const closeQuickInfo = (el)=>{
    if(!el) return;
    el.classList.remove('visible'); el.classList.add('closing');
    setTimeout(()=>el.remove(),180);
  };
  const showQuickInfo = (nameEl, ex)=>{
    const working = setsOfExercise(ex.id).filter(s=>(s.setType||'working')!=='warmup' && Number(s.weight)>0 && Number(s.reps)>0);
    if(!working.length) return null;
    const byWeight = Math.max(...working.map(s=>Number(s.weight)||0));
    const heaviest = working.filter(s=>Number(s.weight)===byWeight);
    const best = working.reduce((a,s)=> (Number(s.reps)>Number(a.reps) || (Number(s.reps)===Number(a.reps)&&Number(s.weight)>Number(a.weight))) ? s : a, working[0]);
    const recent = working.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const recentWeights = recent.slice(0,8).map(s=>Number(s.weight)).filter(Boolean);
    const baselineW = recentWeights.length ? recentWeights.reduce((a,b)=>a+b,0)/recentWeights.length : byWeight;
    const baselineReps = recent.slice(0,8).map(s=>Number(s.reps)).filter(Boolean);
    const avgReps = baselineReps.length ? Math.round(baselineReps.reduce((a,b)=>a+b,0)/baselineReps.length) : 0;
    const box=document.createElement('div'); box.className='quick-info-preview';
    box.innerHTML=`<div class="quick-info-title">${esc(ex.name)}</div><div class="quick-info-row"><span>Baseline</span><b>${baselineW.toFixed(1).replace(/\.0$/,'')} kg × ${avgReps} reps</b></div><div class="quick-info-row"><span>Heaviest working</span><b>${byWeight} kg</b></div><div class="quick-info-row"><span>Best working set</span><b>${best.weight} kg × ${best.reps} reps</b></div>`;
    document.body.appendChild(box);
    const r=nameEl.getBoundingClientRect(); const top=Math.min(window.innerHeight-box.offsetHeight-10,r.bottom+8); const left=Math.max(10,Math.min(window.innerWidth-box.offsetWidth-10,r.left));
    box.style.left=left+'px'; box.style.top=Math.max(10,top)+'px'; requestAnimationFrame(()=>box.classList.add('visible')); return box;
  };
  document.querySelectorAll('.log-exname[data-quickex]').forEach(nameEl=>{
    let timer=null, preview=null, sx=0, sy=0;
    const clear=()=>{ if(timer){clearTimeout(timer);timer=null;} nameEl.classList.remove('press-armed'); if(preview){closeQuickInfo(preview);preview=null;} };
    nameEl.addEventListener('pointerdown',e=>{ if(state.logRenameMode || (e.pointerType==='mouse'&&e.button!==0)) return; sx=e.clientX;sy=e.clientY;nameEl.classList.add('press-armed');timer=setTimeout(()=>{timer=null;nameEl.classList.remove('press-armed');const ex=exerciseById(nameEl.dataset.quickex);if(ex){preview=showQuickInfo(nameEl,ex);if(navigator.vibrate)navigator.vibrate(12);}},550); });
    nameEl.addEventListener('pointermove',e=>{if(timer&&Math.hypot(e.clientX-sx,e.clientY-sy)>10)clear();});
    nameEl.addEventListener('pointerup',clear); nameEl.addEventListener('pointercancel',clear); nameEl.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')clear();}); nameEl.addEventListener('contextmenu',e=>e.preventDefault());
  });
  document.querySelectorAll('[data-renamex]').forEach(b=>b.onclick=()=>openRenameExerciseModal(b.dataset.renamex));
  document.querySelectorAll('[data-logset]').forEach(b=> b.onclick = ()=>openSetModal(b.dataset.logset));
  document.querySelectorAll('[data-delset]').forEach(b=> b.onclick = async (e)=>{
    e.stopPropagation();
    DB.sets = DB.sets.filter(s=>s.id!==b.dataset.delset);
    await save('sets'); render(); toast('Set removed');
  });
  document.querySelectorAll('[data-editset]').forEach(row=> row.onclick = (e)=>{
    if(e.target.closest('[data-delset]')) return;
    openSetModal(row.dataset.exid, row.dataset.editset);
  });
  const dateInput = document.getElementById('log-date-input');
  if(dateInput) dateInput.onchange = e=>{ state.logDate = e.target.value || todayStr(); render(); };
  const todayBtn = document.getElementById('log-today-btn');
  if(todayBtn) todayBtn.onclick = ()=>{ state.logDate = todayStr(); render(); };
  bindHistoryCard();
}

/* ============ PREVIOUS SESSIONS CARD (Log tab) ============ */
function buildHistoryCardHtml(){
  // IMPORTANT: Previous Session is scoped to the day currently selected in
  // the Log tab (e.g. Upper 1 shows only Upper 1 history; Lower 1 shows only
  // Lower 1 history).
  const sessions = historySessionsForDay(state.logDayId); // ascending by date
  if(!sessions.length){
    state.logHistoryDate = null;
    return `<div class="card history-card">
      <button type="button" class="history-toggle" id="history-toggle" aria-expanded="false">
        <span class="history-toggle-label">Previous session</span>
        <span class="history-toggle-center"><span class="history-toggle-day">No ${esc(dayById(state.logDayId)?.name || 'day')} history yet</span></span>
        <span class="history-toggle-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
      </button>
    </div>`;
  }
  // Keep the browsed date valid; default to the most recent session on/before
  // the date currently being logged, falling back to the latest session overall.
  if(!state.logHistoryDate || !sessions.some(s=>s.date===state.logHistoryDate)){
    const onOrBefore = sessions.filter(s=>s.date<=state.logDate);
    state.logHistoryDate = (onOrBefore.length ? onOrBefore[onOrBefore.length-1] : sessions[sessions.length-1]).date;
  }
  const idx = sessions.findIndex(s=>s.date===state.logHistoryDate);
  const session = sessions[idx];
  const hasPrev = idx > 0;
  const hasNext = idx < sessions.length-1;

  const exRows = session.exercises.slice(0,6).map(ex=>{
    const exSets = session.sets.filter(s=>s.exerciseId===ex.id);
    const summary = exSets.map(s=>`${s.weight}&times;${s.reps}`).join(', ');
    return `<div class="history-exrow"><span class="hx-name">${esc(ex.name)}</span><span class="hx-sets">${summary}</span></div>`;
  }).join('') + (session.exercises.length>6 ? `<div class="history-exrow"><span class="hx-name">+${session.exercises.length-6} more</span></div>` : '');

  return `<div class="card history-card ${state.logHistoryOpen?'is-open':''}">
    <button type="button" class="history-toggle" id="history-toggle" aria-expanded="${state.logHistoryOpen?'true':'false'}" aria-controls="history-details">
      <span class="history-toggle-label">Previous session</span>
      <span class="history-toggle-center">
        <span class="history-toggle-date">${fmtDate(session.date)}</span>
        <span class="history-toggle-day">${esc(session.dayName)}</span>
      </span>
      <span class="history-toggle-meta">${session.setCount} sets</span>
      <span class="history-toggle-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
    </button>
    <div class="history-details" id="history-details">
      <div class="history-details-inner">
        <div class="history-nav">
          <button class="history-navbtn" id="hist-prev" ${!hasPrev?'disabled':''} aria-label="Previous session"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <div class="history-center">
            <div class="history-date">${fmtDate(session.date)}</div>
            <div class="history-dayname">${esc(session.dayName)}</div>
          </div>
          <button class="history-navbtn" id="hist-next" ${!hasNext?'disabled':''} aria-label="Next session"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        <div class="history-body">${exRows}</div>
        <div class="history-summary">
          <div class="hs-item"><div class="hs-label">Volume</div><div class="hs-value">${Math.round(session.volume).toLocaleString()}<span style="font-size:10px;color:var(--text-faint);"> kg</span></div></div>
          <div class="hs-item"><div class="hs-label">Sets</div><div class="hs-value">${session.setCount}</div></div>
          <div class="hs-item"><div class="hs-label">Exercises</div><div class="hs-value">${session.exercises.length}</div></div>
        </div>
        <button class="btn btn-ghost history-jump" id="hist-jump">Jump to this session</button>
      </div>
    </div>
  </div>`;
}
function bindHistoryCard(){
  const card = document.querySelector('.history-card');
  const toggle = document.getElementById('history-toggle');
  const prev = document.getElementById('hist-prev');
  const next = document.getElementById('hist-next');
  const jump = document.getElementById('hist-jump');

  if(toggle) toggle.onclick = ()=>{
    state.logHistoryOpen = !state.logHistoryOpen;
    if(card){
      card.classList.toggle('is-open', state.logHistoryOpen);
      toggle.setAttribute('aria-expanded', state.logHistoryOpen ? 'true' : 'false');
    }
  };

  if(prev) prev.onclick = ()=>{
    const sessions = historySessionsForDay(state.logDayId);
    const idx = sessions.findIndex(s=>s.date===state.logHistoryDate);
    if(idx>0){ state.logHistoryDate = sessions[idx-1].date; renderLog(); }
  };
  if(next) next.onclick = ()=>{
    const sessions = historySessionsForDay(state.logDayId);
    const idx = sessions.findIndex(s=>s.date===state.logHistoryDate);
    if(idx<sessions.length-1){ state.logHistoryDate = sessions[idx+1].date; renderLog(); }
  };
  if(jump) jump.onclick = ()=>{
    const sessions = historySessionsForDay(state.logDayId);
    const session = sessions.find(s=>s.date===state.logHistoryDate);
    if(!session) return;
    state.logDate = session.date;
    state.logDayId = session.dayId;
    state.logHistoryOpen = false;
    render();
  };
}


function openSetModal(exerciseId, editSetId){
  const ex = exerciseById(exerciseId);
  const editSet = editSetId ? DB.sets.find(s=>s.id===editSetId) : null;
  const date = editSet ? editSet.date : (state.logDate || todayStr());
  const existingOnDate = setsOfExercise(exerciseId).filter(s=>s.date===date && s.id!==editSetId);
  const existingNumbers = existingOnDate.map(s=>Number(s.setNumber)||0);
  const highestExistingSetNum = existingNumbers.length ? Math.max(...existingNumbers) : 0;
  const nextSetNum = editSet ? editSet.setNumber : highestExistingSetNum + 1;
  const lastSet = editSet ? null : setsOfExercise(exerciseId).slice(-1)[0];
  const initialRows = [{
    id: editSet ? editSet.id : null,
    setNumber: nextSetNum,
    weight: editSet ? editSet.weight : (lastSet ? lastSet.weight : ''),
    reps: editSet ? editSet.reps : (lastSet ? lastSet.reps : '')
  }];

  $modalRoot.innerHTML = `
    <div class="modal-overlay" id="m-overlay">
      <div class="modal-sheet">
        <div class="modal-close-row"><button class="icon-btn" id="m-close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button></div>
        <div class="modal-title-row">
          <h2>${editSet ? 'Edit set &middot; ' : ''}${esc(ex.name)}</h2>
          <button type="button" class="btn btn-ghost modal-add-set-btn" id="m-add-set" aria-label="Add another set" title="Add another set">+</button>
        </div>
        <div id="m-set-list" class="bulk-set-list"></div>
        <div class="field">
          <label class="field-label">Date</label>
          <input type="date" id="m-date" value="${date}">
        </div>
        <div id="m-err" style="color:var(--rust);font-size:12.5px;margin-bottom:10px;display:none;"></div>
        <button class="btn btn-accent btn-block" id="m-save">${editSet ? 'Save changes' : 'Save sets'}</button>
        ${editSet ? `<button class="btn btn-danger btn-block" id="m-delete" style="margin-top:8px;">Delete set</button>` : ''}
      </div>
    </div>`;

  const listEl = document.getElementById('m-set-list');
  let rows = initialRows.slice();

  function nextAvailableSetNumber(){
    // Set numbers are scoped to the exercise + selected date, not the entire history.
    // This keeps a new day's first added set at #1, then #2, #3, etc.
    const currentDate = document.getElementById('m-date')?.value || date;
    const nums = [
      ...setsOfExercise(exerciseId)
        .filter(s=>s.date===currentDate && (!editSetId || s.id!==editSetId))
        .map(s=>Number(s.setNumber)||0),
      ...rows.map(r=>Number(r.setNumber)||0)
    ];
    return (nums.length ? Math.max(...nums) : 0) + 1;
  }

  function renderSetRows(){
    listEl.innerHTML = rows.map((r,i)=>`
      <div class="bulk-set-row" data-row-index="${i}">
        <div class="field"><label class="field-label">Set #</label><input type="number" class="m-row-setnum" value="${r.setNumber}" min="1" inputmode="numeric"></div>
        <div class="field"><label class="field-label">Weight (kg)</label><input type="number" class="m-row-weight" step="0.5" value="${r.weight}" placeholder="0" inputmode="decimal"></div>
        <div class="field"><label class="field-label">Reps</label><input type="number" class="m-row-reps" value="${r.reps}" placeholder="0" min="1" inputmode="numeric"></div>
        <button type="button" class="icon-btn bulk-remove" data-remove-row="${i}" aria-label="Remove set" title="Remove set"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button>
      </div>`).join('');

    listEl.querySelectorAll('.m-row-setnum,.m-row-weight,.m-row-reps').forEach(inp=>inp.oninput=()=>{
      const row=inp.closest('.bulk-set-row'); const i=Number(row.dataset.rowIndex);
      const r=rows[i];
      r.setNumber=parseInt(row.querySelector('.m-row-setnum').value)||'';
      r.weight=row.querySelector('.m-row-weight').value===''?'':parseFloat(row.querySelector('.m-row-weight').value);
      r.reps=row.querySelector('.m-row-reps').value===''?'':parseInt(row.querySelector('.m-row-reps').value);
    });
    listEl.querySelectorAll('[data-remove-row]').forEach(btn=>btn.onclick=()=>{
      if(rows.length===1){
        toast('At least one set is required');
        return;
      }
      rows.splice(Number(btn.dataset.removeRow),1);
      renderSetRows();
    });
  }

  renderSetRows();
  document.getElementById('m-close').onclick = closeModal;
  document.getElementById('m-overlay').onclick = e=>{ if(e.target.id==='m-overlay') closeModal(); };
  document.getElementById('m-add-set').onclick = ()=>{
    rows.push({id:null,setNumber:nextAvailableSetNumber(),weight:rows.length?rows[rows.length-1].weight:(lastSet?lastSet.weight:''),reps:rows.length?rows[rows.length-1].reps:(lastSet?lastSet.reps:'')});
    renderSetRows();
    const inputs=listEl.querySelectorAll('.m-row-weight');
    if(inputs.length) inputs[inputs.length-1].focus();
  };

  document.getElementById('m-save').onclick = async ()=>{
    // Sync the current inputs before validating/saving.
    listEl.querySelectorAll('.bulk-set-row').forEach((row,i)=>{
      rows[i].setNumber=parseInt(row.querySelector('.m-row-setnum').value)||0;
      rows[i].weight=row.querySelector('.m-row-weight').value===''?NaN:parseFloat(row.querySelector('.m-row-weight').value);
      rows[i].reps=row.querySelector('.m-row-reps').value===''?NaN:parseInt(row.querySelector('.m-row-reps').value);
    });
    const d = document.getElementById('m-date').value;
    const errEl = document.getElementById('m-err');
    const invalid = rows.some(r=>!r.setNumber || r.setNumber<1 || !Number.isFinite(r.weight) || r.weight<0 || !r.reps || r.reps<1);
    const numbers = rows.map(r=>r.setNumber);
    const duplicateNumbers = numbers.some((n,i)=>numbers.indexOf(n)!==i);
    const takenNumbers = new Set(setsOfExercise(exerciseId).filter(s=>s.date===d && (!editSetId || s.id!==editSetId)).map(s=>Number(s.setNumber)));
    const clashes = numbers.some(n=>takenNumbers.has(n));
    if(invalid || !d){
      errEl.textContent = 'Fill in a valid set number, weight, reps, and date for every set.';
      errEl.style.display='block'; return;
    }
    if(duplicateNumbers || clashes){
      errEl.textContent = 'Each set number must be unique for this exercise and date.';
      errEl.style.display='block'; return;
    }

    if(editSet){
      const first = rows[0];
      editSet.setNumber = first.setNumber; editSet.weight = first.weight; editSet.reps = first.reps; editSet.date = d;
      for(let i=1;i<rows.length;i++){
        const r=rows[i];
        DB.sets.push({id:uid('set'),exerciseId,setNumber:r.setNumber,date:d,weight:r.weight,reps:r.reps,createdAt:new Date().toISOString()});
      }
    } else {
      rows.forEach(r=>DB.sets.push({id:uid('set'),exerciseId,setNumber:r.setNumber,date:d,weight:r.weight,reps:r.reps,createdAt:new Date().toISOString()}));
    }
    await save('sets');
    state.logDate = d;
    closeModal(); render(); toast(editSet ? (rows.length>1 ? `${rows.length} sets saved` : 'Set updated') : `${rows.length} ${rows.length===1?'set':'sets'} logged`);
  };

  const delBtn = document.getElementById('m-delete');
  if(delBtn) delBtn.onclick = async ()=>{
    DB.sets = DB.sets.filter(s=>s.id!==editSet.id);
    await save('sets');
    closeModal(); render(); toast('Set removed');
  };
}

/* ============ TAB: PROGRESS ============ */

/* ============ TAB: STATS ============ */
function statsPoint(cx,cy,r,index,total){
  const angle = -Math.PI/2 + (Math.PI*2*index/total);
  return {x:cx + Math.cos(angle)*r, y:cy + Math.sin(angle)*r};
}

// Monday-start week (matches the app's YYYY-MM-DD date strings). Used only by the
// "This week" 3D-card metrics — the existing radar/frequency calculation below is
// untouched and keeps using the split's structural day templates.
function weekRangeFor(dateStr){
  const d=new Date(dateStr+'T00:00:00');
  const diffToMonday=(d.getDay()+6)%7;
  const monday=new Date(d); monday.setDate(d.getDate()-diffToMonday);
  const sunday=new Date(monday); sunday.setDate(monday.getDate()+6);
  const fmt=x=>x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
  return {start:fmt(monday), end:fmt(sunday)};
}
function statsForGroupThisWeek(group){
  const {start,end}=weekRangeFor(todayStr());
  const exNames=new Set(); const days=new Set(); let sets=0;
  DB.sets.forEach(s=>{
    if(s.date<start || s.date>end) return;
    const ex=exerciseById(s.exerciseId); if(!ex) return;
    if(classifyExercise(ex.name)!==group) return;
    exNames.add(normalizeExerciseName(ex.name)); days.add(s.date); sets++;
  });
  return {exercises:exNames.size, sets, frequency:days.size};
}
function statsForGroupActiveSplit(group, structuralFreq){
  const split=activeSplit();
  if(!split) return {exercises:0, sets:0, frequency:0};
  const exNames=new Set(); let sets=0;
  split.days.forEach(day=>{
    exercisesOfDay(day.id).forEach(ex=>{
      if(classifyExercise(ex.name)!==group) return;
      exNames.add(normalizeExerciseName(ex.name));
      sets += setsOfExercise(ex.id).length;
    });
  });
  return {exercises:exNames.size, sets, frequency:(structuralFreq && structuralFreq[group])||0};
}
function statsForGroup(group){
  return state.statsRange==='week' ? statsForGroupThisWeek(group) : statsForGroupActiveSplit(group, statsStructuralFreq);
}

let statsStructuralFreq = Object.fromEntries(STATS_GROUPS.map(g=>[g,0]));
let stats3dView = null;

function destroyStats3D(){
  if(stats3dView){ stats3dView.destroy(); stats3dView=null; }
}

function renderStats(){
  destroyStats3D();
  const split = activeSplit();
  if(!split){
    setHeader('Training analysis','Stats',null,null);
    $main.innerHTML = `<div class="empty" style="margin-top:20px;">
      <svg viewBox="0 0 24 24"><path d="M4 19V9M11 19V4M18 19v-6" stroke-linecap="round"/></svg>
      <p>Create a split to see training stats.</p>
      <button class="btn btn-accent" id="stats-newsplit">Create split</button>
    </div>`;
    const b=document.getElementById('stats-newsplit'); if(b) b.onclick=()=>openSplitModal(null);
    return;
  }

  // structural frequency (unique split day-templates per category) — unchanged from
  // the original implementation; drives both the radar chart and "Active split" frequency.
  const freq = Object.fromEntries(STATS_GROUPS.map(g=>[g,0]));
  split.days.forEach(day=>{
    const trainedToday = new Set();
    exercisesOfDay(day.id).forEach(ex=>{
      const group = classifyExercise(ex.name);
      if(group) trainedToday.add(group);
    });
    trainedToday.forEach(group=> freq[group]++);
  });
  statsStructuralFreq = freq;

  setHeader('Training analysis', split.name, null, null);

  const labels = STATS_GROUPS.map(g=>STATS_LABELS[g]);
  const values = STATS_GROUPS.map(g=>freq[g]);
  const cx=150, cy=150, maxR=104, rings=4, total=STATS_GROUPS.length;
  const maxValue=Math.max(1,...values);
  const gridPolys=[];
  for(let ring=1;ring<=rings;ring++){
    const rr=maxR*ring/rings;
    const pts=STATS_GROUPS.map((_,i)=>{const p=statsPoint(cx,cy,rr,i,total);return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;}).join(' ');
    gridPolys.push(`<polygon points="${pts}" fill="none" stroke="var(--border)" stroke-width="1"/>`);
  }
  const axisLines=STATS_GROUPS.map((_,i)=>{
    const p=statsPoint(cx,cy,maxR,i,total);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;
  }).join('');
  const dataPts=STATS_GROUPS.map((g,i)=>{
    const p=statsPoint(cx,cy,maxR*(freq[g]/maxValue),i,total);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');
  const axisLabels=STATS_GROUPS.map((g,i)=>{
    const p=statsPoint(cx,cy,maxR+27,i,total);
    let anchor='middle';
    if(p.x<cx-8) anchor='end'; else if(p.x>cx+8) anchor='start';
    let dy='0.35em';
    if(p.y<cy-70) dy='0';
    else if(p.y>cy+70) dy='1em';
    return `<text class="stats-axis" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anchor}" dy="${dy}">${labels[i]}</text>`;
  }).join('');
  const hitAreas=STATS_GROUPS.map((g,i)=>{
    const p=statsPoint(cx,cy,maxR+10,i,total);
    return `<circle class="stats-hit" data-stats-group="${g}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="25" aria-label="${labels[i]} ${freq[g]} times per week"/>`;
  }).join('');

  $main.innerHTML = `
    <div class="card stats3d-card">
      <div class="segmented" id="stats-range">
        <button data-range="week" class="${state.statsRange==='week'?'active':''}">This week</button>
        <button data-range="split" class="${state.statsRange==='split'?'active':''}">Active split</button>
      </div>
      <div class="stats3d-wrap" id="stats3d-wrap" aria-label="Interactive 3D body. Drag to rotate, pinch or scroll to zoom, tap a muscle group for stats.">
        <svg class="stats3d-leader" id="stats3d-leader"></svg>
        <div class="stats3d-hint" id="stats3d-hint">Tap a muscle to view stats</div>
        <div class="stats3d-float" id="stats3d-float"></div>
      </div>
    </div>
    <div class="card">
      <button class="stats3d-showmore${state.statsExpanded?' open':''}" id="stats3d-showmore">
        <span>${state.statsExpanded?'Show less':'Show more'}</span>
        <svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="stats3d-collapse${state.statsExpanded?' open':''}" id="stats3d-collapse">
        <div class="stats-card" style="padding-top:12px;">
          <div class="stats-chart-wrap" id="stats-chart-wrap">
            <svg class="stats-chart" id="stats-radar" viewBox="0 0 300 300" role="img" aria-label="Weekly training frequency radar chart">
              <g>${gridPolys.join('')}</g>
              <g>${axisLines}</g>
              <polygon points="${dataPts}" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>
              ${STATS_GROUPS.map((g,i)=>{const p=statsPoint(cx,cy,maxR*(freq[g]/maxValue),i,total);return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`;}).join('')}
              ${axisLabels}
              ${hitAreas}
            </svg>
            <div class="stats-tooltip" id="stats-tooltip"></div>
          </div>
          <p class="stats-legend">Frequency = number of training days per week.</p>
        </div>
        <div class="stats-grid" style="margin-top:2px;">
          ${STATS_GROUPS.map(g=>`<div class="stats-metric"><div class="label">${STATS_LABELS[g]}</div><div class="value">${freq[g]}×</div></div>`).join('')}
        </div>
      </div>
    </div>`;

  bindStatsRadarTooltip(freq);
  bindStatsShowMore();
  bindStatsRangeToggle();
  mountStats3D();
}

function bindStatsRadarTooltip(freq){
  const tooltip=document.getElementById('stats-tooltip');
  const wrap=document.getElementById('stats-chart-wrap');
  function showStatsTooltip(group, event){
    const value=freq[group], label=STATS_LABELS[group];
    tooltip.innerHTML=`<div class="tt-title">${label}</div><div class="tt-value">${value}× / WEEK</div>`;
    const rect=wrap.getBoundingClientRect();
    const point=event && event.clientX!=null
      ? {x:event.clientX-rect.left,y:event.clientY-rect.top}
      : {x:rect.width/2,y:rect.height/2};
    tooltip.style.left=`${Math.max(70,Math.min(rect.width-70,point.x))}px`;
    tooltip.style.top=`${Math.max(45,Math.min(rect.height-25,point.y))}px`;
    tooltip.classList.add('show');
  }
  function hideStatsTooltip(){ tooltip.classList.remove('show'); }
  document.querySelectorAll('.stats-hit').forEach(hit=>{
    const group=hit.dataset.statsGroup;
    hit.addEventListener('pointerenter',e=>showStatsTooltip(group,e));
    hit.addEventListener('pointermove',e=>{ if(e.pointerType==='mouse') showStatsTooltip(group,e); });
    hit.addEventListener('pointerleave',hideStatsTooltip);
    hit.addEventListener('pointerdown',e=>{ e.stopPropagation(); showStatsTooltip(group,e); });
    hit.addEventListener('click',e=>{ e.stopPropagation(); showStatsTooltip(group,e); });
  });
  document.getElementById('stats-radar').addEventListener('click',e=>{
    if(!e.target.closest('.stats-hit')) hideStatsTooltip();
  });
}

function bindStatsShowMore(){
  const btn=document.getElementById('stats3d-showmore');
  const panel=document.getElementById('stats3d-collapse');
  btn.onclick=()=>{
    state.statsExpanded=!state.statsExpanded;
    btn.classList.toggle('open',state.statsExpanded);
    panel.classList.toggle('open',state.statsExpanded);
    btn.querySelector('span').textContent = state.statsExpanded ? 'Show less' : 'Show more';
  };
}

function bindStatsRangeToggle(){
  const wrap=document.getElementById('stats-range');
  wrap.querySelectorAll('button').forEach(b=>{
    b.onclick=()=>{
      if(b.dataset.range===state.statsRange) return;
      state.statsRange=b.dataset.range;
      wrap.querySelectorAll('button').forEach(x=>x.classList.toggle('active', x===b));
      refreshStatsFloatCard();
    };
  });
}

/* ---- 3D body mount / muscle-selection callout ---- */
function mountStats3D(){
  const container=document.getElementById('stats3d-wrap');
  if(!container || !window.Stats3D){ showStats3DFallback(); return; }
  stats3dView = Stats3D.mount(container, {
    onSelect(category){
      state.statsSelectedGroup = category;
      const hint=document.getElementById('stats3d-hint');
      if(hint) hint.classList.toggle('hidden', !!category);
      if(!category){
        const card=document.getElementById('stats3d-float');
        if(card) card.classList.remove('show');
        const leader=document.getElementById('stats3d-leader');
        if(leader) leader.innerHTML='';
      } else {
        refreshStatsFloatCard();
      }
    },
    onAnchorUpdate(category, pos){
      positionStatsFloatCard(pos);
    },
    onFail(){ showStats3DFallback(); }
  });
  if(!stats3dView) showStats3DFallback();
}
function showStats3DFallback(){
  const container=document.getElementById('stats3d-wrap');
  if(!container) return;
  container.innerHTML = `<div class="stats3d-fallback">
    <svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7L21 9.6l-4.5 4.4 1.1 6.1L12 17.2 6.4 20.1l1.1-6.1L3 9.6l6.2-.9L12 3z" stroke-linejoin="round"/></svg>
    <p>3D view isn't available on this device.<br>Use "Show more" below for the frequency chart.</p>
  </div>`;
  if(!state.statsExpanded){
    const btn=document.getElementById('stats3d-showmore');
    if(btn) btn.click();
  }
}
function refreshStatsFloatCard(){
  if(!state.statsSelectedGroup) return;
  const card=document.getElementById('stats3d-float');
  if(!card) return;
  const s=statsForGroup(state.statsSelectedGroup);
  const rangeLabel = state.statsRange==='week' ? 'this week' : 'in split';
  card.innerHTML = `<div class="f-title">${STATS_LABELS[state.statsSelectedGroup]}</div>
    <div class="f-row"><span>Exercises</span><b>${s.exercises}</b></div>
    <div class="f-row"><span>Sets</span><b>${s.sets}</b></div>
    <div class="f-row"><span>Frequency</span><b>${s.frequency}×</b></div>
    <div class="f-row"><span style="color:var(--text-faint);font-size:10.5px;">${rangeLabel}</span><span></span></div>`;
  card.classList.add('show');
}
function positionStatsFloatCard(pos){
  const wrap=document.getElementById('stats3d-wrap');
  const card=document.getElementById('stats3d-float');
  const leader=document.getElementById('stats3d-leader');
  if(!wrap || !card || !leader) return;
  leader.setAttribute('viewBox', `0 0 ${pos.w} ${pos.h}`);
  const cw = Math.min(180, Math.max(132, card.offsetWidth || 150));
  const ch = card.offsetHeight || 96;
  const onRight = pos.x < pos.w/2;
  let left = onRight ? pos.x + 26 : pos.x - 26 - cw;
  left = Math.max(8, Math.min(pos.w - cw - 8, left));
  let top = pos.y - ch/2;
  top = Math.max(8, Math.min(pos.h - ch - 8, top));
  card.style.left = left+'px';
  card.style.top = top+'px';
  const edgeX = onRight ? left : left+cw;
  const edgeY = Math.max(top+10, Math.min(top+ch-10, pos.y));
  leader.innerHTML = `<line x1="${pos.x.toFixed(1)}" y1="${pos.y.toFixed(1)}" x2="${edgeX.toFixed(1)}" y2="${edgeY.toFixed(1)}"/>
    <circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="3.5"/>`;
}

/* ============ PROGRESS: MODE SWITCHER (Exercise / Day / Split) ============ */
// A lightweight, tappable "orbit" selector between the three Progress reports.
// It intentionally avoids a literal fake-3D hologram (per spec) in favor of an
// elegant, mobile-cheap tri-state control that still feels like a single
// rotating analytics object: the active segment lifts and a dot-strip below
// echoes the existing plate-rule tab indicator idiom used elsewhere in the app.
function progressModesAvailable(){
  const modes = ['exercise','day'];
  if(DB.splits.length>=2) modes.push('split');
  return modes;
}
function buildProgressModeSwitcherHtml(){
  const modes = progressModesAvailable();
  if(!modes.includes(state.progressMode)) state.progressMode = 'exercise';
  const icons = {
    exercise:'<svg viewBox="0 0 24 24"><path d="M4 19V9M11 19V4M18 19v-6" stroke-linecap="round"/></svg>',
    day:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18" stroke-linecap="round"/></svg>',
    split:'<svg viewBox="0 0 24 24"><circle cx="7" cy="12" r="3"/><circle cx="17" cy="6" r="3"/><circle cx="17" cy="18" r="3"/><path d="M9.5 10.5L14.5 7.5M9.5 13.5L14.5 16.5" stroke-linecap="round"/></svg>'
  };
  const labels = {exercise:'Exercise',day:'Day',split:'Split'};
  return `<div class="card progress-modes-card">
    <div class="progress-modes">
      ${modes.map(m=>`<button data-mode="${m}" class="${state.progressMode===m?'active':''}">${icons[m]}${labels[m]}</button>`).join('')}
    </div>
    <div class="progress-orbit-dots">${modes.map(m=>`<span class="od ${state.progressMode===m?'hot':''}"></span>`).join('')}</div>
  </div>`;
}
function bindProgressModeSwitcher(){
  document.querySelectorAll('.progress-modes [data-mode]').forEach(b=>{
    b.onclick = ()=>{
      if(state.progressMode===b.dataset.mode) return;
      state.progressMode = b.dataset.mode;
      render();
    };
  });
}

function renderProgress(){
  if(!DB.splits.length){ setHeader('Progress','No data yet',null,null); renderOnboarding(); return; }
  const modes = progressModesAvailable();
  if(!modes.includes(state.progressMode)) state.progressMode = 'exercise';
  if(state.progressMode==='day'){ renderProgressDayMode(); return; }
  if(state.progressMode==='split'){ renderProgressSplitMode(); return; }
  renderProgressExerciseMode();
}

function renderProgressExerciseMode(){
  if(!DB.splits.length){ setHeader('Progress','No data yet',null,null); renderOnboarding(); return; }
  if(!state.progressSplitId) state.progressSplitId = (activeSplit()||DB.splits[0]).id;
  const split = splitById(state.progressSplitId) || activeSplit() || DB.splits[0];
  state.progressSplitId = split.id;

  setHeader('Progress', split.name, null, null);

  const allDayIds = split.days.map(d=>d.id);
  const exList = DB.exercises.filter(e=> allDayIds.includes(e.dayId));

  let html = buildProgressModeSwitcherHtml();

  html += `<div class="card">
    <div class="card-title">Viewing split</div>
    <select id="p-split">
      ${DB.splits.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(s=>`<option value="${s.id}" ${s.id===split.id?'selected':''}>${esc(s.name)}${s.archivedAt?' (archived)':' (active)'}</option>`).join('')}
    </select>
  </div>`;

  if(exList.length===0){
    html += `<div class="empty"><p>No exercises logged under this split yet.</p></div>`;
    $main.innerHTML = html;
    bindProgressModeSwitcher();
    document.getElementById('p-split').onchange = e=>{ state.progressSplitId=e.target.value; state.progressExerciseId=null; render(); };
    return;
  }

  if(!state.progressExerciseId || !exList.some(e=>e.id===state.progressExerciseId)){
    const withSets = exList.find(e=> setsOfExercise(e.id).length>0);
    state.progressExerciseId = (withSets||exList[0]).id;
  }

  html += `<div class="card">
    <div class="card-title">Exercise</div>
    <select id="p-exercise">
      ${exList.map(e=>`<option value="${e.id}" ${e.id===state.progressExerciseId?'selected':''}>${esc(e.name)}${e.archived?' (archived)':''}</option>`).join('')}
    </select>
  </div>`;

  const sets = setsOfExercise(state.progressExerciseId);

  if(sets.length===0){
    html += `<div class="empty"><p>No sets logged for this exercise yet — log one from the Log tab.</p></div>`;
    $main.innerHTML = html;
    bindProgressModeSwitcher();
    bindProgressSelectors();
    return;
  }

  // ---- progressive-overload trend ----
  // Progress is tracked at the same weight. A session contributes its best
  // reps at that weight, and the baseline is the median of the four most
  // recent qualifying sessions before the current session.
  function median4(values){
    const a = values.slice().sort((x,y)=>x-y);
    if(!a.length) return null;
    const m=Math.floor(a.length/2);
    return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
  }
  function fmtRepValue(v){ return Number.isInteger(v) ? String(v) : Number(v).toFixed(1); }
  function buildProgressiveOverloadTrend(exerciseSets){
    const grouped={};
    exerciseSets.forEach(s=>{
      const d=s.date;
      const w=Number(s.weight);
      const r=Number(s.reps);
      if(!Number.isFinite(w)||!Number.isFinite(r)) return;
      if(!grouped[d]) grouped[d]=[];
      grouped[d].push({weight:w,reps:r});
    });

    const dates=Object.keys(grouped).sort();
    if(!dates.length) return {status:'insufficient',title:'Building baseline',note:'Log more sessions to establish a same-weight performance baseline.',html:'&mdash;'};

    const latestDate=dates[dates.length-1];
    const latestSets=grouped[latestDate];
    const currentWeight=Math.max(...latestSets.map(s=>s.weight));
    const currentAtWeight=latestSets.filter(s=>s.weight===currentWeight);

    // The current session is represented by the median reps across every
    // set performed at the tracked weight. This works for 2, 3, 4, 5, etc.
    // sets and prevents one unusually strong final set from masking a dip.
    const currentReps=median4(currentAtWeight.map(s=>s.reps));
    const currentSetCount=currentAtWeight.length;
    const currentBestReps=Math.max(...currentAtWeight.map(s=>s.reps));

    // A genuinely new load is positive progression when it is performed
    // for more than a single rep. This is treated separately from the
    // same-weight baseline system because there is no same-weight baseline
    // to compare against yet.
    const previousWeights=dates.slice(0,-1).flatMap(date=>grouped[date].map(s=>s.weight));
    const previousMaxWeight=previousWeights.length ? Math.max(...previousWeights) : null;
    const isNewWeight=previousMaxWeight!=null && currentWeight>previousMaxWeight;
    const newWeightPositive=isNewWeight && currentReps>1;

    const sessionSummary = currentSetCount > 1
      ? `Session: ${currentSetCount} sets &middot; Median: ${fmtRepValue(currentReps)} reps${currentBestReps!==currentReps ? ` &middot; Best: ${fmtRepValue(currentBestReps)} reps` : ''}`
      : `Session: 1 set &middot; ${fmtRepValue(currentReps)} reps`;

    // Only compare sessions performed at the exact same weight. A weight
    // change therefore starts a fresh progression track automatically.
    // A new weight with more than one rep is an immediate positive result.
    // Do not wait for four same-weight sessions to establish a baseline.
    if(newWeightPositive){
      return {
        status:'new-weight',
        statusClass:'trend-up',
        title:'Positive progression',
        note:`New load achieved at ${fmtRepValue(currentWeight)} kg with a session median above 1 rep. This represents positive progression.`,
        currentWeight,currentReps,currentBestReps,currentSetCount,
        baseline:null,prior:[],latestDate,followups:0,confirms:0,diff:null,signed:null,
        html:`<span class="trend-up">&uarr; Positive</span>`
      };
    }

    const rows=dates.map(date=>{
      const atWeight=grouped[date].filter(s=>s.weight===currentWeight);
      if(!atWeight.length) return null;
      return {
        date,
        reps:median4(atWeight.map(s=>s.reps)),
        bestReps:Math.max(...atWeight.map(s=>s.reps)),
        setCount:atWeight.length
      };
    }).filter(Boolean);

    const prior=rows.filter(r=>r.date!==latestDate).slice(-4);
    if(prior.length<4){
      return {
        status:'insufficient',
        title:'Building baseline',
        note:`Need ${4-prior.length} more same-weight session${4-prior.length===1?'':'s'} to establish the baseline.`,
        currentWeight,currentReps,currentBestReps,currentSetCount,prior,latestDate,
        html:`<span style="color:var(--text-dim);">Building baseline</span>`
      };
    }

    const baseline=median4(prior.map(r=>r.reps));
    const diff=currentReps-baseline;
    const signed=diff>0?`+${fmtRepValue(diff)}`:diff<0?fmtRepValue(diff):'0';

    // Detect the start of the most recent underperformance streak. The
    // baseline is anchored to the four sessions immediately BEFORE the
    // first below-baseline session, then frozen for the three-session watch
    // window. This prevents later below-baseline sessions from becoming part
    // of a new rolling baseline and incorrectly lowering the benchmark.
    let recentWatch=null;
    for(let i=4;i<rows.length;i++){
      const b=median4(rows.slice(i-4,i).map(r=>r.reps));
      if(rows[i].reps<b){
        const previous=rows[i-1];
        const startsNewDip = !previous || previous.reps>=b;
        if(startsNewDip){
          const followups=rows.slice(i+1,i+4);
          recentWatch={index:i,baseline:b,followups};
        }
      }
    }

    let status='maintained';
    let title='Maintained';
    let note='Session performance is in line with the recent baseline.';
    let statusClass='';
    let followups=0;
    let confirms=0;

    // If the latest session is a follow-up to a prior underperformance,
    // explicitly report recovery/persistence before treating it as a new event.
    if(recentWatch){
      const latestIsFollowup=recentWatch.followups.some(r=>r.date===latestDate);
      if(latestIsFollowup){
        const seen=recentWatch.followups.filter(r=>r.date<=latestDate);
        const recovered=seen.some(r=>r.reps>=recentWatch.baseline);
        if(recovered){
          status='recovered';
          title='Recovered';
          statusClass='trend-up';
          note=`Returned to at least the ${fmtRepValue(recentWatch.baseline)}-rep baseline after the earlier dip. No regression is recorded.`;
          return {status,statusClass,title,note:`${note}|${sessionSummary}`,currentWeight,currentReps,currentBestReps,currentSetCount,baseline,prior,latestDate,followups:seen.length,confirms,diff,signed,
            html:`<span class="trend-up">&uarr; Recovered</span>`};
        }
        if(seen.length>=3){
          status='persistent';
          title='Persistent underperformance';
          statusClass='trend-down';
          note=`The last 3 follow-up sessions stayed below the ${fmtRepValue(recentWatch.baseline)}-rep baseline. Consider this a persistent dip at this weight.`;
          return {status,statusClass,title,note:`${note}|${sessionSummary}`,currentWeight,currentReps,currentBestReps,currentSetCount,baseline,prior,latestDate,followups:3,confirms,diff,signed,
            html:`<span class="trend-down">&darr; Persistent</span>`};
        }
        if(currentReps<baseline){
          status='watch';
          title='Performance watch';
          statusClass='trend-down';
          followups=seen.length;
          note=`Below baseline. Monitoring follow-up ${seen.length} of 3 at this weight.`;
          return {status,statusClass,title,note:`${note}|${sessionSummary}`,currentWeight,currentReps,currentBestReps,currentSetCount,baseline,prior,latestDate,followups,confirms,diff,signed,
            html:`<span class="trend-down">&darr; Monitoring ${seen.length}/3</span>`};
        }
      }
    }

    if(currentReps>baseline){
      // A higher session median is an improvement, but it is not allowed to
      // replace the established baseline until three sessions confirm it.
      confirms=1;
      const previousRows=rows.filter(r=>r.date!==latestDate).slice(-3);
      for(let i=previousRows.length-1;i>=0;i--){
        if(previousRows[i].reps>=currentReps) confirms++;
        else break;
      }
      if(confirms>=3){
        status='confirmed';
        title='New level confirmed';
        statusClass='trend-up';
        note=`${confirms} recent sessions support ${currentWeight}kg &times; ${fmtRepValue(currentReps)}. The new level is now confirmed.`;
      }else{
        status='improved';
        title='Improved';
        statusClass='trend-up';
        note=`Session median is above the baseline. Keep tracking it for ${3-confirms} more confirming session${3-confirms===1?'':'s'} before rebuilding the baseline.`;
      }
    }else if(currentReps<baseline){
      status='watch';
      title='Performance watch';
      statusClass='trend-down';
      note=`Below the established baseline. Performance will be monitored across the next 3 same-weight sessions before identifying a regression.`;
      followups=0;
    }

    note = `${note}|${sessionSummary}`;

    return {
      status,statusClass,title,note,currentWeight,currentReps,currentBestReps,currentSetCount,
      baseline,prior,latestDate,followups,confirms,diff,signed,
      html:`<span class="${statusClass}">${status==='watch'?'&darr; Monitoring':status==='maintained'?'&rarr; 0 reps':'&uarr; '+signed+' reps'}</span>`
    };
  }

// ---- stats ----
  const weights = sets.map(s=>s.weight);
  const prWeight = Math.max(...weights);
  const setsAtPrWeight = sets.filter(s=>s.weight===prWeight);
  const prSet = setsAtPrWeight.reduce((best,s)=> s.reps>best.reps ? s : best, setsAtPrWeight[0]);
  const totalVolume = sets.reduce((a,s)=>a+s.weight*s.reps,0);
  const sessionsMap = {};
  sets.forEach(s=>{ (sessionsMap[s.date]=sessionsMap[s.date]||[]).push(s); });
  const sessionDates = Object.keys(sessionsMap).sort();
  const sessionCount = sessionDates.length;
  const avgReps = (sets.reduce((a,s)=>a+s.reps,0)/sets.length).toFixed(1);

  let trendHtml = '';
  if(sessionDates.length>=2){
    const lastDate = sessionDates[sessionDates.length-1];
    const prevDate = sessionDates[sessionDates.length-2];
    const lastTop = Math.max(...sessionsMap[lastDate].map(s=>s.weight));
    const prevTop = Math.max(...sessionsMap[prevDate].map(s=>s.weight));
    const diff = lastTop - prevTop;
    if(diff>0) trendHtml = `<span class="trend-up">&uarr; +${diff}kg</span> vs last session`;
    else if(diff<0) trendHtml = `<span class="trend-down">&darr; ${diff}kg</span> vs last session`;
    else trendHtml = `<span style="color:var(--text-dim);">&rarr; same</span> as last session`;
  }
  const overload = buildProgressiveOverloadTrend(sets);

  html += `<div class="card">
    <div class="card-title">Snapshot</div>
    <div class="stat-grid">
      <div class="stat-tile">
        <div class="label">Personal best</div>
        <div class="value">${prWeight}<span class="unit">kg</span></div>
        <div class="sub">&times; ${prSet.reps} reps &middot; ${fmtDate(prSet.date)}</div>
      </div>
      <div class="stat-tile">
        <div class="label">Total volume</div>
        <div class="value">${Math.round(totalVolume).toLocaleString()}<span class="unit">kg</span></div>
        <div class="sub">across ${sessionCount} session${sessionCount===1?'':'s'}</div>
      </div>
      <div class="stat-tile">
        <div class="label">Avg reps / set</div>
        <div class="value">${avgReps}</div>
        <div class="sub">${sets.length} sets logged</div>
      </div>
      <div class="stat-tile">
        <div class="label">Trend</div>
        <div class="value" style="font-size:14px;">${trendHtml || '&mdash;'}</div>
      </div>
    </div>
  </div>`;

  // ---- progressive overload ----
  html += `<div class="card overload-card">
    <div class="card-title">Progressive overload</div>
    <div class="overload-main">
      <div>
        <div class="overload-kicker">Same-weight performance</div>
        <div class="overload-title">${overload.currentWeight!=null ? `${fmtRepValue(overload.currentWeight)} kg &times; ${fmtRepValue(overload.currentReps)} reps` : 'Building baseline'}</div>
      </div>
      <div class="overload-status ${overload.statusClass||''}">${overload.title||'Building baseline'}</div>
    </div>
    ${overload.baseline!=null ? `<div class="overload-detail">
      <div class="overload-chip">Baseline: ${fmtRepValue(overload.currentWeight)} kg &times; ${fmtRepValue(overload.baseline)} reps</div>
      <div class="overload-chip">Latest: ${fmtRepValue(overload.currentWeight)} kg &times; ${fmtRepValue(overload.currentReps)} reps</div>
    </div>` : ''}
    ${overload.status==='watch' ? `<div class="overload-progress"><span style="width:${Math.min(100,((overload.followups||0)/3)*100)}%"></span></div>` : ''}
    <div class="overload-note">${String(overload.note||'').split('|').map((part,i)=>i===0 ? `<div class="overload-note-main">${part}</div>` : `<div class="overload-note-meta">${part}</div>`).join('')}</div>
  </div>`;

  // ---- metric toggle + line chart (top weight & volume per session) ----
  html += `<div class="card">
    <div class="card-title">Session trend</div>
    <div class="segmented" id="p-metric">
      <button data-m="weight" class="${state.progressMetric==='weight'?'active':''}">Top weight</button>
      <button data-m="volume" class="${state.progressMetric==='volume'?'active':''}">Volume</button>
      <button data-m="reps" class="${state.progressMetric==='reps'?'active':''}">Avg reps</button>
    </div>
    <div class="chart-wrap"><canvas id="chart-line" role="img" aria-label="Line chart of ${state.progressMetric} over time for ${esc(exList.find(e=>e.id===state.progressExerciseId).name)}">Session trend chart.</canvas></div>
  </div>`;

  // ---- scatter weight vs reps ----
  html += `<div class="card">
    <div class="card-title">Weight vs reps (every set)</div>
    <div class="chart-wrap"><canvas id="chart-scatter" role="img" aria-label="Scatter plot of weight versus reps for every logged set">Weight vs reps scatter plot.</canvas></div>
  </div>`;

  // ---- avg reps by weight bar ----
  const byWeight = {};
  sets.forEach(s=>{ (byWeight[s.weight]=byWeight[s.weight]||[]).push(s.reps); });
  const weightKeys = Object.keys(byWeight).map(Number).sort((a,b)=>a-b);
  if(weightKeys.length>=2){
    html += `<div class="card">
      <div class="card-title">Average reps by weight used</div>
      <div class="chart-wrap"><canvas id="chart-bar" role="img" aria-label="Bar chart of average reps for each weight used">Average reps by weight bar chart.</canvas></div>
    </div>`;
  }

  $main.innerHTML = html;
  bindProgressModeSwitcher();
  bindProgressSelectors();

  document.querySelectorAll('#p-metric button').forEach(b=> b.onclick = ()=>{ state.progressMetric=b.dataset.m; renderProgress(); });

  // build datasets
  const sessionRows = sessionDates.map(d=>{
    const daySets = sessionsMap[d];
    return {
      date:d,
      topWeight: Math.max(...daySets.map(s=>s.weight)),
      volume: daySets.reduce((a,s)=>a+s.weight*s.reps,0),
      avgReps: +(daySets.reduce((a,s)=>a+s.reps,0)/daySets.length).toFixed(1)
    };
  });
  const metricKey = state.progressMetric==='weight'?'topWeight':state.progressMetric==='volume'?'volume':'avgReps';
  const metricLabel = state.progressMetric==='weight'?'Top weight (kg)':state.progressMetric==='volume'?'Volume (kg)':'Avg reps';

  destroyCharts();
  charts.line = new Chart(document.getElementById('chart-line'), {
    type:'line',
    data:{ labels: sessionRows.map(r=>fmtDate(r.date)),
      datasets:[{ label:metricLabel, data: sessionRows.map(r=>r[metricKey]), borderColor:'#E8B32C', backgroundColor:'rgba(232,179,44,0.1)',
        borderWidth:2, pointRadius:4, pointBackgroundColor:'#E8B32C', pointBorderColor:'#1B1E23', pointBorderWidth:2, fill:true, tension:0.25 }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{ x:{ ticks:{color:'#9A9FA6',font:{size:10.5}}, grid:{color:'#2E333A'} },
               y:{ ticks:{color:'#9A9FA6',font:{size:10.5}}, grid:{color:'#2E333A'}, beginAtZero:true } } }
  });

  charts.scatter = new Chart(document.getElementById('chart-scatter'), {
    type:'scatter',
    data:{ datasets:[{ label:'Sets', data: sets.map(s=>({x:s.weight,y:s.reps})), backgroundColor:'#C1543A', borderColor:'#C1543A',
      pointRadius:5, pointHoverRadius:6 }]},
    options:{ responsive:true, maintainAspectRatio:false, layout:{padding:12},
      plugins:{ legend:{display:false} },
      scales:{ x:{ title:{display:true,text:'Weight (kg)',color:'#9A9FA6',font:{size:11}}, ticks:{color:'#9A9FA6',font:{size:10.5}}, grid:{color:'#2E333A'} },
               y:{ title:{display:true,text:'Reps',color:'#9A9FA6',font:{size:11}}, ticks:{color:'#9A9FA6',font:{size:10.5}}, grid:{color:'#2E333A'}, beginAtZero:true } } }
  });

  if(weightKeys.length>=2){
    const avgRepsByWeight = weightKeys.map(w=> +(byWeight[w].reduce((a,b)=>a+b,0)/byWeight[w].length).toFixed(1));
    charts.bar = new Chart(document.getElementById('chart-bar'), {
      type:'bar',
      data:{ labels: weightKeys.map(w=>w+'kg'), datasets:[{ label:'Avg reps', data: avgRepsByWeight, backgroundColor:'#6FA97B', borderRadius:4, maxBarThickness:28 }]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false} },
        scales:{ x:{ ticks:{color:'#9A9FA6',font:{size:10.5}}, grid:{display:false} },
                 y:{ ticks:{color:'#9A9FA6',font:{size:10.5}}, grid:{color:'#2E333A'}, beginAtZero:true } } }
    });
  }
}

/* ============ PROGRESS: DAY / SESSION REPORT ============ */
function progressScoreRingSvg(pct){
  const r = 32, c = 2*Math.PI*r;
  const off = c * (1 - Math.max(0,Math.min(100,pct))/100);
  const color = pct>=75 ? 'var(--good)' : pct>=45 ? 'var(--accent)' : 'var(--rust)';
  return `<svg viewBox="0 0 78 78">
    <circle cx="39" cy="39" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="7"/>
    <circle cx="39" cy="39" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
  </svg>`;
}
function renderProgressDayMode(){
  setHeader('Progress', 'Day performance', null, null);
  destroyCharts(); // clear any charts left over from another Progress mode
  let html = buildProgressModeSwitcherHtml();

  const sessions = allLoggedSessions();
  if(!sessions.length){
    html += `<div class="empty"><p>No logged sessions yet. Log a workout from the Log tab to see day-level analytics here.</p></div>`;
    $main.innerHTML = html; bindProgressModeSwitcher(); return;
  }

  if(!state.progressDaySessionDate || !sessions.some(s=>s.date===state.progressDaySessionDate)){
    state.progressDaySessionDate = sessions[sessions.length-1].date; // most recent
  }
  const descDates = sessions.slice().reverse();
  html += `<div class="card">
    <div class="card-title">Session</div>
    <select id="p-day-session">
      ${descDates.map(s=>`<option value="${s.date}" ${s.date===state.progressDaySessionDate?'selected':''}>${fmtDate(s.date)} &middot; ${esc(s.dayName)}</option>`).join('')}
    </select>
  </div>`;

  const session = sessionByDate(state.progressDaySessionDate);
  const daySessions = session.dayId ? sessionsForDay(session.dayId) : [session];
  const occIndex = daySessions.findIndex(s=>s.date===session.date);
  const prevOcc = occIndex>0 ? daySessions[occIndex-1] : null;

  // ---- overview metrics ----
  const totalVolume = session.volume;
  const totalSets = session.setCount;
  const totalReps = session.repCount;
  const exCount = session.exercises.length;
  const avgWeight = totalSets ? (session.sets.reduce((a,s)=>a+s.weight,0)/totalSets) : 0;
  const avgReps = totalSets ? (totalReps/totalSets) : 0;

  // PRs achieved this session: exercise's top weight this session ties/exceeds
  // its all-time-best weight as of this date (using existing PB logic, no
  // change to how PBs are calculated elsewhere — this just checks the max).
  let prCount = 0; const prExNames = [];
  session.exercises.forEach(ex=>{
    const histSets = setsOfExercise(ex.id).filter(s=>s.date<=session.date);
    if(!histSets.length) return;
    const allTimeBest = Math.max(...histSets.map(s=>s.weight));
    const sessionBest = Math.max(...session.sets.filter(s=>s.exerciseId===ex.id).map(s=>s.weight));
    if(sessionBest>=allTimeBest){ prCount++; prExNames.push(ex.name); }
  });

  // strongest single-set performance this session (by set volume)
  let strongest = null;
  session.sets.forEach(s=>{
    const v = s.weight*s.reps;
    if(!strongest || v>strongest.v) strongest = {v, ex: exerciseById(s.exerciseId), s};
  });

  const volChangePct = prevOcc && prevOcc.volume>0 ? ((totalVolume-prevOcc.volume)/prevOcc.volume*100) : null;
  const setDelta = prevOcc ? totalSets - prevOcc.setCount : null;
  const repsDelta = prevOcc ? +(avgReps - (prevOcc.repCount/prevOcc.setCount)).toFixed(1) : null;

  html += `<div class="card">
    <div class="card-title">Session overview</div>
    <div class="stat-grid">
      <div class="stat-tile"><div class="label">Total volume</div><div class="value">${Math.round(totalVolume).toLocaleString()}<span class="unit">kg</span></div></div>
      <div class="stat-tile"><div class="label">Total sets</div><div class="value">${totalSets}</div><div class="sub">${exCount} exercise${exCount===1?'':'s'}</div></div>
      <div class="stat-tile"><div class="label">Total reps</div><div class="value">${totalReps}</div><div class="sub">avg ${avgReps.toFixed(1)}/set</div></div>
      <div class="stat-tile"><div class="label">Avg weight</div><div class="value">${avgWeight.toFixed(1)}<span class="unit">kg</span></div></div>
      <div class="stat-tile"><div class="label">PRs this session</div><div class="value">${prCount}</div><div class="sub">${prCount ? esc(prExNames.slice(0,2).join(', ')) : '&mdash;'}</div></div>
      <div class="stat-tile"><div class="label">Strongest set</div><div class="value" style="font-size:14px;">${strongest ? esc(strongest.ex.name) : '&mdash;'}</div><div class="sub">${strongest ? `${strongest.s.weight}kg &times; ${strongest.s.reps}` : ''}</div></div>
    </div>
  </div>`;

  // ---- muscle distribution ----
  const muscleVol = {};
  session.sets.forEach(s=>{
    const ex = exerciseById(s.exerciseId); if(!ex) return;
    const g = classifyExercise(ex.name);
    if(!g) return;
    muscleVol[g] = (muscleVol[g]||0) + s.weight*s.reps;
  });
  const muscleKeys = Object.keys(muscleVol);
  html += `<div class="card">
    <div class="card-title">Muscle distribution</div>
    ${muscleKeys.length ? (()=>{
      const max = Math.max(...muscleKeys.map(k=>muscleVol[k]));
      return STATS_GROUPS.filter(g=>muscleVol[g]).map(g=>`
        <div class="muscle-bar-row">
          <div class="mb-label">${STATS_LABELS[g]}</div>
          <div class="muscle-bar-track"><div class="muscle-bar-fill" style="width:${Math.round(muscleVol[g]/max*100)}%"></div></div>
          <div class="muscle-bar-val">${Math.round(muscleVol[g]).toLocaleString()}kg</div>
        </div>`).join('');
    })() : `<p style="font-size:12.5px;color:var(--text-faint);">Muscle group not classified for the exercises in this session.</p>`}
    ${session.exercises.some(ex=>classificationSource(ex.name)==='unknown') ? `<p style="font-size:11px;color:var(--text-faint);margin-top:8px;">Some exercises here aren't classified yet — classify them from the Split tab to include their volume.</p>` : ''}
  </div>`;

  // ---- session performance score (transparent, only if enough data) ----
  if(!prevOcc && daySessions.length<2){
    html += `<div class="card">
      <div class="card-title">Session performance</div>
      <p style="font-size:12.5px;color:var(--text-faint);">Not enough history for a performance score — this is the first logged occurrence of this day.</p>
    </div>`;
  } else {
    const priorOccs = daySessions.slice(0, occIndex);
    const avgPriorSets = priorOccs.length ? priorOccs.reduce((a,s)=>a+s.setCount,0)/priorOccs.length : totalSets;
    const avgPriorReps = priorOccs.length ? priorOccs.reduce((a,s)=>a+s.repCount/s.setCount,0)/priorOccs.length : avgReps;
    const volumeTrendScore = volChangePct==null ? 50 : Math.max(0,Math.min(100, 50 + volChangePct));
    const setCompletionScore = avgPriorSets>0 ? Math.max(0,Math.min(100, (totalSets/avgPriorSets)*100)) : 50;
    const repPerformanceScore = avgPriorReps>0 ? Math.max(0,Math.min(100, (avgReps/avgPriorReps)*100)) : 50;
    const prScore = prCount>0 ? 100 : 55;
    const components = [
      {label:'Volume trend', v:volumeTrendScore},
      {label:'Set completion', v:setCompletionScore},
      {label:'Rep performance', v:repPerformanceScore},
      {label:'PRs achieved', v:prScore}
    ];
    const overall = Math.round(components.reduce((a,c)=>a+c.v,0)/components.length);
    html += `<div class="card">
      <div class="card-title">Session performance</div>
      <div class="score-ring-row">
        <div class="score-ring">${progressScoreRingSvg(overall)}<div class="ring-num">${overall}</div></div>
        <div class="score-components">
          ${components.map(c=>`<div class="score-comp-row"><span>${c.label}</span><b>${Math.round(c.v)}</b></div>`).join('')}
        </div>
      </div>
      <p style="font-size:10.5px;color:var(--text-faint);margin-top:10px;line-height:1.4;">A transparent composite of the components above — not a scientific fitness score, just a quick read on how this session compares with your own history for this day.</p>
    </div>`;
  }

  // ---- comparison vs previous occurrence ----
  html += `<div class="card">
    <div class="card-title">Vs. previous occurrence of this day</div>
    ${prevOcc ? `
      <div class="compare-row"><span class="cr-label">Volume</span><span class="cr-val" style="color:${volChangePct>0?'var(--good)':volChangePct<0?'var(--rust)':'var(--text)'}">${volChangePct==null?'&mdash;':(volChangePct>=0?'+':'')+volChangePct.toFixed(1)+'%'}</span></div>
      <div class="compare-row"><span class="cr-label">Sets</span><span class="cr-val" style="color:${setDelta>0?'var(--good)':setDelta<0?'var(--rust)':'var(--text)'}">${setDelta>=0?'+':''}${setDelta}</span></div>
      <div class="compare-row"><span class="cr-label">Avg reps</span><span class="cr-val" style="color:${repsDelta>0?'var(--good)':repsDelta<0?'var(--rust)':'var(--text)'}">${repsDelta>=0?'+':''}${repsDelta}</span></div>
      <div class="compare-row"><span class="cr-label">PRs</span><span class="cr-val">${prCount}</span></div>
      <div class="compare-row"><span class="cr-label">Previous occurrence</span><span class="cr-val" style="font-size:12px;color:var(--text-faint);">${fmtDate(prevOcc.date)}</span></div>
    ` : `<p style="font-size:12.5px;color:var(--text-faint);">No previous occurrence of this day to compare against yet.</p>`}
  </div>`;

  // ---- trend chart across occurrences of this day ----
  if(daySessions.length>=2){
    html += `<div class="card">
      <div class="card-title">Volume across occurrences of this day</div>
      <div class="chart-wrap"><canvas id="chart-day-trend" role="img" aria-label="Volume trend across occurrences of this day">Day volume trend chart.</canvas></div>
    </div>`;
  }

  $main.innerHTML = html;
  bindProgressModeSwitcher();
  document.getElementById('p-day-session').onchange = e=>{ state.progressDaySessionDate = e.target.value; render(); };

  if(daySessions.length>=2){
    destroyCharts();
    charts.dayTrend = new Chart(document.getElementById('chart-day-trend'), {
      type:'line',
      data:{ labels: daySessions.map(s=>fmtDate(s.date)), datasets:[{ label:'Volume', data: daySessions.map(s=>Math.round(s.volume)),
        borderColor:'#E8B32C', backgroundColor:'rgba(232,179,44,0.1)', borderWidth:2, pointRadius:4,
        pointBackgroundColor: daySessions.map(s=>s.date===session.date?'#E8B32C':'#5D636B'),
        pointBorderColor:'#1B1E23', pointBorderWidth:2, fill:true, tension:0.25 }]},
      options:{ responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{ legend:{display:false}, tooltip:{mode:'index',intersect:false} },
        scales:{ x:{ ticks:{color:'#9A9FA6',font:{size:10.5}}, grid:{color:'#2E333A'} },
                 y:{ ticks:{color:'#9A9FA6',font:{size:10.5}}, grid:{color:'#2E333A'}, beginAtZero:true } } }
    });
  }
}

/* ============ PROGRESS: SPLIT COMPARISON REPORT ============ */
function exercisesOfSplit(split){
  const dayIds = new Set([...(split.dayIds||[]), ...(split.days||[]).map(d=>d.id)]);
  return DB.exercises.filter(e=> e.splitId===split.id || dayIds.has(e.dayId));
}
function setsOfSplit(split){
  const exIds = new Set(exercisesOfSplit(split).map(e=>e.id));
  return DB.sets.filter(s=>exIds.has(s.exerciseId));
}
function splitAggregateMetrics(split){
  const exs = exercisesOfSplit(split);
  const sets = setsOfSplit(split);
  const sessions = [...new Set(sets.map(s=>s.date))];
  const totalVolume = sets.reduce((a,s)=>a+s.weight*s.reps,0);
  const totalSets = sets.length;
  const totalReps = sets.reduce((a,s)=>a+s.reps,0);
  const avgSessionVolume = sessions.length ? totalVolume/sessions.length : 0;
  // PR count: exercises where the split's own logged max weight equals that
  // exercise's all-time max weight (i.e. the PR happened while on this split).
  let prCount = 0;
  exs.forEach(ex=>{
    const exSets = setsOfExercise(ex.id);
    if(!exSets.length) return;
    const allTimeMax = Math.max(...exSets.map(s=>s.weight));
    const splitSets = sets.filter(s=>s.exerciseId===ex.id);
    if(splitSets.length && Math.max(...splitSets.map(s=>s.weight))>=allTimeMax) prCount++;
  });
  const muscleVol = {};
  sets.forEach(s=>{ const ex=exerciseById(s.exerciseId); if(!ex) return; const g=classifyExercise(ex.name); if(g) muscleVol[g]=(muscleVol[g]||0)+s.weight*s.reps; });
  return { exs, sets, sessions, totalVolume, totalSets, totalReps, avgSessionVolume, prCount, muscleVol,
    frequency: sessions.length };
}
function renderProgressSplitMode(){
  setHeader('Progress', 'Split comparison', null, null);
  destroyCharts(); // clear any charts left over from another Progress mode
  let html = buildProgressModeSwitcherHtml();

  if(DB.splits.length<2){
    html += `<div class="empty"><p>Split comparison needs at least two splits. Create another split to unlock this report.</p></div>`;
    $main.innerHTML = html; bindProgressModeSwitcher(); return;
  }

  const sortedSplits = DB.splits.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(!state.progressSplitAId || !DB.splits.some(s=>s.id===state.progressSplitAId)) state.progressSplitAId = sortedSplits[0].id;
  if(!state.progressSplitBId || !DB.splits.some(s=>s.id===state.progressSplitBId) || state.progressSplitBId===state.progressSplitAId){
    state.progressSplitBId = (sortedSplits.find(s=>s.id!==state.progressSplitAId) || sortedSplits[1]).id;
  }
  const splitA = splitById(state.progressSplitAId);
  const splitB = splitById(state.progressSplitBId);

  html += `<div class="card">
    <div class="card-title">Comparing</div>
    <div class="split-vs-bar">
      <select id="p-splitA">${sortedSplits.map(s=>`<option value="${s.id}" ${s.id===splitA.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>
      <span class="split-vs-x">vs</span>
      <select id="p-splitB">${sortedSplits.map(s=>`<option value="${s.id}" ${s.id===splitB.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>
    </div>
  </div>`;

  const mA = splitAggregateMetrics(splitA);
  const mB = splitAggregateMetrics(splitB);
  const noData = mA.sets.length===0 && mB.sets.length===0;

  if(noData){
    html += `<div class="empty"><p>Neither split has any logged sets yet, so there's nothing to compare.</p></div>`;
    $main.innerHTML = html; bindProgressModeSwitcher();
    document.getElementById('p-splitA').onchange = e=>{ state.progressSplitAId=e.target.value; render(); };
    document.getElementById('p-splitB').onchange = e=>{ state.progressSplitBId=e.target.value; render(); };
    return;
  }

  const fmtN = n => Math.round(n).toLocaleString();
  html += `<div class="card">
    <div class="card-title">Overall metrics</div>
    <div class="split-legend">
      <span><span class="dot" style="background:var(--accent);"></span>${esc(splitA.name)}</span>
      <span><span class="dot" style="background:var(--rust);"></span>${esc(splitB.name)}</span>
    </div>
    ${[
      ['Total volume', fmtN(mA.totalVolume)+'kg', fmtN(mB.totalVolume)+'kg'],
      ['Total sets', mA.totalSets, mB.totalSets],
      ['Total reps', mA.totalReps, mB.totalReps],
      ['Frequency', mA.frequency+' sessions', mB.frequency+' sessions'],
      ['Avg session vol.', fmtN(mA.avgSessionVolume)+'kg', fmtN(mB.avgSessionVolume)+'kg'],
      ['PR count', mA.prCount, mB.prCount]
    ].map(([label,a,b])=>`<div class="split-metric-row"><div class="sm-label">${label}</div><div class="sm-a">${a}</div><div class="sm-b">${b}</div></div>`).join('')}
  </div>`;

  // muscle-group volume comparison
  const muscleKeysUnion = STATS_GROUPS.filter(g=>mA.muscleVol[g] || mB.muscleVol[g]);
  html += `<div class="card">
    <div class="card-title">Muscle-group volume</div>
    ${muscleKeysUnion.length ? muscleKeysUnion.map(g=>{
      const max = Math.max(mA.muscleVol[g]||0, mB.muscleVol[g]||0, 1);
      return `<div class="muscle-bar-row">
        <div class="mb-label">${STATS_LABELS[g]}</div>
        <div class="muscle-bar-track"><div class="muscle-bar-fill" style="width:${Math.round((mA.muscleVol[g]||0)/max*100)}%;background:var(--accent);"></div></div>
        <div class="muscle-bar-val">${fmtN(mA.muscleVol[g]||0)}</div>
      </div>
      <div class="muscle-bar-row" style="margin-top:-2px;">
        <div class="mb-label"></div>
        <div class="muscle-bar-track"><div class="muscle-bar-fill" style="width:${Math.round((mB.muscleVol[g]||0)/max*100)}%;background:var(--rust);"></div></div>
        <div class="muscle-bar-val">${fmtN(mB.muscleVol[g]||0)}</div>
      </div>`;
    }).join('') : `<p style="font-size:12.5px;color:var(--text-faint);">No classified muscle-group volume to show for either split yet.</p>`}
  </div>`;

  // shared vs split-specific exercises
  const normNameOf = ex => normalizeExerciseName(ex.name);
  const namesA = new Map(); mA.exs.forEach(e=>{ const k=normNameOf(e); if(!namesA.has(k)) namesA.set(k, []); namesA.get(k).push(e); });
  const namesB = new Map(); mB.exs.forEach(e=>{ const k=normNameOf(e); if(!namesB.has(k)) namesB.set(k, []); namesB.get(k).push(e); });
  const sharedKeys = [...namesA.keys()].filter(k=>namesB.has(k) && k);
  const onlyA = [...namesA.keys()].filter(k=>!namesB.has(k) && k).map(k=>namesA.get(k)[0].name);
  const onlyB = [...namesB.keys()].filter(k=>!namesA.has(k) && k).map(k=>namesB.get(k)[0].name);

  html += `<div class="card">
    <div class="card-title">Shared vs. split-specific exercises</div>
    ${sharedKeys.length ? `<p style="font-size:11.5px;color:var(--text-faint);margin-bottom:4px;">Shared (${sharedKeys.length})</p>
      <div class="shared-ex-chip-list">${sharedKeys.map(k=>`<span class="ex-chip">${esc(namesA.get(k)[0].name)}</span>`).join('')}</div>` : `<p style="font-size:12.5px;color:var(--text-faint);">No shared exercises to compare.</p>`}
    ${onlyA.length ? `<p style="font-size:11.5px;color:var(--text-faint);margin:10px 0 4px;">Only in ${esc(splitA.name)}</p><div class="uniq-ex-chip-list">${onlyA.map(n=>`<span class="ex-chip">${esc(n)}</span>`).join('')}</div>` : ''}
    ${onlyB.length ? `<p style="font-size:11.5px;color:var(--text-faint);margin:10px 0 4px;">Only in ${esc(splitB.name)}</p><div class="uniq-ex-chip-list">${onlyB.map(n=>`<span class="ex-chip">${esc(n)}</span>`).join('')}</div>` : ''}
  </div>`;

  // same-exercise progression comparison (pick first shared exercise with sets in both, or let user pick)
  if(!state.progressSplitSharedKey || !sharedKeys.includes(state.progressSplitSharedKey)){
    state.progressSplitSharedKey = sharedKeys.find(k=> namesA.get(k).some(e=>setsOfExercise(e.id).some(s=>s.date)) ) || sharedKeys[0] || null;
  }
  if(sharedKeys.length){
    html += `<div class="card">
      <div class="card-title">Same-exercise progression</div>
      <select id="p-shared-ex" style="margin-bottom:8px;">
        ${sharedKeys.map(k=>`<option value="${k}" ${k===state.progressSplitSharedKey?'selected':''}>${esc(namesA.get(k)[0].name)}</option>`).join('')}
      </select>
      <div class="chart-wrap"><canvas id="chart-split-shared" role="img" aria-label="Weight progression comparison between the two splits for this exercise">Shared exercise progression chart.</canvas></div>
      <div id="p-shared-ex-note"></div>
    </div>`;
  }

  $main.innerHTML = html;
  bindProgressModeSwitcher();
  document.getElementById('p-splitA').onchange = e=>{ state.progressSplitAId=e.target.value; if(state.progressSplitAId===state.progressSplitBId) state.progressSplitBId=null; render(); };
  document.getElementById('p-splitB').onchange = e=>{ state.progressSplitBId=e.target.value; if(state.progressSplitBId===state.progressSplitAId) state.progressSplitAId=null; render(); };
  const sharedSel = document.getElementById('p-shared-ex');
  if(sharedSel) sharedSel.onchange = e=>{ state.progressSplitSharedKey=e.target.value; render(); };

  if(sharedKeys.length && state.progressSplitSharedKey){
    const exsA = namesA.get(state.progressSplitSharedKey) || [];
    const exsB = namesB.get(state.progressSplitSharedKey) || [];
    const setsA = exsA.flatMap(e=>setsOfExercise(e.id)).sort((a,b)=>a.date<b.date?-1:1);
    const setsB = exsB.flatMap(e=>setsOfExercise(e.id)).sort((a,b)=>a.date<b.date?-1:1);
    const byDateMax = arr=>{ const m={}; arr.forEach(s=>{ m[s.date]=Math.max(m[s.date]||0, s.weight); }); return m; };
    const mapA = byDateMax(setsA), mapB = byDateMax(setsB);
    const allDates = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])].sort();
    const note = document.getElementById('p-shared-ex-note');
    if(!allDates.length){
      if(note) note.innerHTML = `<p style="font-size:12.5px;color:var(--text-faint);margin-top:8px;">No logged sets for this exercise in either split yet.</p>`;
    } else {
      destroyCharts();
      charts.splitShared = new Chart(document.getElementById('chart-split-shared'), {
        type:'line',
        data:{ labels: allDates.map(fmtDate), datasets:[
          { label:esc(splitA.name), data: allDates.map(d=>mapA[d] ?? null), borderColor:'#E8B32C', backgroundColor:'rgba(232,179,44,0.1)', borderWidth:2, pointRadius:3, spanGaps:true, tension:0.25 },
          { label:esc(splitB.name), data: allDates.map(d=>mapB[d] ?? null), borderColor:'#C1543A', backgroundColor:'rgba(193,84,58,0.1)', borderWidth:2, pointRadius:3, spanGaps:true, tension:0.25 }
        ]},
        options:{ responsive:true, maintainAspectRatio:false,
          interaction:{ mode:'index', intersect:false },
          plugins:{ legend:{display:true, labels:{color:'#9A9FA6',font:{size:10.5}}}, tooltip:{mode:'index',intersect:false} },
          scales:{ x:{ ticks:{color:'#9A9FA6',font:{size:10.5}}, grid:{color:'#2E333A'} },
                   y:{ ticks:{color:'#9A9FA6',font:{size:10.5}}, grid:{color:'#2E333A'}, title:{display:true,text:'Weight (kg)',color:'#9A9FA6',font:{size:11}} } } }
      });
    }
  }
}

function bindProgressSelectors(){
  const ps = document.getElementById('p-split');
  if(ps) ps.onchange = e=>{ state.progressSplitId=e.target.value; state.progressExerciseId=null; render(); };
  const pe = document.getElementById('p-exercise');
  if(pe) pe.onchange = e=>{ state.progressExerciseId=e.target.value; render(); };
}

function destroyCharts(){ Object.values(charts).forEach(c=>{ if(c) c.destroy(); }); charts={}; }

/* ============ INIT ============ */
(async function init(){
  await loadAll();
  await applySmartLogDefault();
  registerPWA();
  render();
})();
