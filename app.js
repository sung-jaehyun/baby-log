'use strict';
/* 아기 기록 앱 - 화면 코드
   원칙: 누르면 화면에 즉시 반영하고, 서버 저장은 뒤에서(대기열) 처리한다. */

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

/* ---------- 시간 도우미 ---------- */
const pad = (n) => String(n).padStart(2, '0');
const dkey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dstart = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dkey(new Date(y, m - 1, d + n, 12).getTime()); };
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const minOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const at = (key, s) => { const [y, m, d] = key.split('-').map(Number); const mm = toMin(s); return new Date(y, m - 1, d, Math.floor(mm / 60), mm % 60).getTime(); };
const minTxt = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}시간 ${r}분` : `${h}시간`) : `${r}분`; };
const minShort = (m) => { m = Math.max(0, Math.round(m)); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = (key) => { const [y, m, d] = key.split('-').map(Number); return `${m}월 ${d}일 (${WEEK[new Date(y, m - 1, d).getDay()]})`; };
const toLocalInput = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${dkey(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = (v) => { if (!v) return null; const [a, b] = v.split('T'); return at(a, b); };
/* 기록의 날짜 키는 한 번만 계산해 기억(화면 그릴 때마다 수천 번 반복되므로) */
const dk = (r) => (r._dks === r.start ? r._dk : (r._dks = r.start, r._dk = dkey(r.start)));
const uid = () => Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 8);

/* ---------- 상태 ---------- */
const API_URL = (window.BABY_CONFIG && window.BABY_CONFIG.apiUrl) || '';
const S = {
  auth: LS.get('auth', null),
  settings: {}, plans: {}, apply: [], users: [], recs: {}, memos: {},
  serverTime: 0, loadedFrom: 0,
  queue: LS.get('queue', []).map((q) => Object.assign(q, { sending: false })),
  failed: LS.get('failed', []), rev: 0,
  tab: 'home', day: dkey(Date.now()),
  logLines: null, editPlan: null,
  _sorted: null,
};
const DEF = { babyName: '', birthDate: '2026-07-30', feedPresets: '105,135,150,170,200', nightStart: '19:00', nightEnd: '07:00', tempWarn: '37.5', tempHigh: '38.0', showFood: 'false', nightMode: 'start', rvType: '', jeType: '' };
const set = (k) => (S.settings[k] ?? DEF[k]);

function loadCache() {
  const c = LS.get('cache', null);
  if (!c) return false;
  Object.assign(S, { settings: c.settings || {}, plans: c.plans || {}, apply: c.apply || [], users: c.users || [], memos: c.memos || {}, serverTime: c.serverTime || 0, loadedFrom: c.loadedFrom || 0 });
  S.recs = {}; (c.recs || []).forEach((r) => { S.recs[r.id] = r; });
  dirty();
  return true;
}
let cacheTimer = 0;
function saveCache() {
  clearTimeout(cacheTimer);
  // 휴대폰이 한가할 때 저장(누르는 순간 버벅이지 않게). 앱이 가려질 때는 바로 저장
  cacheTimer = setTimeout(() => {
    if (window.requestIdleCallback) requestIdleCallback(writeCache, { timeout: 2000 }); else writeCache();
  }, 600);
}
function writeCache() {
  clearTimeout(cacheTimer);
  const cut = Date.now() - 60 * DAY;
  LS.set('cache', { settings: S.settings, plans: S.plans, apply: S.apply, users: S.users, memos: S.memos, serverTime: S.serverTime,
    loadedFrom: Math.max(S.loadedFrom, cut), recs: Object.values(S.recs).filter((r) => r.start >= cut || LONG_TYPES.has(r.type)) });
}
function dirty() { S._sorted = null; S._sleeps = null; S._idx = null; }
/* 날짜별·밤별 기록 목록을 한 번 만들어 두고 화면 그릴 때 다시 쓴다(기록이 바뀌면 dirty()로 새로 만듦) */
function idx() {
  if (S._idx) return S._idx;
  const day = new Map(), night = new Map();
  live().forEach((r) => {
    const k = dk(r); if (!day.has(k)) day.set(k, []); day.get(k).push(r);
    if (r.type === 'sleep' && r.kind === '밤') { const n = nightOf(r); if (!night.has(n)) night.set(n, []); night.get(n).push(r); }
  });
  return (S._idx = { day, night });
}
const dayRecs = (key) => idx().day.get(key) || [];
const nightRecs = (key) => idx().night.get(key) || [];
function live() {
  if (!S._sorted) S._sorted = Object.values(S.recs).filter((r) => !r.deleted && r.start).sort((a, b) => a.start - b.start);
  return S._sorted;
}

/* ---------- 서버 통신 ---------- */
async function call(action, data, auth = S.auth) {
  if (!auth) { const e = new Error('로그인이 필요해요'); e.code = 'pin'; throw e; }
  if (auth.url === 'demo') {
    const t0 = Date.now();
    try { const j = await DEMO.call(action, data, auth.pin); S.api = j.api || 1; gotMeta(j, t0); return j; } catch (e) { e.pinUsed = auth.pin; throw e; }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 40000), t0 = Date.now();
  try {
    const res = await fetch(auth.url, { method: 'POST', body: JSON.stringify({ action, pin: auth.pin, data }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctrl.signal });
    const j = await res.json();
    if (!j.ok) { const e = new Error(j.err || '서버 오류'); e.server = true; e.code = j.code || 'error'; e.pinUsed = auth.pin; throw e; }
    S.api = j.api || 1;
    gotMeta(j, t0);
    return j;
  } finally { clearTimeout(t); }
}
/* 관리자가 기록을 지우면(서버의 reset 시각이 바뀌면) 이 휴대폰 저장본도 비우고 새로 받는다.
   지우기 전에 만든 저장 대기 기록은 버린다(서버도 받지 않음). 지운 뒤에 만든 것만 남긴다. */
/* 서버마다 따로 기억(데모 ↔ 실제 서버를 바꿔도 섞이지 않게) */
const resetKey = () => `resetAt:${S.auth ? S.auth.url : ''}`;
function seenReset(t, scope, quiet) {
  if (t == null || !S.auth) return;
  t = Number(t) || 0;
  const known = LS.get(resetKey(), null);
  if (known === t) return;
  if (known != null && t < known) return;   // 늦게 도착한 옛 응답: 무시
  LS.set(resetKey(), t);
  if (t === 0) return;   // 지운 적 없음
  // 지우기 전에 만든 '새 기록'·'하루 메모'만 버린다(수정·삭제는 서버가 판단). 매일 기록만 지웠으면 성장 기록은 남김
  const skew = S.skew || 0, keepGrowth = scope !== 'all';
  const stale = (o) => {
    if (o.op !== 'add' && o.op !== 'memo') return false;
    if (o.op === 'add' && keepGrowth && o.rec && GROWTH_ONLY.has(o.rec.type)) return false;
    const ts = Number(o.at || (o.rec && o.rec.created) || 0);
    return ts ? ts + skew <= t : o.op === 'add';
  };
  S.queue = S.queue.filter((o) => !stale(o)); S.failed = S.failed.filter((o) => !stale(o));
  saveQueue();
  if (quiet) return;   // 로그인 직후: 곧 전체를 새로 받으므로 기억만
  const keep = new Set(S.queue.map((q) => q.id));
  Object.keys(S.recs).forEach((id) => { if (!keep.has(id)) delete S.recs[id]; });
  Object.keys(S.memos).forEach((k) => { if (!keep.has(k)) delete S.memos[k]; });
  S.serverTime = 0; S.loadedFrom = 0; S.rev = 0; S.wipeN = (S.wipeN || 0) + 1; S.loading = true;
  dirty(); writeCache();
  if (known != null && !S.resetting) note('관리자가 기록을 지웠어요. 새로 불러올게요.');
  (function again() { if (syncing) setTimeout(again, 400); else sync(true).finally(() => { S.loading = false; bgRender(); }); })();
}
/* 응답마다: 서버 시계와의 차이(기록 지우기 판단용), 기록 지우기 여부 */
function gotMeta(j, t0) {
  if (j.now) S.skew = j.now - (t0 + Date.now()) / 2;
  seenReset(j.reset, j.resetScope);
}
/* 이 기록이 마지막 기록 지우기 전에 만든 것인가(그렇다면 서버에서 지워진 것) */
function wipedRec(id) {
  const t = LS.get(resetKey(), 0), r = S.recs[id];
  if (!t || !r) return false;
  const ts = Number(r.created || r.start || 0);
  return ts > 0 && ts + (S.skew || 0) <= t;
}
const errMsg = (e) => (e.server ? e.message : '연결이 안 돼요. 잠시 후 다시 해주세요.');
/* 지금 쓰는 PIN으로 보낸 요청이 거절됐을 때만 로그아웃(내가 PIN을 바꾸는 중 엇갈린 요청은 무시) */
const isAuthErr = (e) => (e.code === 'pin' || e.code === 'locked') && S.auth && e.pinUsed === S.auth.pin && !S.pinChanging;

/* 서버 사본은, 요청을 보낸 뒤에 이 기기에서 고친 기록을 덮어쓰지 않는다(늦게 도착한 옛 응답 방지) */
function mergeRecs(list, sentAt = 0) {
  const busy = new Set(S.queue.map((q) => q.id));
  list.forEach((r) => {
    const local = S.recs[r.id];
    if (busy.has(r.id) || (local && local._local && local._local >= sentAt)) return;
    S.recs[r.id] = r;
  });
  dirty();
}
/* 다른 기기에서 PIN이 바뀐 경우: 저장 대기 기록은 지우지 않고 다시 로그인하면 이어서 올린다 */
function authFailed(msg) {
  S.auth = null; LS.del('auth'); pinBuf = ''; closeSheet(); closeToast();
  render(true);
  const m = $('#loginMsg'); if (m) m.textContent = msg || 'PIN이 바뀌었거나 사용이 중지됐어요. 다시 입력해주세요.';
}
function applyMeta(d, full) {
  if (d.settings) S.settings = d.settings;
  if (d.plans) S.plans = d.plans;
  if (d.apply) S.apply = d.apply;
  if (d.users) S.users = d.users;
  if (d.memos) {
    const busy = new Set(S.queue.filter((q) => q.op === 'memo').map((q) => q.id));
    // 전체를 받을 때는 서버에 없는 메모(지워진 것)를 빼고 서버 것으로 맞춤. 아직 올라가지 않은 메모만 남김
    if (full) Object.keys(S.memos).forEach((k) => { if (!busy.has(k) && !(k in d.memos)) delete S.memos[k]; });
    Object.keys(d.memos).forEach((k) => { if (!busy.has(k)) S.memos[k] = d.memos[k]; });
  }
}

let syncing = false, lastSync = 0;
async function sync(full) {
  if (!S.auth || syncing) return;
  syncing = true;
  try {
    await flush();
    if (!S.auth) return;
    if (S.pinChanging) return;
    const isFull = full || !S.serverTime;
    const sentAt = Date.now(), wipe0 = S.wipeN || 0;
    const j = isFull ? await call('load', {}) : await call('sync', { since: S.serverTime - 3 * MIN, rev: S.rev || 0 });
    if (!S.auth) return;
    if ((S.wipeN || 0) !== wipe0) return;   // 응답 도중 기록 지우기를 알게 됨: 이 응답은 버리고 새로 전체를 받음
    lastSync = Date.now();
    if ((!j.api || j.api < 3) && S.auth.url !== 'demo' && !S.apiWarned) { S.apiWarned = true; note('서버 코드를 새 버전으로 배포해주세요 (성장 기록 보관)'); }
    if (!isFull && j.data.same) { S.rev = j.rev; return; }
    if (isFull) {
      const keep = new Set([...S.queue, ...S.failed].map((q) => q.id));
      const oldServer = !j.api || j.api < 3;   // 옛 서버는 오래된 성장 기록을 안 보내므로 지우지 않음
      Object.keys(S.recs).forEach((id) => { const r = S.recs[id]; if (!keep.has(id) && !(r._local && r._local >= sentAt) && !(oldServer && LONG_TYPES.has(r.type))) delete S.recs[id]; });
      S.loadedFrom = j.now - 45 * DAY;
    }
    applyMeta(j.data, isFull);
    mergeRecs(j.data.recs || [], sentAt);
    S.serverTime = j.now; S.rev = j.rev;
    if (j.user && j.user !== S.auth.user) { S.auth.user = j.user; LS.set('auth', S.auth); }
    saveCache();
    bgRender();
  } catch (e) {
    if (isAuthErr(e)) authFailed(e.code === 'locked' ? e.message : null);
  } finally { syncing = false; }
}
/* 화면을 막지 않고, 최근 동기화가 오래됐으면 조용히 새로 받아온다 */
function quickSync() { if (Date.now() - lastSync > 15000) sync(); }

/* 기록 저장 대기열: 같은 기록에 대한 변경은 합쳐서 보낸다 */
function enqueue(op) {
  op.at = Date.now();   // 만든 시각: 기록 지우기 전에 만든 것인지 서버가 판단
  const q = S.queue;
  if (op.op === 'update') {
    const add = q.find((x) => x.op === 'add' && x.id === op.id && !x.sending);
    if (add) Object.assign(add.rec, op.rec);
    else {
      const up = q.find((x) => x.op === 'update' && x.id === op.id && !x.sending);
      if (up) Object.assign(up.rec, op.rec); else q.push(op);
    }
  } else if (op.op === 'remove') {
    const i = q.findIndex((x) => x.op === 'add' && x.id === op.id && !x.sending);
    if (i >= 0) { S.queue = q.filter((x) => x.id !== op.id || x.sending); }
    else { S.queue = q.filter((x) => !(x.op === 'update' && x.id === op.id && !x.sending)); S.queue.push(op); }
  } else if (op.op === 'memo') {
    const m = q.find((x) => x.op === 'memo' && x.id === op.id && !x.sending);
    if (m) { m.text = op.text; m.at = op.at; } else q.push(op);
  } else q.push(op);
  LS.set('queue', S.queue);
  scheduleFlush();
}
let flushTimer = 0, flushing = null, retryDelay = 0;
function scheduleFlush(ms = 1200) { clearTimeout(flushTimer); flushTimer = setTimeout(() => flush(), ms); }
const saveQueue = () => { LS.set('queue', S.queue); LS.set('failed', S.failed); };
/* 대기열을 한 번에 묶어 보낸다. 일시적 오류는 계속 재시도하고, 기록은 절대 버리지 않는다.
   5번 넘게 거절된 것만 '저장 못 한 기록'으로 옮겨 설정에서 다시 시도/버리기를 고를 수 있게 한다. */
async function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    while (S.queue.length && S.auth && !S.pinChanging) {
      const ops = S.queue.slice(0, 25);
      ops.forEach((o) => { o.sending = true; });
      let j;
      const wipe0 = S.wipeN || 0;
      try {
        j = await call('batch', { now: Date.now(), ops: ops.map((o) => ({ op: o.op, id: o.id, rec: o.rec, text: o.text, at: o.at })) });
      } catch (e) {
        ops.forEach((o) => { o.sending = false; });
        saveQueue();
        if (isAuthErr(e)) authFailed(e.code === 'locked' ? e.message : null);
        else {
          if (e.code === 'error') note('저장이 안 되고 있어요: ' + e.message);
          retryDelay = Math.min((retryDelay || 4000) * 2, 120000); scheduleFlush(retryDelay);
        }
        break;
      }
      retryDelay = 0;
      const results = (j.data && j.data.results) || [];
      const done = new Set();
      let again = false;
      ops.forEach((o, i) => {
        const r = results[i] || { ok: false, code: 'retry' };
        o.sending = false;
        if (r.ok) {
          done.add(o);
          // 응답 도중 기록 지우기를 알게 됐으면, 옛 사본을 화면에 되살리지 않는다(곧 전체를 새로 받음)
          if (r.rec && (S.wipeN || 0) === wipe0 && !S.queue.some((x) => x !== o && x.id === o.id)) {
            // 이 기기에서 고친 시각 표시는 유지: 동시에 진행 중이던 옛 동기화 응답이 덮어쓰지 못하게
            const prev = S.recs[r.rec.id];
            if (prev && prev._local) r.rec._local = prev._local;
            S.recs[r.rec.id] = r.rec; dirty();
          }
        } else if (r.code === 'reset') done.add(o);   // 기록 지우기 전에 만든 변경: 버림
        else if (r.code === 'notfound' && (o.op === 'update' || o.op === 'remove') && wipedRec(o.id)) done.add(o);   // 기록 지우기로 없어진 기록을 고친 것: 버림
        else if (r.code === 'retry') again = true;
        else {
          o.tries = (o.tries || 0) + 1;
          if (o.tries >= 5) { done.add(o); S.failed.push(Object.assign({}, o, { err: r.err })); note('저장 못 한 기록이 있어요. 설정에서 확인해주세요.'); }
          else again = true;
        }
      });
      S.queue = S.queue.filter((o) => !done.has(o));
      saveQueue();
      if (again) { scheduleFlush(8000); break; }
    }
    saveCache();
    if (S.tab === 'home' || S.tab === 'settings') bgRender();
  })();
  try { await flushing; } finally { flushing = null; }
}

/* ---------- 일정·계산 ---------- */
function planFor(key) {
  const list = [...S.apply].filter((a) => a.plan).sort((a, b) => (a.from < b.from ? -1 : 1));
  let p = null;
  list.forEach((a) => { if (a.from <= key) p = a; });
  if (!p) p = list[0];
  const raw = (p && p.plan) || S.plans['낮잠 4회'] || { wake: '07:00', bed: '19:40', bath: '19:00', feedInterval: 180, feeds: [], naps: [] };
  return planInfo(raw, p ? p.name : '');
}
function planInfo(p, name) {
  const naps = (p.naps || []).map(([s, e, mx]) => ({ s: toMin(s), e: toMin(e), max: mx ? Number(mx) : null }));
  const wake = toMin(p.wake), bed = toMin(p.bed);
  const ww = []; let prev = wake;
  naps.forEach((n) => { ww.push(n.s - prev); prev = n.e; });
  ww.push(bed - prev);
  return { name, raw: p, naps, wake, bed, bath: p.bath ? toMin(p.bath) : null, ww, interval: Number(p.feedInterval) || 180,
    feeds: (p.feeds || []).map(([t, l]) => ({ t: toMin(t), l })) };
}
function isNightTime(ms) {
  const m = minOfDay(ms), ns = toMin(set('nightStart')), ne = toMin(set('nightEnd'));
  return ns > ne ? (m >= ns || m < ne) : (m >= ns && m < ne);
}
/* 깰 때 다시 판단: 잔 시간의 절반 이상이 밤 시간대면 밤잠 (예: 18:50에 잠들어 아침까지 → 밤잠) */
function sleepKind(s, e) {
  let n = 0, t = 0;
  for (let x = s; x < e; x += 5 * MIN) { t++; if (isNightTime(x)) n++; }
  return t && n / t >= 0.5 ? '밤' : '낮';
}
const nightOf = (r) => (r._nks === r.start ? r._nk : (r._nks = r.start, r._nk = minOfDay(r.start) < 12 * 60 ? addDays(dk(r), -1) : dk(r)));
const sleepEnd = (r, now) => r.end || now;
const sleeps = () => S._sleeps || (S._sleeps = live().filter((r) => r.type === 'sleep'));
const openSleep = () => { const s = sleeps(); for (let i = s.length - 1; i >= 0; i--) if (!s[i].end) return s[i]; return null; };
const lastOf = (type, fn) => { const l = live(); for (let i = l.length - 1; i >= 0; i--) if (l[i].type === type && (!fn || fn(l[i]))) return l[i]; return null; };
const isPoop = (r) => r.d1 === '대변' || r.d1 === '둘다';
const WARN_COLORS = ['흰색·회색', '빨강', '검정'];

function morningWake(key) {
  let w = null;
  nightRecs(addDays(key, -1)).forEach((r) => { if (r.end && (!w || r.end > w)) w = r.end; });
  return w;
}
function dayNaps(key) { return dayRecs(key).filter((r) => r.type === 'sleep' && r.kind === '낮'); }
/* 겹치는 잠(두 기기가 따로 기록한 경우 등)은 합쳐서 한 번만 센다. [시작,끝] 목록 → 합친 구간 */
function unionSpans(spans) {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  s.forEach(([a, b]) => { const l = out[out.length - 1]; if (l && a < l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); });
  return out;
}
const spanMin = (spans) => spans.reduce((t, [a, b]) => t + (b - a), 0) / MIN;
function nightStats(key) {
  const now = Date.now();
  if (set('nightMode') === 'midnight') {
    const a = dstart(key), b = dstart(addDays(key, 1));
    const nights = sleeps().filter((r) => r.kind === '밤');
    const u = unionSpans(nights.map((r) => [Math.max(r.start, a), Math.min(sleepEnd(r, now), b)]));
    return { tot: spanMin(u), longest: u.reduce((m, [s, e]) => Math.max(m, (e - s) / MIN), 0), first: null, count: u.length, open: nights.some((r) => !r.end && r.start < b) };
  }
  const segs = nightRecs(key);
  const u = unionSpans(segs.map((r) => [r.start, sleepEnd(r, now)]));
  return { tot: spanMin(u), longest: u.reduce((m, [s, e]) => Math.max(m, (e - s) / MIN), 0), first: segs[0] || null, count: u.length, open: segs.some((r) => !r.end) };
}
function daySummary(key) {
  const now = Date.now();
  const l = dayRecs(key);
  const feeds = l.filter((r) => r.type === 'feed');
  const naps = l.filter((r) => r.type === 'sleep' && r.kind === '낮');
  const dia = l.filter((r) => r.type === 'diaper');
  return {
    feedN: feeds.length, feedMl: feeds.reduce((s, r) => s + (Number(r.value) || 0), 0),
    napN: unionSpans(naps.map((r) => [r.start, sleepEnd(r, now)])).length, napMin: spanMin(unionSpans(naps.map((r) => [r.start, sleepEnd(r, now)]))),
    pee: dia.filter((r) => r.d1 === '소변' || r.d1 === '둘다').length, poo: dia.filter(isPoop).length,
  };
}
function babyAge(key) {
  const b = set('birthDate');
  if (!b) return null;
  const n = Math.round((dstart(key) - dstart(b)) / DAY) + 1;
  const [by, bm, bd] = b.split('-').map(Number), [y, m, d] = key.split('-').map(Number);
  let months = (y - by) * 12 + (m - bm); if (d < bd) months--;
  return { n, months: Math.max(0, months) };
}
const babyName = () => set('babyName') || '우리 아기';

/* 홈 상태 카드 계산 */
function statusInfo() {
  const now = Date.now(), today = dkey(now);
  const P = planFor(today);
  const open = openSleep();
  const tone = (remainMin) => (remainMin > 15 ? 'var(--nap)' : remainMin > 0 ? 'var(--warn)' : 'var(--over)');
  const feed = lastOf('feed');
  let feedInfo = null;
  if (feed) {
    const el = (now - feed.start) / MIN, pred = feed.start + P.interval * MIN;
    feedInfo = { el, pct: Math.min(100, (el / P.interval) * 100), color: tone((pred - now) / MIN), target: P.interval, pred };
  }
  const poo = lastOf('diaper', isPoop);
  const base = { feedInfo, poo, P };
  if (open) {
    const el = (now - open.start) / MIN;
    if (open.kind === '밤') {
      const segs = nightRecs(nightOf(open));
      const first = segs[0] || open;
      const wakeAt = at(addDays(nightOf(open), 1), P.raw.wake);
      const tot = segs.reduce((s, r) => s + (sleepEnd(r, now) - r.start), 0) / MIN;
      return { ...base, mode: 'night', open, el, tot, pct: Math.min(100, ((now - first.start) / Math.max(1, wakeAt - first.start)) * 100), wakeAt };
    }
    const idx = dayNaps(dkey(open.start)).filter((r) => r.start <= open.start).length;
    const pn = P.naps[idx - 1];
    if (!pn) return { ...base, mode: 'nap', open, el, idx, target: null };
    const target = pn.e - pn.s, limit = pn.max || target;
    const color = el >= limit ? 'var(--over)' : 'var(--nap-deep)';
    return { ...base, mode: 'nap', open, el, idx, target, max: pn.max, pct: Math.min(100, (el / (pn.max || target)) * 100), color, pred: open.start + target * MIN };
  }
  const ended = sleeps().filter((r) => r.end);
  const last = ended.reduce((a, r) => (!a || r.end > a.end ? r : a), null);
  if (!last) return { ...base, mode: 'nodata' };
  const el = (now - last.end) / MIN;
  // 밤잠 뒤 깸: 계획 기상 1시간 이내면 아침 기상으로 보고 낮 일정 안내, 그보다 이르면 밤중 깸
  if (last.kind === '밤' && isNightTime(now) && at(addDays(nightOf(last), 1), P.raw.wake) - last.end > 60 * MIN) return { ...base, mode: 'nightwake', el, last };
  const n = last.kind === '밤' ? 1 : dayNaps(today).filter((r) => r.end && r.end <= last.end).length + 1;
  let target, pred, next;
  if (n <= P.naps.length) { target = P.ww[n - 1]; pred = last.end + target * MIN; next = `낮잠${n}`; }
  else { pred = at(today, P.raw.bed); target = Math.max(P.ww[P.ww.length - 1] || 120, (pred - last.end) / MIN); next = '밤잠'; }
  return { ...base, mode: 'awake', el, n, last: n > P.naps.length, target, pred, next, pct: Math.min(100, (el / target) * 100), color: tone((pred - now) / MIN) };
}
function charState() {
  const now = Date.now();
  if (openSleep()) return 'sleep';
  const f = lastOf('feed'), b = lastOf('bath');
  if (b && now - b.start < 20 * MIN) return 'bath';
  if (f && now - f.start < 20 * MIN) return 'feed';
  return 'awake';
}

/* ---------- 기록 표시 ---------- */
const TYPES = {
  feed: { n: '분유', c: 'c-feed', i: 'feed' }, sleep: { n: '잠', c: 'c-nap', i: 'sleep' }, diaper: { n: '기저귀', c: 'c-diaper', i: 'diaper' },
  bath: { n: '목욕', c: 'c-bath', i: 'bath' }, temp: { n: '체온', c: 'c-other', i: 'temp' }, med: { n: '약', c: 'c-other', i: 'med' },
  walk: { n: '산책', c: 'c-bath', i: 'walk' }, memo: { n: '메모', c: 'c-other', i: 'memo' }, food: { n: '이유식', c: 'c-feed', i: 'food' },
};
function recText(r) {
  const now = Date.now();
  switch (r.type) {
    case 'feed': return { t: `분유 ${Number(r.value) || 0}ml`, c: 'c-feed' };
    case 'sleep': {
      const n = r.kind === '밤' ? '밤잠' : '낮잠';
      const sub = r.end ? `${hm(r.start)} ~ ${hm(r.end)} · ${minTxt((r.end - r.start) / MIN)}` : `자는 중 · ${minTxt((now - r.start) / MIN)}째`;
      return { t: n, c: r.kind === '밤' ? 'c-night' : 'c-nap', sub };
    }
    case 'diaper': {
      const t = r.d1 === '둘다' ? '소변 + 대변' : r.d1 || '기저귀';
      const sub = [r.d2, r.d3].filter(Boolean).join(' · ');
      return { t, c: 'c-diaper', sub, warn: WARN_COLORS.includes(r.d2) };
    }
    case 'temp': {
      const v = Number(r.value);
      const c = v >= Number(set('tempHigh')) ? 'c-danger' : v >= Number(set('tempWarn')) ? 'c-over' : 'c-other';
      return { t: `체온 ${v.toFixed(1)}℃`, c };
    }
    case 'med': return { t: `약 · ${r.d1 || ''}`, c: 'c-other', sub: r.d2 };
    case 'food': return { t: `이유식 · ${r.d1 || ''}`, c: 'c-feed', sub: [r.value ? `${r.value}${r.d2 || 'g'}` : '', r.d3 && r.d3 !== '없음' ? `반응: ${r.d3}` : ''].filter(Boolean).join(' · '), warn: r.d3 && r.d3 !== '없음' };
    case 'memo': return { t: r.memo || '메모', c: 'c-other' };
    default: return { t: TYPES[r.type] ? TYPES[r.type].n : r.type, c: (TYPES[r.type] || {}).c };
  }
}
const TINT = { feed: 't-feed', sleep: 't-sleep', diaper: 't-diaper', bath: 't-bath', walk: 't-bath', food: 't-feed' };
const recIcon = (r) => `<span class="ic ${TINT[r.type] || 't-other'}">${ART.icons[r.type === 'sleep' && !r.end ? 'sleep' : (TYPES[r.type] || {}).i || 'memo']}</span>`;
/* 기록 한 줄 (누가 기록했는지는 화면에 보이지 않음) */
function recItem(r) {
  const x = recText(r);
  const memo = r.type !== 'memo' && r.memo ? `<small>${esc(r.memo)}</small>` : '';
  const hot = x.c === 'c-danger' || x.c === 'c-over' ? x.c : '';
  return `<button class="item" data-act="edit" data-id="${esc(r.id)}">
    <span class="t">${hm(r.start)}</span>${recIcon(r)}
    <span class="what"><span class="${hot}">${esc(x.t)}</span>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}${memo}</span>
    ${x.warn ? '<span class="tag warn-tag">확인 필요</span>' : ''}</button>`;
}

/* ---------- 화면 ---------- */
/* 입력 중인 칸이 있으면 다시 그리지 않고, 입력이 끝나면 그린다(쓰던 글이 사라지지 않게) */
let renderPending = false;
const typing = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#app')); };
// 입력을 마친 직후 누른 버튼이 사라지지 않도록, 미뤄둔 다시 그리기는 잠깐 기다렸다 실행
document.addEventListener('focusout', () => setTimeout(() => { if (renderPending && !typing()) render(); }, 350));
/* 손가락이 화면에 닿아 있거나 막 뗀 직후에는 '뒤에서 하는 다시 그리기'를 미룬다.
   (누르는 도중 버튼이 바뀌면 그 터치가 무시되기 때문) 직접 누른 동작의 화면 변경은 그대로 즉시 반영 */
let fingerDown = false, fingerUpAt = 0, bgTimer = 0;
document.addEventListener('pointerdown', () => { fingerDown = true; }, { passive: true, capture: true });
const fingerUp = () => { fingerDown = false; fingerUpAt = Date.now(); };
document.addEventListener('pointerup', fingerUp, { passive: true, capture: true });
document.addEventListener('pointercancel', fingerUp, { passive: true, capture: true });
function bgRender() {
  clearTimeout(bgTimer);
  if (fingerDown || Date.now() - fingerUpAt < 400 || $('#toast')) { bgTimer = setTimeout(bgRender, 400); return; }
  render();
}
function render(force) {
  if (!force && S.auth && typing()) { renderPending = true; return; }
  renderPending = false;
  clearTimeout(bgTimer);
  const root = $('#app');
  if (!S.auth) { root.innerHTML = viewLogin(); $('#tabs').innerHTML = ''; warmServer(); return; }
  const v = { home: viewHome, day: viewDay, pattern: viewPattern, growth: viewGrowth, settings: viewSettings }[S.tab] || viewHome;
  const same = S.tab === S._lastTab, y = window.scrollY;
  root.innerHTML = v();
  if (S.tab === 'home') fitClock();
  if (same && y) window.scrollTo(0, y);   // 같은 화면을 새로 그릴 때 스크롤 위치 유지
  S._lastTab = S.tab;
  renderTabs();
}
function renderTabs() {
  const t = [['home', '홈'], ['day', '하루'], ['pattern', '패턴'], ['growth', '성장']];
  const html = `<div class="in">${t.map(([k, n]) => `<button data-act="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${ART.icons[k === 'day' ? 'day' : k]}${n}</button>`).join('')}</div>`;
  const el = $('#tabs');
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}
/* 홈 원형 시계 크기: 남는 높이만큼 키우고 모자라면 줄인다(110~200px).
   가로는 설명 칸 옆에 오른쪽 여백이 남도록 카드 폭에 맞춰 상한을 둔다 */
const CLOCK_MIN = 110, CLOCK_MAX = 200;
function fitClock() {
  const app = $('#app'), c = $('.ccard .clk'), card = $('.ccard'), leg = $('.ccard .leg');
  if (!c) return;
  const z = Number(document.documentElement.style.zoom) || 1;
  const cs = getComputedStyle(card);
  const inner = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const wMax = Math.floor(inner - (leg ? leg.offsetWidth : 0) - parseFloat(cs.columnGap || 0) - 12);
  const hi = Math.max(110, Math.min(CLOCK_MAX, wMax)), lo = Math.min(CLOCK_MIN, hi);
  // #app 아래 여백이 하단 탭 높이만큼이라, 여백까지 포함해 화면 높이에 맞추면 탭에 가리지 않는다
  for (let i = 0; i < 3; i++) {
    const room = window.innerHeight / z - (app.offsetTop + app.offsetHeight);
    const cur = c.offsetHeight;
    const next = Math.round(Math.max(lo, Math.min(hi, cur + room)));
    if (Math.abs(next - cur) < 2) break;
    app.style.setProperty('--cs', `${next}px`);
  }
}
// 글씨 파일이 늦게 도착하면 글자 크기가 바뀌므로 다시 맞춤
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { if (S.auth && S.tab === 'home') fitClock(); });
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (S.auth && S.tab === 'home') bgRender(); }, 200); });

const photoOr = (slot, svg) => { const p = LOOK.photo(slot); return p ? `<img src="${p}" alt="">` : svg; };
/* 받침: 은우는 / 하준이는 */
const josa = (w, a, b) => { const c = String(w).charCodeAt(String(w).length - 1); return w + (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? a : b); };
function ageTxt(key) {
  const a = babyAge(key);
  if (!a) return '설정에서 생일을 입력해주세요';
  const d = Math.round((dstart(key) - dstart(addMonths(set('birthDate'), a.months))) / DAY);
  return `${a.months}개월 ${d}일 · ${a.n}일째`;
}
function header() {
  return `<div class="top"><div class="avatar">${photoOr('avatar', ART.chars[charState()])}</div>
    <div><div class="name">${esc(babyName())}</div><div class="age">${ageTxt(dkey(Date.now()))}</div></div>
    <button class="gear" data-act="tab" data-tab="settings" aria-label="설정">${ART.icons.gear}</button></div>`;
}

function viewHome() {
  const st = statusInfo();
  const today = dkey(Date.now()), yest = addDays(today, -1), mid = set('nightMode') === 'midnight';
  const sm = daySummary(today), ns = nightStats(mid ? today : yest);
  const open = openSleep();
  const last = live().filter((r) => !GROWTH_ONLY.has(r.type)).pop();
  return `<div class="home">${header()}${statusCard(st)}
  <button class="card ccard" data-act="tab" data-tab="day"><div class="clk">${clockSvg(today, sm, true)}</div>
    <div class="leg"><span><i style="background:var(--feed)"></i>수유</span><b>${sm.feedN}회 · ${sm.feedMl}ml</b>
      <span><i style="background:var(--nap)"></i>낮잠</span><b>${sm.napN}회 · ${minShort(sm.napMin)}</b>
      <span><i style="background:var(--night)"></i>${mid ? '오늘 밤잠' : '어젯밤'}</span><b>${ns.tot ? minShort(ns.tot) : '-'}</b>
      <span><i style="background:var(--diaper)"></i>기저귀</span><b>소${sm.pee} · 대${sm.poo}</b>
      <div class="go">하루 탭에서 자세히 →</div></div></button>
  <div class="btns">
    <button class="btn-big" data-act="feed"><span class="ic t-feed">${ART.icons.feed}</span>분유</button>
    <button class="btn-big ${open ? 'on' : ''}" data-act="sleep"><span class="ic t-sleep">${open ? ART.icons.wake : ART.icons.sleep}</span>${open ? '깸' : '잠 시작'}</button>
    <button class="btn-big" data-act="diaper"><span class="ic t-diaper">${ART.icons.diaper}</span>기저귀</button>
    <button class="btn-big" data-act="quick" data-type="bath"><span class="ic t-bath">${ART.icons.bath}</span>목욕</button>
  </div>
  <div class="smalls">
    <button class="btn-sm" data-act="temp">${ART.icons.temp}체온</button>
    <button class="btn-sm" data-act="med">${ART.icons.med}약</button>
    <button class="btn-sm" data-act="quick" data-type="walk">${ART.icons.walk}산책</button>
    <button class="btn-sm" data-act="memo">${ART.icons.memo}메모</button>
    ${set('showFood') === 'true' ? `<button class="btn-sm" data-act="food">${ART.icons.food}이유식</button>` : ''}
  </div>
  ${planStrip(st)}
  ${last ? lastCard(last) : ''}
  ${homeAlerts()}
  ${S.queue.length ? `<div class="pending">저장 대기 ${S.queue.length}건 · 연결되면 자동으로 올라가요</div>` : ''}</div>`;
}

function statusCard(st) {
  const nm = babyName(), cs = charState();
  const badge = { sleep: '🌙', feed: '🍼', bath: '🛁', awake: '☀️' }[cs];
  const ph = `<div class="ph">${photoOr('hero', ART.chars[cs])}<span class="badge">${badge}</span></div>`;
  // 상태 카드: 왼쪽에 큰 사진(캐릭터), 오른쪽에 제목 + 잠·수유 칸(위아래). 칸은 [아이콘 이름 … 경과 시간] / 막대 / 예상 시각
  const phBig = `<div class="ph big">${photoOr('hero', ART.chars[cs])}<span class="badge">${badge}</span></div>`;
  const tile = (cls, ico, name, v, pct, color, n) => `<div class="tile t${cls}"><div class="hd"><i>${ART.icons[ico]}</i><span class="nm">${name}</span><b class="v">${v}</b></div>
    ${pct == null ? '' : `<div class="bar2"><b style="width:${pct.toFixed(1)}%;background:${color}"></b></div>`}<div class="n">${n}</div></div>`;
  const none = (cls, ico, name, msg) => `<div class="tile t${cls} empty-t"><div class="hd"><i>${ART.icons[ico]}</i>${name}</div><div class="v">${msg}</div></div>`;
  const fi = st.feedInfo;
  const feedT = fi ? tile('F', 'feed', '수유한 지', minShort(fi.el), fi.pct, fi.color === 'var(--nap)' ? 'var(--feed)' : fi.color, `다음 수유 ${hm(fi.pred)}쯤`)
    : none('F', 'feed', '수유', '기록이 아직 없어요');
  const card = (title, tag, sub, sleepT) => `<div class="hero"><div class="hbody">${phBig}<div class="hright">
      <div><div class="st">${title}${tag ? `<span class="tag2">${tag}</span>` : ''}</div><div class="st-sub">${sub}</div></div>
      <div class="tiles">${sleepT}${feedT}</div></div></div></div>`;
  const who = esc(josa(nm, '은', '는'));
  if (st.mode === 'night') {
    return card(`${who} 밤잠 자는 중`, '🌙 밤잠', `${hm(st.open.start)} 잠듦 · 오늘 밤 ${minTxt(st.tot)}`,
      tile('S', 'sleep', '잠든 지', minShort(st.el), st.pct, 'var(--night)', `기상 목표 ${hm(st.wakeAt)}`));
  }
  if (st.mode === 'nap') {
    return card(`${who} 낮잠${st.idx} 자는 중`, '🌙 낮잠', `${hm(st.open.start)} 잠듦${st.target ? ` · ${st.max ? `최대 ${minTxt(st.max)}` : `목표 ${minTxt(st.target)}`}` : ''}`,
      st.target ? tile('S', 'sleep', '잠든 지', minShort(st.el), st.pct, st.color, `${hm(st.pred)}쯤 깸 예상`)
        : tile('S', 'sleep', '잠든 지', minShort(st.el), null, '', '일정표에 없는 잠'));
  }
  if (st.mode === 'nodata' && S.loading) {
    return `<div class="hero"><div class="hrow">${ph}<div style="flex:1"><div class="st">기록을 불러오는 중…</div><div class="bar2" style="background:rgba(255,255,255,.3)"><b class="loadbar"></b></div></div></div></div>`;
  }
  if (st.mode === 'nodata') return card('반가워요', '', '잠·수유를 기록하면 다음 할 일을 계산해드려요', none('S', 'sleep', '잠', '기록이 아직 없어요'));
  if (st.mode === 'nightwake') {
    return card('밤중에 깼어요', '🌙 밤중', `${hm(st.last.end)} 깸 · 다시 재우면 "잠 시작"`,
      tile('S', 'wake', '잠에서 깬 지', minShort(st.el), null, '', '다시 재우면 잠 시작'));
  }
  return card(`${who} 지금 깨어 있어요`, '☀️ 깸', `${st.last ? '마지막 깨시' : `${st.n}번째 깨시`} · 목표 ${minShort(st.target)}`,
    tile('S', 'sleep', '잠에서 깬 지', minShort(st.el), st.pct, st.color === 'var(--nap)' ? 'var(--accent)' : st.color, `${st.next} ${hm(st.pred)}쯤`));
}

/* 오늘 남은 일정: 다음 잠·다음 수유는 실제 기록으로 다시 계산한 시각, 그 뒤는 일정표 시각 */
function planItems(st) {
  const now = Date.now(), today = dkey(now), P = st.P, out = [];
  const plan = (key, m) => at(key, hmM(m));
  if (st.mode === 'night' || st.mode === 'nightwake') {
    const k = addDays(nightOf(st.mode === 'night' ? st.open : st.last), 1);
    out.push({ t: at(k, P.raw.wake), n: '기상', i: 'wake' });
    if (P.feeds[0]) out.push({ t: plan(k, P.feeds[0].t), n: P.feeds[0].l, i: 'feed' });
    if (P.naps[0]) out.push({ t: plan(k, P.naps[0].s), n: '낮잠1', i: 'sleep' });
    return out;
  }
  let napFrom = 0;
  if (st.mode === 'awake') { out.push({ t: st.pred, n: st.next, i: 'sleep', due: 1 }); napFrom = st.last ? P.naps.length : st.n; }
  else if (st.mode === 'nap') { if (st.pred) out.push({ t: st.pred, n: '깸', i: 'wake', due: 1 }); napFrom = st.idx; }
  const fedToday = dayRecs(today).filter((r) => r.type === 'feed' && !(isNightTime(r.start) && minOfDay(r.start) < 12 * 60)).length;
  let feedFrom = fedToday;
  if (st.feedInfo && st.feedInfo.pred > now - 3 * HOUR) { out.push({ t: st.feedInfo.pred, n: (P.feeds[fedToday] || {}).l || '수유', i: 'feed', due: 1 }); feedFrom = fedToday + 1; }
  const after = Math.max(now, ...out.map((o) => o.t));
  P.naps.forEach((n, i) => { const t = plan(today, n.s); if (i >= napFrom && t > now) out.push({ t, n: `낮잠${i + 1}`, i: 'sleep' }); });
  P.feeds.forEach((f, i) => { const t = plan(today, f.t); if (i >= feedFrom && t > after - 30 * MIN) out.push({ t, n: f.l, i: 'feed' }); });
  if (P.bath != null && !dayRecs(today).some((r) => r.type === 'bath')) { const t = plan(today, P.bath); if (t > now) out.push({ t, n: '목욕', i: 'bath' }); }
  if (st.next !== '밤잠') { const t = at(today, P.raw.bed); if (t > now) out.push({ t, n: '밤잠', i: 'sleep' }); }
  return out.sort((a, b) => a.t - b.t);
}
function planStrip(st) {
  if (st.mode === 'nodata') return '';
  const items = planItems(st);
  if (!items.length) return '';
  const night = st.mode === 'night' || st.mode === 'nightwake';
  return `<div class="card plan"><div class="h">${night ? '내일 아침 일정' : '오늘 남은 일정'}<span>${items.length > 4 ? '옆으로 넘겨보기 →' : esc(st.P.name)}</span></div>
    <div class="strip">${items.map((o, i) => `<div class="sc ${i === 0 ? 'on' : ''}"><b>${hm(o.t)}</b><span>${ART.icons[o.i]}${esc(o.n)}</span></div>`).join('')}</div></div>`;
}
function lastCard(r) {
  const x = recText(r);
  return `<button class="card last" data-act="edit" data-id="${esc(r.id)}">${recIcon(r)}<div style="min-width:0"><div class="k">마지막 기록</div>
    <div class="v">${esc(x.t)} · ${hm(r.start)}</div></div><span class="ed">고치기 ›</span></button>`;
}
/* 홈 알림: 기념일(오늘·내일), 지금 맞을 접종·검진, 오늘 하루 메모만 */
function homeAlerts() {
  const out = [];
  if (birthKey()) {
    const nm = babyName();
    anniList().forEach((a) => {
      const d = dDay(a.k);
      if (d === 0) out.push(['🎉', `오늘 ${nm} ${josa(a.n, '이에요', '예요')}!`, '축하해요 · 성장 탭에서 기념일 보기', 'anni']);
      else if (d === 1) out.push(['🎈', `내일은 ${nm} ${josa(a.n, '이에요', '예요')}`, `${shortDate(a.k)} · 성장 탭에서 기념일 보기`, 'anni']);
    });
    const due = dueHealth();
    if (due.length) out.push(['💉', `${due[0]} ${due.length > 1 ? `외 ${due.length - 1}건 ` : ''}맞을 시기예요`, '이미 했다면 성장 탭 → 건강에서 체크해주세요', 'health']);
  }
  const m = S.memos[dkey(Date.now())];
  if (m && m.text) out.push(['📝', m.text, '오늘 메모 · 하루 탭에서 보기', 'memo']);
  return out.map(([e, b, s, k]) => `<button class="alert" data-act="alertGo" data-k="${k}"><span class="e">${e}</span><span style="min-width:0"><b>${esc(b)}</b><small>${esc(s)}</small></span></button>`).join('');
}

/* 하루 탭 */
function viewDay() {
  const key = S.day, today = dkey(Date.now());
  const a = babyAge(key);
  const sm = daySummary(key), ns = nightStats(key);
  const recs = dayRecs(key).filter((r) => !GROWTH_ONLY.has(r.type)).reverse();
  const memo = S.memos[key];
  const tileS = (ic, t, k, v) => `<div><div class="ic ${t}">${ART.icons[ic]}</div><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const shown = S.dayAll ? recs : recs.slice(0, 5);
  return `<div class="daynav"><button data-act="day" data-d="-1" aria-label="이전 날">‹</button>
    <div class="d">${dayLabel(key)}<small>${a ? `${a.n}일째` : ''}${key === today ? ' · 오늘' : ''}</small></div>
    <button data-act="day" data-d="1" aria-label="다음 날" ${key >= today ? 'style="visibility:hidden"' : ''}>›</button></div>
  <div class="card"><div class="clock">${clockSvg(key, sm)}</div>
    <div class="legend"><span><i style="background:var(--night)"></i>밤잠</span><span><i style="background:var(--nap)"></i>낮잠</span>
    <span><i style="background:var(--feed);height:3px"></i>수유</span><span><i style="background:var(--bath);height:3px"></i>목욕</span></div></div>
  <div class="sum4">${tileS('feed', 't-feed', '수유', `${sm.feedN}회·${sm.feedMl}`)}${tileS('sleep', 't-sleep', '낮잠', `${sm.napN}회·${minShort(sm.napMin)}`)}
    ${tileS('sleep', 't-sleep', `밤잠${ns.count > 1 ? ` (최장 ${minShort(ns.longest)})` : ''}`, ns.tot ? minShort(ns.tot) : '-')}${tileS('diaper', 't-diaper', '기저귀', `소${sm.pee}·대${sm.poo}`)}</div>
  <div class="card"><div class="h">계획 대비<span>${esc(planFor(key).name)} 일정</span></div>${compareList(key)}</div>
  <div class="card list"><div class="h">기록 전체 · ${recs.length}건<button class="chip add xs" data-act="addPast">＋ 기록 추가</button></div>
    ${recs.length ? shown.map(recItem).join('') : '<div class="empty">기록이 없어요</div>'}
    ${recs.length > 5 ? `<button class="more" data-act="dayMore" data-k="dayAll">${S.dayAll ? '접기 ▴' : `${recs.length - 5}건 더 보기 ▾`}</button>` : ''}</div>
  <div class="card"><div class="h">한 줄 메모</div>
    <input id="daymemo" class="memo-in" maxlength="120" placeholder="오늘 있었던 일을 한 줄로 남겨보세요" value="${esc(memo ? memo.text : '')}" data-key="${key}"></div>`;
}

/* 24시간 원형 시계. mini = 홈 화면용(글자 작게, 크기는 카드에 맞춤) */
function clockSvg(key, sm, mini) {
  const C = 120, R = mini ? 80 : 84, W = mini ? 26 : 28, a0 = dstart(key), a1 = dstart(addDays(key, 1)), now = Date.now();
  const pt = (frac, r) => { const ang = frac * 2 * Math.PI - Math.PI / 2; return [C + r * Math.cos(ang), C + r * Math.sin(ang)]; };
  const fr = (ms) => (ms - a0) / (a1 - a0);
  const arc = (f1, f2, color) => {
    if (f2 - f1 >= 0.9999) return `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="${W}"/>`;
    const [x1, y1] = pt(f1, R), [x2, y2] = pt(f2, R);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 ${f2 - f1 > 0.5 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${W}"/>`;
  };
  const tick = (ms, color) => { const f = fr(ms), [x1, y1] = pt(f, R - W / 2), [x2, y2] = pt(f, R + W / 2); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="3.5"/>`; };
  let g = `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--track)" stroke-width="${W}"/>`;
  [...dayRecs(addDays(key, -1)), ...dayRecs(key)].filter((r) => r.type === 'sleep').forEach((r) => {
    const s = Math.max(r.start, a0), e = Math.min(sleepEnd(r, Math.min(now, a1)), a1);
    if (e > s) g += arc(fr(s), fr(e), r.kind === '밤' ? 'var(--night)' : 'var(--nap)');
  });
  dayRecs(key).forEach((r) => {
    if (r.start < a0 || r.start >= a1) return;
    if (r.type === 'feed') g += tick(r.start, 'var(--feed)');
    if (r.type === 'bath') g += tick(r.start, 'var(--bath)');
  });
  const step = mini ? 6 : 3;
  for (let h = 0; h < 24; h += step) {
    const [x, y] = pt(h / 24, R + W / 2 + 10);
    g += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="${mini ? 12 : 11}" fill="var(--muted)">${h}</text>`;
  }
  if (now >= a0 && now < a1) { const [x, y] = pt(fr(now), R - W / 2 - 9); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="var(--ink)"/>`; }
  const a = babyAge(key);
  g += `<text x="${C}" y="${C - 3}" text-anchor="middle" font-size="${mini ? 19 : 20}" font-weight="800" fill="var(--text)">${a ? `${a.n}일째` : ''}</text>
    <text x="${C}" y="${C + 20}" text-anchor="middle" font-size="${mini ? 17 : 17}" font-weight="700" fill="var(--feed-t)">${sm.feedMl}ml</text>`;
  return `<svg viewBox="0 0 240 240" width="100%" height="100%" role="img" aria-label="${dayLabel(key)} 24시간 기록">${g}</svg>`;
}

function diffPill(d, kind) {
  const ad = Math.abs(Math.round(d));
  if (ad <= 10) return `<span class="pill ok">${ad === 0 ? '정확' : '비슷'}</span>`;
  const w = kind === 'len' ? (d > 0 ? '길게' : '짧게') : (d > 0 ? '늦게' : '일찍');
  return `<span class="pill over">${minTxt(ad)} ${w}</span>`;
}
/* 계획 대비: 시간순 목록. 계획과 실제는 가까운 시각끼리 짝지음(한 번 빠져도 뒤가 밀리지 않게) */
function compareRows(key) {
  const P = planFor(key), now = Date.now(), today = dkey(now), rows = [];
  const nowM = key === today ? minOfDay(now) : 1e9;
  const row = (o) => rows.push(o);
  const yet = (m) => (key === today && m > nowM ? '<span class="pill muted">아직</span>' : '<span class="pill muted">-</span>');
  const mw = morningWake(key);
  row({ m: P.wake, ic: 'wake', t: 't-bath', n: '기상', p: `계획 ${hmM(P.wake)}`, a: mw ? hm(mw) : '', pill: mw ? diffPill(minOfDay(mw) - P.wake + (dkey(mw) !== key ? -1440 : 0)) : yet(P.wake) });
  const pairUp = (plans, acts, tOf, win) => {
    const cand = [];
    plans.forEach((p, i) => acts.forEach((r) => { const d = Math.abs(minOfDay(r.start) - tOf(p)); if (d <= win) cand.push({ i, r, d }); }));
    cand.sort((a, b) => a.d - b.d);
    const by = {}, used = new Set();
    cand.forEach((c) => { if (by[c.i] || used.has(c.r.id)) return; by[c.i] = c.r; used.add(c.r.id); });
    return { by, used };
  };
  const naps = dayNaps(key);
  const np = pairUp(P.naps, naps, (p) => p.s, 120);
  P.naps.forEach((pn, i) => {
    const r = np.by[i], plan = `계획 ${hmM(pn.s)} · ${minTxt(pn.e - pn.s)}`;
    if (!r) { row({ m: pn.s, ic: 'sleep', t: 't-sleep', n: `낮잠${i + 1}`, p: plan, a: '', pill: yet(pn.s) }); return; }
    const len = (sleepEnd(r, now) - r.start) / MIN;
    const lenPill = r.end && Math.abs(len - (pn.e - pn.s)) > 10 ? ` ${diffPill(len - (pn.e - pn.s), 'len')}` : '';
    row({ m: pn.s, ic: 'sleep', t: 't-sleep', n: `낮잠${i + 1}`, p: plan, a: `${hm(r.start)} · ${r.end ? minTxt(len) : '진행 중'}`, pill: diffPill(minOfDay(r.start) - pn.s) + lenPill });
  });
  naps.filter((r) => !np.used.has(r.id)).forEach((r) => row({ m: minOfDay(r.start), ic: 'sleep', t: 't-sleep', n: '추가 낮잠', p: '계획 없음', a: `${hm(r.start)} · ${minTxt((sleepEnd(r, now) - r.start) / MIN)}`, pill: '' }));
  const isDawn = (r) => isNightTime(r.start) && minOfDay(r.start) < 12 * 60;
  const feeds = dayRecs(key).filter((r) => r.type === 'feed' && !isDawn(r));
  const fp = pairUp(P.feeds, feeds, (p) => p.t, 120);
  const ml = (r) => `${esc(r.value)}ml`;
  P.feeds.forEach((pf, i) => {
    const r = fp.by[i];
    row({ m: pf.t, ic: 'feed', t: 't-feed', n: esc(pf.l), p: `계획 ${hmM(pf.t)}`, a: r ? `${hm(r.start)} · ${ml(r)}` : '', pill: r ? diffPill(minOfDay(r.start) - pf.t) : yet(pf.t) });
  });
  feeds.filter((r) => !fp.used.has(r.id)).forEach((r) => row({ m: minOfDay(r.start), ic: 'feed', t: 't-feed', n: '추가 수유', p: '계획 없음', a: `${hm(r.start)} · ${ml(r)}`, pill: '' }));
  dayRecs(key).filter((r) => r.type === 'feed' && isDawn(r)).forEach((r) => row({ m: minOfDay(r.start) - 1440, ic: 'feed', t: 't-feed', n: '새벽 수유', p: '밤중', a: `${hm(r.start)} · ${ml(r)}`, pill: '' }));
  if (P.bath != null) {
    const b = dayRecs(key).find((r) => r.type === 'bath');
    row({ m: P.bath, ic: 'bath', t: 't-bath', n: '목욕', p: `계획 ${hmM(P.bath)}`, a: b ? hm(b.start) : '', pill: b ? diffPill(minOfDay(b.start) - P.bath) : yet(P.bath) });
  }
  const ns = nightStats(key), first = nightRecs(key)[0];
  row({ m: P.bed, ic: 'sleep', t: 't-sleep', n: '밤잠 시작', p: `계획 ${hmM(P.bed)}`, a: first ? hm(first.start) : '',
    pill: first ? diffPill(minOfDay(first.start) - P.bed + (minOfDay(first.start) < 720 ? 1440 : 0)) : yet(P.bed) });
  if (ns.count) row({ m: 9999, ic: 'sleep', t: 't-sleep', n: '밤잠', p: `최장 ${minTxt(ns.longest)}`, a: `총 ${minTxt(ns.tot)}`, pill: '' });
  return rows.sort((x, y) => x.m - y.m);
}
function compareList(key) {
  const rows = compareRows(key), shown = S.planAll ? rows : rows.slice(0, 6);
  return `<div class="cmp-list">${shown.map((o) => `<div class="prow"><span class="ic ${o.t}">${ART.icons[o.ic]}</span>
      <div class="n">${o.n}<small>${o.p}</small></div><div class="a">${o.a}${o.a && o.pill ? '<br>' : ''}${o.pill}</div></div>`).join('')}</div>
    ${rows.length > 6 ? `<button class="more" data-act="dayMore" data-k="planAll">${S.planAll ? '접기 ▴' : `나머지 ${rows.length - 6}개 항목 더 보기 ▾`}</button>` : ''}`;
}
const hmM = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/* 패턴·성장 (2차) */
/* ---------- 패턴 탭 ---------- */
const PAT_ITEMS = [['night', '밤잠', 1], ['nap', '낮잠', 1], ['feed', '수유', 1], ['bath', '목욕', 1], ['poo', '대변', 1], ['pee', '소변', 0], ['temp', '체온', 0], ['med', '약', 0], ['walk', '산책', 0]];
const PAT_COLOR = { night: '#534AB7', nap: '#AFA9EC', feed: '#F2B544', bath: '#5DCAA5', poo: '#B07A3A', pee: '#F5C4B3', temp: '#E24B4A', med: '#ED93B1', walk: '#9FE1CB' };
S.pat = { mode: 'recent', offset: 0, trend: 'feed', period: 14, sub: 'week' };
function patToggles() {
  const t = LS.get('patToggles', {}) || {};
  const o = {}; PAT_ITEMS.forEach(([k, , d]) => { o[k] = k in t ? !!t[k] : !!d; });
  return o;
}
/* 화면에 보이는 7일(날짜 키 배열) */
function patKeys() {
  const today = dkey(Date.now());
  if (S.pat.mode === 'week') {
    const dow = (new Date(dstart(today)).getDay() + 6) % 7;   // 월=0
    const mon = addDays(today, -dow + 7 * S.pat.offset);
    return [...Array(7)].map((_, i) => addDays(mon, i));
  }
  const end = addDays(today, 7 * S.pat.offset);
  return [...Array(7)].map((_, i) => addDays(end, i - 6));
}
const md = (key) => { const [, m, d] = key.split('-').map(Number); return `${m}/${d}`; };
const wd = (key) => { const [y, m, d] = key.split('-').map(Number); return WEEK[new Date(y, m - 1, d).getDay()]; };
const avg = (a) => { const v = a.filter((x) => x != null && !isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const hasData = (key) => dayRecs(key).some((r) => r.type === 'feed' || r.type === 'sleep');
/* 귀여운 똥 그림 (주간 그래프 대변 표시·항목 버튼) */
const pooSvg = (cx, cy, k) => `<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) scale(${k})"><path d="M0,-9 C2,-8 3,-6.5 2.2,-5.2 C5,-5.2 6,-3 4.8,-1.6 C8,-1.4 8.6,2.6 6.2,3.6 L-6.2,3.6 C-8.6,2.6 -8,-1.4 -4.8,-1.6 C-6,-3 -5,-5.2 -2.2,-5.2 C-3.2,-6.6 -1.6,-8.4 0,-9Z" fill="#B07A3A" stroke="#fff" stroke-width="1.2"/><circle cx="-2" cy="0.9" r=".9" fill="#3A2A1A"/><circle cx="2" cy="0.9" r=".9" fill="#3A2A1A"/><path d="M-1,2.2 Q0,3 1,2.2" stroke="#3A2A1A" stroke-width=".6" fill="none"/></g>`;
const subMenu = (items, cur, act) => `<div class="sub">${items.map(([k, n]) => `<button class="${cur === k ? 'on' : ''}" data-act="${act}" data-k="${k}">${n}</button>`).join('')}</div>`;

function viewPattern() {
  const today = dkey(Date.now()), sub = S.pat.sub;
  const head = `<div class="ttl"><span class="t">패턴</span><div class="r seg sm">
      <button class="seg-b ${S.pat.mode === 'recent' ? 'on' : ''}" data-act="patMode" data-m="recent">최근 7일</button>
      <button class="seg-b ${S.pat.mode === 'week' ? 'on' : ''}" data-act="patMode" data-m="week">주별</button></div></div>
    ${subMenu([['week', '주간 그래프'], ['cmp', '7일 비교'], ['trend', '추이'], ['goal', '목표']], sub, 'patSub')}`;
  if (sub === 'cmp') return head + weekTableCard(patKeys(), today);
  if (sub === 'trend') return head + trendCard(today);
  if (sub === 'goal') return head + goalCard(today);
  const keys = patKeys(), tg = patToggles();
  return `${head}<div class="card"><div class="wnav"><button data-act="patNav" data-d="-1" aria-label="이전">‹</button><div>${md(keys[0])} – ${md(keys[6])}</div>
      <button data-act="patNav" data-d="1" aria-label="다음" ${S.pat.offset >= 0 ? 'style="visibility:hidden"' : ''}>›</button></div>
    <div class="chips" style="gap:5px;margin-bottom:8px">${PAT_ITEMS.map(([k, n]) => `<button class="chip xs ${tg[k] ? 'on' : ''}" data-act="patToggle" data-k="${k}">${k === 'poo' ? `<svg class="poo" viewBox="-9 -10 18 15">${pooSvg(0, 0, 1)}</svg>` : `<span class="dot" style="background:${PAT_COLOR[k]}"></span>`}${n}</button>`).join('')}</div>
    ${weekSvg(keys, tg)}
    <div class="sum">날짜를 누르면 그날 기록으로 이동해요</div></div>`;
}

function weekSvg(keys, tg) {
  const L = 22, T = 6, H = 400, W = 340, gap = 5, cw = (W - L - 2 - gap * 6) / 7, now = Date.now();
  let g = '';
  const today = dkey(now);
  keys.forEach((key, i) => {
    const x = L + i * (cw + gap), a0 = dstart(key), a1 = dstart(addDays(key, 1));
    const y = (ms) => T + (ms - a0) / (a1 - a0) * H;
    let col = `<rect x="${x.toFixed(1)}" y="${T}" width="${cw.toFixed(1)}" height="${H}" rx="5" fill="var(--soft)"/>`;
    if (now < a1) col += `<rect x="${x.toFixed(1)}" y="${Math.max(T, y(now)).toFixed(1)}" width="${cw.toFixed(1)}" height="${(T + H - Math.max(T, y(now))).toFixed(1)}" fill="var(--soft2)"/>`;
    [...dayRecs(addDays(key, -1)), ...dayRecs(key)].filter((r) => r.type === 'sleep').forEach((r) => {
      const k = r.kind === '밤' ? 'night' : 'nap';
      if (!tg[k]) return;
      const s = Math.max(r.start, a0), e = Math.min(sleepEnd(r, Math.min(now, a1)), a1);
      if (e > s) col += `<rect x="${x.toFixed(1)}" y="${y(s).toFixed(1)}" width="${cw.toFixed(1)}" height="${Math.max(1, y(e) - y(s)).toFixed(1)}" fill="${PAT_COLOR[k]}"/>`;
    });
    let marks = '';
    dayRecs(key).forEach((r) => {
      if (r.start < a0 || r.start >= a1) return;
      const yy = y(r.start);
      const bar = (c) => `<rect x="${x.toFixed(1)}" y="${(yy - 1.3).toFixed(1)}" width="${cw.toFixed(1)}" height="2.8" fill="${c}"/>`;
      const dot = (c, dx, rad) => `<circle cx="${(x + cw * dx).toFixed(1)}" cy="${yy.toFixed(1)}" r="${rad}" fill="${c}"/>`;
      if (r.type === 'feed' && tg.feed) col += bar(PAT_COLOR.feed);
      else if (r.type === 'bath' && tg.bath) col += bar(PAT_COLOR.bath);
      else if (r.type === 'diaper') {
        if (isPoop(r) && tg.poo) marks += pooSvg(x + cw / 2, yy + 0.5, 0.6);
        if ((r.d1 === '소변' || r.d1 === '둘다') && tg.pee) col += dot(PAT_COLOR.pee, 0.22, 2.4);
      } else if (r.type === 'temp' && tg.temp) col += dot(PAT_COLOR.temp, 0.78, 3);
      else if (r.type === 'med' && tg.med) col += dot(PAT_COLOR.med, 0.78, 3);
      else if (r.type === 'walk' && tg.walk) col += dot(PAT_COLOR.walk, 0.22, 3);
    });
    col += marks;
    const isToday = key === today;
    col += `<text x="${(x + cw / 2).toFixed(1)}" y="${T + H + 14}" text-anchor="middle" font-size="10.5" fill="${isToday ? 'var(--text)' : 'var(--muted)'}" font-weight="${isToday ? 800 : 600}">${md(key).split('/')[1]}</text>
      <text x="${(x + cw / 2).toFixed(1)}" y="${T + H + 26}" text-anchor="middle" font-size="9.5" fill="${wd(key) === '일' ? '#E0736B' : 'var(--faint)'}">${wd(key)}</text>
      <rect x="${x.toFixed(1)}" y="0" width="${cw.toFixed(1)}" height="${T + H + 30}" fill="transparent"/>`;
    g += key > today ? `<g opacity="0.35">${col}</g>` : `<g data-act="patDay" data-d="${key}" style="cursor:pointer">${col}</g>`;
  });
  // 3시간마다 눈금 + 점선(막대 위에 옅게)
  for (let h = 0; h <= 24; h += 3) {
    const yy = (T + h / 24 * H).toFixed(1);
    g += `<line x1="${L}" x2="${W - 2}" y1="${yy}" y2="${yy}" stroke="var(--card)" stroke-opacity=".55" stroke-width=".7" stroke-dasharray="2 2" pointer-events="none"/>
      <text x="${L - 4}" y="${(Number(yy) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${h}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${T + H + 30}" width="100%" role="img" aria-label="주간 패턴">${g}</svg>`;
}

function weekTableCard(keys, today) {
  const rows = keys.map((key) => {
    const sm = daySummary(key), ns = nightStats(key), any = hasData(key);
    return { key, any, sm, ns, done: key < today };
  });
  const cell = (ok, v) => (ok ? v : '<span class="lbl">-</span>');
  const body = rows.map((r) => `<${r.key > today ? 'div class="trow future"' : `button class="trow" data-act="patDay" data-d="${r.key}"`}>
      <span>${md(r.key)} (${wd(r.key)})${r.key === today ? ' <span class="lbl">진행 중</span>' : ''}</span>
      <span class="c-feed">${cell(r.sm.feedN, `${r.sm.feedN}·${r.sm.feedMl}`)}</span>
      <span class="c-nap">${cell(r.sm.napN, `${r.sm.napN}·${minShort(r.sm.napMin)}`)}</span>
      <span class="c-night">${cell(r.ns.tot, `${minShort(r.ns.tot)} <span class="lbl">(${minShort(r.ns.longest)})</span>${r.ns.open ? ' <span class="lbl">진행 중</span>' : ''}`)}</span></${r.key > today ? 'div' : 'button'}>`).join('');
  // 평균: 기록이 있는 지난 날만(오늘은 진행 중이라 제외)
  const done = rows.filter((r) => r.done && r.any);
  const a = (f) => avg(done.map(f));
  const fN = a((r) => r.sm.feedN || null), fM = a((r) => r.sm.feedMl || null), nN = a((r) => (r.sm.napN ? r.sm.napN : null)), nM = a((r) => (r.sm.napN ? r.sm.napMin : null));
  const tN = a((r) => (r.ns.tot && !r.ns.open ? r.ns.tot : null)), lN = a((r) => (r.ns.tot && !r.ns.open ? r.ns.longest : null));
  const f1 = (v) => (v == null ? '-' : (Math.round(v * 10) / 10).toString());
  // 작은 카드: 오늘 지금까지 수유 / 어제보다 밤잠
  const tk = dkey(Date.now()), y1 = addDays(tk, -1), y2 = addDays(tk, -2);
  const ts = daySummary(tk), n1 = nightStats(y1), n2 = nightStats(y2);
  const nd = n1.tot && n2.tot && !n1.open && !n2.open ? n1.tot - n2.tot : null;
  return `<div class="card"><div class="h">7일 비교<span>오늘은 평균에서 빼요</span></div>
    <div class="ttable"><div class="thead"><span>날짜</span><span>수유 <small>회·ml</small></span><span>낮잠</span><span>밤잠 <small>(최장)</small></span></div>${body}
    <div class="tavg"><span>평균 <span class="lbl">${done.length}일</span></span><span class="c-feed">${fM == null ? '-' : `${f1(fN)}·${Math.round(fM)}`}</span>
      <span class="c-nap">${nM == null ? '-' : `${f1(nN)}·${minShort(nM)}`}</span><span class="c-night">${tN == null ? '-' : `${minShort(tN)} <span class="lbl">(${minShort(lN)})</span>`}</span></div></div></div>
  <div class="mini"><div><div class="k">오늘 수유 (지금까지)</div><b class="c-feed">${ts.feedN}회 · ${ts.feedMl}ml</b></div>
    <div><div class="k">어제보다 밤잠</div><b class="c-night">${nd == null ? '-' : `${nd >= 0 ? '+' : '−'}${minTxt(Math.abs(nd))}`}</b></div></div>`;
}

/* 추이: 오늘은 진행 중이라 어제까지 */
function trendData(today) {
  const n = S.pat.period;
  const keys = [...Array(n)].map((_, i) => addDays(today, i - n));
  const firstDayFeed = (key) => dayRecs(key).find((r) => r.type === 'feed' && !(isNightTime(r.start) && minOfDay(r.start) < 12 * 60));
  return keys.map((key) => {
    const sm = daySummary(key), ns = nightStats(key), mw = morningWake(key), ff = firstDayFeed(key);
    const bed = nightRecs(key)[0];
    const bm = bed ? minOfDay(bed.start) + (minOfDay(bed.start) < 12 * 60 ? 1440 : 0) : null;
    return {
      key, feedMl: sm.feedN ? sm.feedMl : null, feedAvg: sm.feedN ? sm.feedMl / sm.feedN : null,
      nightTot: ns.tot && !ns.open ? ns.tot / 60 : null, longest: ns.tot && !ns.open ? ns.longest / 60 : null,
      wake: mw ? minOfDay(mw) / 60 : null, first: ff ? minOfDay(ff.start) / 60 : null, bed: bm != null ? bm / 60 : null,
    };
  });
}
/* 기간 앞쪽 3일 평균과 뒤쪽 3일 평균의 차이 */
function edgeDiff(vals) {
  const v = vals.filter((x) => x != null);
  if (v.length < 4) return null;
  return avg(v.slice(-3)) - avg(v.slice(0, 3));
}
function trendCard(today) {
  const d = trendData(today), t = S.pat.trend;
  const perN = { 7: '1주', 14: '2주', 30: '1달' }[S.pat.period];
  const per = [[7, '1주'], [14, '2주'], [30, '1달']].map(([n, l]) => `<button class="chip xs ${S.pat.period === n ? 'on' : ''}" data-act="patPeriod" data-n="${n}">${l}</button>`).join('');
  const seg = [['feed', '수유'], ['sleep', '통잠'], ['rhythm', '리듬']].map(([k, l]) => `<button class="seg-b ${t === k ? 'on' : ''}" data-act="patTrend" data-t="${k}">${l}</button>`).join('');
  const hhmm = (h) => hmM(((Math.round(h * 60) % 1440) + 1440) % 1440);
  const dur = (h) => minShort(h * 60);
  const sgn = (v, f) => (v == null ? '-' : `${v >= 0 ? '+' : '−'}${f(Math.abs(v))}`);
  const maxOf = (k) => d.reduce((m, x) => (x[k] != null && (!m || x[k] > m[k]) ? x : m), null);
  let series, fmt, summary, step, mini;
  if (t === 'feed') {
    series = [{ v: d.map((x) => x.feedMl), c: PAT_COLOR.feed, n: '하루 총량' }];
    fmt = (v) => `${Math.round(v)}`; step = 50;
    const a = avg(d.map((x) => x.feedMl)), b = avg(d.map((x) => x.feedAvg)), m = maxOf('feedMl');
    summary = a == null ? '' : `하루 평균 <b>${Math.round(a)}ml</b> · 1회 평균 <b>${Math.round(b)}ml</b>`;
    mini = [[`${perN} 전보다 하루 수유`, sgn(edgeDiff(d.map((x) => x.feedMl)), (v) => `${Math.round(v)}ml`), 'c-feed'], ['가장 많이 먹은 날', m ? `${md(m.key)} · ${m.feedMl}ml` : '-', 'c-feed']];
  } else if (t === 'sleep') {
    series = [{ v: d.map((x) => x.nightTot), c: PAT_COLOR.night, n: '밤잠 총량' }, { v: d.map((x) => x.longest), c: '#8F87E6', n: '최장 연속' }];
    fmt = dur; step = 1;
    const a = avg(d.map((x) => x.nightTot)), b = avg(d.map((x) => x.longest)), m = maxOf('longest');
    summary = a == null ? '' : `평균 밤잠 <b>${dur(a)}</b> · 평균 최장 <b>${dur(b)}</b>`;
    mini = [[`${perN} 전보다 최장 통잠`, sgn(edgeDiff(d.map((x) => x.longest)), (v) => minTxt(v * 60)), 'c-night'], ['가장 길게 잔 밤', m ? `${md(m.key)} · ${dur(m.longest)}` : '-', 'c-night']];
  } else {
    series = [{ v: d.map((x) => x.wake), c: PAT_COLOR.walk, n: '기상' }, { v: d.map((x) => x.first), c: PAT_COLOR.feed, n: '첫 수유' }, { v: d.map((x) => x.bed), c: PAT_COLOR.nap, n: '밤잠 시작' }];
    fmt = hhmm; step = 1;
    const w = avg(d.map((x) => x.wake)), f = avg(d.map((x) => x.first)), b = avg(d.map((x) => x.bed));
    summary = w == null && b == null ? '' : `평균 기상 <b>${w == null ? '-' : hhmm(w)}</b> · 첫 수유 <b>${f == null ? '-' : hhmm(f)}</b> · 밤잠 <b>${b == null ? '-' : hhmm(b)}</b>`;
    mini = [[`${perN} 전보다 기상`, sgn(edgeDiff(d.map((x) => x.wake)), (v) => minTxt(v * 60)), 'c-bath'], [`${perN} 전보다 밤잠 시작`, sgn(edgeDiff(d.map((x) => x.bed)), (v) => minTxt(v * 60)), 'c-nap']];
  }
  const legend = series.length > 1 ? `<div class="legend" style="margin-top:2px">${series.map((s) => `<span><i style="background:${s.c};height:3px"></i>${s.n}</span>`).join('')}</div>` : '';
  return `<div class="card"><div class="h">추이<span class="chips" style="gap:4px;flex-wrap:nowrap">${per}</span></div>
    <div class="seg">${seg}</div>
    ${lineSvg(d.map((x) => x.key), series, fmt, step)}${legend}
    <div class="sum">${summary || '아직 기록이 부족해요'}</div></div>
    <div class="mini">${mini.map(([k, v, c]) => `<div><div class="k">${k}</div><b class="${c}">${v}</b></div>`).join('')}</div>
    <div class="note2" style="margin-top:-2px">${perN} 전보다 = 기간 처음 3일 평균과 마지막 3일 평균의 차이</div>`;
}
function lineSvg(keys, series, fmt, step) {
  const W = 320, H = 230, L = 38, R = 8, T = 10, B = 18, iw = W - L - R, ih = H - T - B;
  const all = series.flatMap((s) => s.v).filter((v) => v != null);
  if (!all.length) return `<div class="empty">이 기간에 기록이 없어요</div>`;
  let lo = Math.min(...all), hi = Math.max(...all);
  const padv = (hi - lo) * 0.15 || Math.max(1, Math.abs(hi) * 0.1);
  lo -= padv; hi += padv;
  if (all.every((v) => v >= 0)) lo = Math.max(0, lo);
  if (step) { lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi - lo < 2 * step) hi = lo + 2 * step; }
  const x = (i) => L + (keys.length === 1 ? iw / 2 : (i / (keys.length - 1)) * iw), y = (v) => T + ih - ((v - lo) / (hi - lo)) * ih;
  let g = '';
  [0, 0.5, 1].forEach((f) => { const v = lo + (hi - lo) * f; g += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--grid)" stroke-width="1"/><text x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmt(v)}</text>`; });
  const lastI = keys.length - 1;
  [0, Math.floor(lastI / 2), lastI].forEach((i, j) => { g += `<text x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="${j === 0 ? 'start' : j === 2 ? 'end' : 'middle'}" font-size="9" fill="var(--muted)">${md(keys[i])}</text>`; });
  series.forEach((s) => {
    let seg = [];
    const flushSeg = () => {
      if (seg.length > 1) {
        if (series.length === 1) g += `<path d="M${seg[0][0]},${y(lo).toFixed(1)} L${seg.map((p) => p.join(',')).join(' L')} L${seg[seg.length - 1][0]},${y(lo).toFixed(1)}Z" fill="${s.c}" fill-opacity=".15"/>`;
        g += `<polyline points="${seg.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${s.c}" stroke-width="2.4" stroke-linejoin="round"/>`;
      }
      seg = [];
    };
    s.v.forEach((v, i) => { if (v == null) { flushSeg(); return; } seg.push([x(i).toFixed(1), y(v).toFixed(1)]); g += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="${s.c}"/>`; });
    flushSeg();
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="추이 그래프">${g}</svg>`;
}

/* 목표 vs 실제: 어제까지 7일, 날마다 그날 일정표로 비교 후 평균 */
function goalCard(today) {
  const keys = [...Array(7)].map((_, i) => addDays(today, i - 7));
  const acc = {}; const push = (k, a, t) => { if (a == null || t == null) return; (acc[k] = acc[k] || { a: [], t: [] }); acc[k].a.push(a); acc[k].t.push(t); };
  let days = 0;
  keys.forEach((key) => {
    if (!hasData(key)) return;
    days++;
    const P = planFor(key), mw = morningWake(key);
    const naps = unionSpans(dayNaps(key).filter((r) => r.end).map((r) => [r.start, r.end])).map(([a, b]) => ({ start: a, end: b }));
    const bed = nightRecs(key)[0];
    let prev = mw;
    naps.forEach((r, i) => { if (prev && r.start > prev) push(`ww${i + 1}`, (r.start - prev) / MIN, P.ww[i] != null && i < P.naps.length ? P.ww[i] : null); prev = r.end; });
    if (prev && bed && bed.start > prev) push('wwLast', (bed.start - prev) / MIN, P.ww[P.ww.length - 1]);
    const feeds = dayRecs(key).filter((r) => r.type === 'feed' && !(isNightTime(r.start) && minOfDay(r.start) < 12 * 60));
    for (let i = 1; i < feeds.length; i++) push('feed', (feeds[i].start - feeds[i - 1].start) / MIN, P.interval);
    if (bed) push('bed', minOfDay(bed.start) + (minOfDay(bed.start) < 12 * 60 ? 1440 : 0), P.bed);
    if (naps.length) push('nap', naps.reduce((s, r) => s + (r.end - r.start) / MIN, 0), P.naps.reduce((s, n) => s + (n.e - n.s), 0));
  });
  const link = `<button class="card linkrow" data-act="goPlan"><div>목표 수정<small>깨시·수유 간격·밤잠 시작 시간은 일정표에서 바꿔요</small></div><span class="go">일정표 ›</span></button>`;
  if (!days) return `<div class="card"><div class="h">목표 vs 실제<span>최근 7일</span></div><div class="empty">지난 7일 기록이 쌓이면 보여드려요</div></div>${link}`;
  const order = Object.keys(acc).filter((k) => /^ww\d/.test(k)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  const names = { feed: '수유 간격', bed: '밤잠 시작', nap: '낮잠 총량', wwLast: '마지막 깨시' };
  const rows = [...order, 'wwLast', 'feed', 'bed', 'nap'].filter((k) => acc[k]).map((k) => {
    const a = avg(acc[k].a), t = avg(acc[k].t), dlt = a - t;
    const show = k === 'bed' ? hmM(Math.round(t) % 1440) : minShort(t);
    const act = k === 'bed' ? hmM(Math.round(a) % 1440) : minShort(a);
    const ad = Math.abs(Math.round(dlt));
    const dTxt = ad <= 10 ? `<span class="pill ok">${ad ? (dlt > 0 ? '+' : '−') + ad + '분' : '같음'}</span>` : `<span class="pill over">${dlt > 0 ? '+' : '−'}${minTxt(ad)}</span>`;
    return `<div>${k.startsWith('ww') && k !== 'wwLast' ? `깨시 ${k.slice(2)}` : names[k]}</div><div class="p">${show}</div><div class="a">${act}</div><div class="a">${dTxt}</div>`;
  }).join('');
  return `<div class="card"><div class="h">목표 vs 실제<span>최근 7일 · ${days}일 기준</span></div>
    <div class="cmp" style="grid-template-columns:1fr auto auto auto"><div class="hd">항목</div><div class="hd">목표</div><div class="hd a">실제</div><div class="hd a">차이</div>${rows}</div>
    <div class="note2">목표는 날마다 그날 적용된 일정표 기준 · 10분 넘게 차이 나면 주황</div></div>${link}`;
}

/* 설정 */
const curApply = () => [...S.apply].sort((a, b) => (a.from < b.from ? -1 : 1)).filter((a) => a.from <= dkey(Date.now())).pop();
const isAdmin = () => !!(S.users.find((u) => u.name === S.auth.user) || {}).admin;
function viewSettings() {
  const cur = curApply();
  const row = (k, v, act, sub) => `<button class="sb" data-act="${act}"><span class="k">${k}${sub ? `<small>${sub}</small>` : ''}</span><span class="v">${v}</span><span class="ar">›</span></button>`;
  const th = LOOK.theme().k, fo = LOOK.font().k, sz = LOOK.size().k;
  LOOK.fonts.forEach((f) => LOOK.loadFont(f));   // 견본 글씨를 보여주려고 다섯 글씨체를 모두 부름(견본 글자 조각만 받음)
  const ph = (slot, name, round) => `<div class="pt"><div class="im" style="border-radius:${round ? '50%' : '16px'}">${photoOr(slot, ART.chars.awake)}</div>${name}
      <div class="bt"><button data-act="photo" data-slot="${slot}">바꾸기</button>${LOOK.photo(slot) ? `<button data-act="photoClear" data-slot="${slot}">기본 그림</button>` : ''}</div></div>`;
  const [b] = [set('birthDate')];
  return `<div class="ttl"><button class="back" data-act="tab" data-tab="home" aria-label="뒤로">‹</button><span class="t">설정</span></div>
  <div class="gh" style="margin-top:2px">사진 · 갤러리에서 골라요</div>
  <div class="grp"><div class="phs">${ph('avatar', '맨 위 프로필', true)}${ph('hero', '상태 카드', false)}</div></div>
  <div class="gh">테마</div>
  <div class="grp"><div class="ths">${LOOK.themes.map((t) => `<button class="tc ${t.k === th ? 'on' : ''}" data-act="look" data-k="theme" data-v="${t.k}">
      <div class="m" style="background:${t.bg}"><i style="background:${t.a}"></i><i style="background:${t.c}"></i></div>${t.n}${t.k === th ? ' ✓' : ''}</button>`).join('')}</div></div>
  <div class="gh">글씨체</div>
  <div class="grp">${LOOK.fonts.map((f) => `<button class="fr ${f.k === fo ? 'on' : ''}" data-act="look" data-k="font" data-v="${f.k}"><span class="rd"></span>
      <span class="s" style="font-family:${f.fam},'BL Pretendard',sans-serif;${f.sample}">${esc(babyName())} 100일 축하해 · 150ml</span><span class="n">${f.n}${f.k === 'pretendard' ? ' (기본)' : ''}</span></button>`).join('')}</div>
  <div class="gh">글씨 크기</div>
  <div class="grp"><div class="szp"><div class="seg" style="margin:0">${LOOK.sizes.map((s) => `<button class="seg-b ${s.k === sz ? 'on' : ''}" data-act="look" data-k="size" data-v="${s.k}">${s.n}</button>`).join('')}</div>
    <div class="prev"><span>마지막 수유 후</span><b style="font-size:21px">1:12</b></div></div></div>
  <div class="note2">사진·테마·글씨는 이 휴대폰에만 적용돼요</div>
  <div class="gh">아기</div>
  <div class="grp">${row('이름', esc(set('babyName') || '우리 아기'), 'setName')}${row('생일', b ? esc(b.replace(/-/g, '. ').replace(/\. 0/g, '. ')) : '-', 'setBirth')}</div>
  <div class="gh">기록 기준</div>
  <div class="grp">${row('일정표', esc(cur ? cur.name : '-'), 'setPlan', cur ? `${esc(cur.from)}부터 적용` : '')}
    ${row('분유 자주 쓰는 양', esc(String(set('feedPresets')).replace(/,/g, '·')), 'setPresets')}
    ${row('밤잠 시간대', `${esc(set('nightStart'))} – ${esc(set('nightEnd'))}`, 'setNight', '이 시간에 잠들면 밤잠')}
    ${row('체온 주의 · 고열', `${esc(set('tempWarn'))} · ${esc(set('tempHigh'))}℃`, 'setTemp')}
    ${row('밤잠 집계', set('nightMode') === 'midnight' ? '자정 기준' : '잠든 날 기준', 'setNightMode')}
    <div class="sb"><span class="k">이유식 버튼</span><button class="switch ${set('showFood') === 'true' ? 'on' : ''}" data-act="toggle" data-k="showFood" aria-label="켜기/끄기"></button></div></div>
  ${S.failed.length ? `<div class="gh danger">저장 못 한 기록 ${S.failed.length}건</div>
    <div class="grp" style="padding:12px 14px"><div class="lbl" style="margin-bottom:8px">${esc(S.failed[0].err || '')}</div>
    <div class="inline"><button class="chip on" data-act="retryFailed">다시 시도</button><button class="chip danger" data-act="dropFailed">버리기</button></div></div>` : ''}
  <div class="gh">가족 · 이 기기</div>
  <div class="grp">${row('가족 · PIN 관리', `${S.users.filter((u) => u.active).length}명`, 'setUsers')}
    ${row('내 PIN 바꾸기', '', 'changePin')}
    ${S.queue.length ? `<div class="sb"><span class="k">올라가기 기다리는 기록</span><span class="v">${S.queue.length}건</span></div>` : ''}
    <button class="sb" data-act="resync"><span class="k">서버<small>${S.auth.url === 'demo' ? '데모 모드' : '구글 시트 연결됨'} · 버전 ${!S.api ? '확인 중' : S.api >= 4 ? `${S.api} 최신` : `${S.api} (새 버전 배포 필요)`}</small></span><span class="v" style="color:var(--ink)">새로고침</span></button>
    ${row('변경 기록', '', 'setLog')}
    <button class="sb" data-act="logout"><span class="k danger">로그아웃</span></button></div>
  ${isAdmin() ? `<div class="gh">관리자</div><div class="grp"><button class="sb" data-act="setReset"><span class="k danger">기록 지우기<small>연습 기록 정리용 · 지우기 전에 시트에 백업해요</small></span><span class="ar">›</span></button></div>` : ''}
  <div style="height:8px"></div>`;
}

/* 설정 항목 하나만 고치는 창들 */
function setSheet(title, body, onSave) {
  openSheet(`<h3>${title}</h3>${body}<button class="primary" id="save">저장</button><button class="ghost" id="cancel">닫기</button>`, (el) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'cancel') closeSheet();
      else if (b.id === 'save') { const v = onSave(el); if (typeof v === 'string') { note(v); return; } if (v) { closeSheet(); saveSettings(v); } }
    });
  });
}
const SET_SHEETS = {
  setName() { setSheet('아기 이름', `<div class="field"><input id="sv" maxlength="12" placeholder="우리 아기" value="${esc(set('babyName'))}"></div>`, () => ({ babyName: $('#sv').value.trim() })); },
  setBirth() { setSheet('생일', `<div class="field"><input id="sv" type="date" value="${esc(set('birthDate'))}" max="${dkey(Date.now())}"></div>`, () => ($('#sv').value ? { birthDate: $('#sv').value } : '날짜를 골라주세요')); },
  setPresets() {
    setSheet('분유 자주 쓰는 양', `<div class="field"><label>ml, 쉼표로 구분 (최대 400)</label><input id="sv" inputmode="numeric" value="${esc(set('feedPresets'))}"></div>`, () => {
      const nums = $('#sv').value.split(/[,\s]+/).map(Number).filter((x) => x > 0 && x <= 400);
      return nums.length ? { feedPresets: nums.join(',') } : '숫자를 쉼표로 구분해 입력해주세요';
    });
  },
  setNight() {
    setSheet('밤잠 시간대', `<div class="grid2"><div class="field"><label>밤잠 시작 (이후 잠은 밤잠)</label><input id="s1" type="time" value="${esc(set('nightStart'))}"></div>
      <div class="field"><label>밤잠 끝 (이전 잠도 밤잠)</label><input id="s2" type="time" value="${esc(set('nightEnd'))}"></div></div>`,
    () => ($('#s1').value && $('#s2').value ? { nightStart: $('#s1').value, nightEnd: $('#s2').value } : '시각을 모두 입력해주세요'));
  },
  setTemp() {
    setSheet('체온 기준', `<div class="grid2"><div class="field"><label>주의 (℃)</label><input id="s1" type="number" step="0.1" inputmode="decimal" value="${esc(set('tempWarn'))}"></div>
      <div class="field"><label>고열 (℃)</label><input id="s2" type="number" step="0.1" inputmode="decimal" value="${esc(set('tempHigh'))}"></div></div>`, () => {
      const a = Number($('#s1').value), h = Number($('#s2').value);
      if (!(a >= 36 && a <= 40 && h >= 36 && h <= 42)) return '체온을 확인해주세요';
      if (h < a) return '고열 기준이 주의보다 높아야 해요';
      return { tempWarn: a.toFixed(1), tempHigh: h.toFixed(1) };
    });
  },
  setNightMode() {
    let v = set('nightMode') === 'midnight' ? 'midnight' : 'start';
    setSheet('밤잠 집계', `<div class="chips" id="nm"><button class="chip ${v === 'start' ? 'on' : ''}" data-v="start">잠든 날 기준</button><button class="chip ${v === 'midnight' ? 'on' : ''}" data-v="midnight">자정 기준</button></div>
      <div class="lbl" style="margin-top:10px;line-height:1.6">잠든 날 기준: 밤 전체를 잠든 날로 셈<br>자정 기준: 0시에서 나눠 각 날짜에 셈</div>`, () => ({ nightMode: v }));
    $('#nm').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; v = b.dataset.v; $('#nm').querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b)); });
  },
  setPlan() {
    const cur = curApply(), names = Object.keys(S.plans);
    openSheet(`<h3>일정표</h3>
      <div class="sb" style="padding:4px 0 10px"><span class="k">지금 적용 중<small>${cur ? `${esc(cur.from)}부터` : ''}</small></span><b>${esc(cur ? cur.name : '-')}</b></div>
      <div class="sec" style="margin-top:4px">일정 바꾸기 <span class="lbl">(지난 날짜는 그날 일정 그대로 비교돼요)</span></div>
      <div class="field"><select id="applyName">${names.map((n) => `<option ${cur && cur.name === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div class="inline"><input type="date" id="applyFrom" value="${dkey(Date.now())}"><button class="chip on" style="flex:0 0 auto" id="apply">이 날부터 적용</button></div>
      <div class="sec">일정 내용 고치기</div>
      <div class="chips">${names.map((n) => `<button class="chip" data-edit="${esc(n)}">${esc(n)} 편집</button>`).join('')}<button class="chip" data-edit="">＋ 새 일정</button></div>
      <button class="ghost" id="cancel">닫기</button>`, (el) => {
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.id === 'cancel') { closeSheet(); return; }
        if (b.dataset.edit != null) { planSheet(b.dataset.edit); return; }
        if (b.id !== 'apply' || b.disabled) return;
        const name = $('#applyName').value, from = $('#applyFrom').value;
        if (!from) { note('적용 시작일을 골라주세요'); return; }
        b.disabled = true;
        try { const j = await call('applyPlan', { name, from }); S.apply = j.data.apply; saveCache(); closeSheet(); render(); note(`${from}부터 ${name} 적용`); }
        catch (err) { b.disabled = false; note(errMsg(err)); }
      });
    });
  },
  setUsers() { usersSheet(S.users.map((u) => ({ name: u.name, active: u.active, oldName: u.name, admin: u.admin }))); },
  async setLog() {
    openSheet('<h3>변경 기록</h3><div class="log" id="logBox"><div>불러오는 중…</div></div><button class="ghost" id="cancel">닫기</button>', (el) => {
      el.addEventListener('click', (e) => { if (e.target.id === 'cancel') closeSheet(); });
    });
    try {
      const j = await call('getLog', {});
      const box = $('#logBox'); if (!box) return;
      box.innerHTML = j.data.log.length ? j.data.log.map((l) => `<div>${esc(l[0])} · ${esc(l[1])} · ${esc(l[2])}</div>`).join('') : '<div>기록이 없어요</div>';
    } catch (e) { const box = $('#logBox'); if (box) box.innerHTML = '<div>불러오지 못했어요</div>'; }
  },
  setReset() { resetSheet(); },
};
/* 가족·PIN: 맨 위 사람이 관리자(기록 지우기 가능). 순서는 바꾸지 않는다 */
function usersSheet(list) {
  const draw = () => `<h3>가족 · PIN 관리</h3><div class="users">${list.map((u, i) => `<div class="item" data-u="${i}">
      <input class="u-name" value="${esc(u.name)}" placeholder="이름" maxlength="10" style="flex:1.1" ${i === 0 && !isAdmin() ? 'disabled' : ''}>
      <input class="u-pin" type="password" inputmode="numeric" maxlength="4" placeholder="${i === 0 && !isAdmin() ? '관리자만 변경' : u.oldName ? '새 PIN' : 'PIN 4자리'}" value="${esc(u.pin || '')}" style="flex:1" ${i === 0 && !isAdmin() ? 'disabled' : ''}>
      ${i === 0 ? '<span class="badge2">관리자</span>' : `<button class="switch ${u.active ? 'on' : ''}" data-i="${i}" aria-label="사용"></button>`}</div>`).join('')}</div>
    <button class="chip" id="add" style="margin-top:6px">＋ 사람 추가</button>
    <div class="lbl" style="margin-top:8px;line-height:1.6">PIN은 바꿀 때만 입력하세요. 비워두면 그대로예요.<br>스위치를 끄면 그 사람은 앱을 못 써요(기록은 남음).</div>
    <button class="primary" id="save">저장</button><button class="ghost" id="cancel">닫기</button>`;
  const read = (el) => el.querySelectorAll('[data-u]').forEach((row) => {
    const u = list[row.dataset.u];
    u.name = row.querySelector('.u-name').value.trim(); u.pin = row.querySelector('.u-pin').value.trim();
  });
  openSheet(draw(), (el) => {
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'cancel') { closeSheet(); return; }
      read(el);
      if (b.dataset.i) { list[b.dataset.i].active = !list[b.dataset.i].active; b.classList.toggle('on', list[b.dataset.i].active); return; }
      if (b.id === 'add') { list.push({ name: '', active: true }); el.innerHTML = draw(); return; }
      if (b.id !== 'save' || b.disabled) return;
      list[0].active = true;
      const rows = list.filter((u) => u.name);
      if (rows.some((u) => u.pin && !/^\d{4}$/.test(u.pin))) { note('PIN은 숫자 4자리로 해주세요'); return; }
      if (rows.some((u) => !u.oldName && !u.pin)) { note('새 사람은 PIN을 입력해주세요'); return; }
      if (new Set(rows.map((u) => u.name)).size !== rows.length) { note('이름이 겹쳐요'); return; }
      const me = rows.find((u) => u.oldName === S.auth.user);
      b.disabled = true;
      try {
        const j = await call('saveUsers', { users: rows.map((u) => ({ name: u.name, pin: u.pin || '', active: u.active, oldName: u.oldName || '' })) });
        S.users = j.data.users;
        if (me) { S.auth.user = me.name; if (me.pin) S.auth.pin = me.pin; LS.set('auth', S.auth); if (!me.active) { closeSheet(); authFailed('사용이 중지됐어요.'); return; } }
        saveCache(); closeSheet(); render(); note('저장했어요');
      } catch (err) { b.disabled = false; note(errMsg(err)); }
    });
  });
}
/* 기록 지우기(관리자만): 범위 선택 → PIN 다시 입력 → '지우기' 입력. 서버가 시트에 백업한 뒤 비움 */
function resetSheet() {
  if (S.api && S.api < 4) { note('서버 코드를 새 버전(4)으로 배포한 뒤에 쓸 수 있어요'); return; }
  let scope = '';
  openSheet(`<h3>기록 지우기</h3>
    <div class="warnbox">지운 기록은 앱에서 사라지고 모든 가족 휴대폰에서도 지워져요.<br>지우기 전에 구글 시트에 '기록_백업_날짜' 탭으로 복사해 둬요.</div>
    <div class="sec" style="margin-top:0">무엇을 지울까요?</div>
    <div class="chips" id="sc" style="flex-direction:column;align-items:stretch">
      <button class="chip" data-s="daily" style="text-align:left;white-space:normal">① 매일 기록만<br><span class="lbl">수유·잠·기저귀·목욕·체온·약·산책·메모·이유식·하루 메모 (키·몸무게·접종·검진·병원·발달·기념일은 남김)</span></button>
      <button class="chip" data-s="all" style="text-align:left;white-space:normal">② 전부<br><span class="lbl">위 기록 + 성장 탭 기록까지 모두</span></button></div>
    <div class="lbl" style="margin:10px 0">일정표·분유 양·체온 기준 같은 설정과 가족·PIN은 그대로예요.</div>
    <div class="field"><label>내 PIN 다시 입력</label><input id="rp" type="password" inputmode="numeric" maxlength="4"></div>
    <div class="field"><label>확인을 위해 <b>지우기</b>라고 써주세요</label><input id="rc" maxlength="5" autocomplete="off"></div>
    <button class="primary red" id="go">기록 지우기</button><button class="ghost" id="cancel">닫기</button>`, (el) => {
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'cancel') { closeSheet(); return; }
      if (b.dataset.s) { scope = b.dataset.s; el.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); return; }
      if (b.id !== 'go' || b.disabled) return;
      if (!scope) { note('지울 범위를 골라주세요'); return; }
      if ($('#rp').value.trim() !== S.auth.pin) { note('PIN이 맞지 않아요'); return; }
      if ($('#rc').value.trim() !== '지우기') { note("'지우기'라고 정확히 써주세요"); return; }
      b.disabled = true; b.textContent = '지우는 중…'; S.resetting = true;
      try {
        if (S.queue.length) await flush();   // 지우기 전 기록까지 먼저 올려서 백업에 들어가게
        if (S.queue.length || S.failed.length) {
          b.disabled = false; b.textContent = '기록 지우기';
          note(S.failed.length ? '저장 못 한 기록이 있어요. 설정에서 먼저 정리해주세요.' : '아직 올라가지 않은 기록이 있어요. 인터넷 연결 후 다시 해주세요.'); return;
        }
        const j = await call('resetRecords', { scope, pin: $('#rp').value.trim(), confirm: '지우기' });
        closeSheet(); S.tab = 'home'; render();
        note(`지웠어요 · 백업: ${j.data.backup}`);
      } catch (err) { b.disabled = false; b.textContent = '기록 지우기'; note(errMsg(err)); }
      finally { S.resetting = false; }
    });
  });
}

/* 로그인
   서버 주소는 공개 저장소에 두지 않고, 가족에게 보내는 링크(주소#s=서버주소)로 한 번 전달해 기기에 저장한다 */
let pinBuf = '';
(function readLinkUrl() {
  const m = location.hash.match(/[#&]s=([^&]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  const url = decodeURIComponent(m[1]);
  const valid = url === 'demo' || /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url);
  // 로그인된 기기에서는 링크로 서버 주소를 바꾸지 않는다(엉뚱한 곳으로 기록이 가지 않게)
  if (valid && !LS.get('auth', null)) LS.set('lastUrl', url);
})();
function viewLogin() {
  const known = API_URL || LS.get('lastUrl', '');
  return `<div class="login"><div class="char">${ART.chars.awake}</div><div class="name" style="font-size:20px;font-weight:600">은우랑</div>
    ${!API_URL ? `<div style="margin:16px 0 0;${known ? 'display:none' : ''}" id="urlBox"><input id="apiUrl" placeholder="서버 주소 (https://script.google.com/...)" value="${esc(known)}"></div>
      ${known ? '<button class="lbl" style="margin-top:8px" onclick="document.getElementById(\'urlBox\').style.display=\'\';this.remove()">서버 주소 바꾸기</button>' : ''}` : ''}
    <div class="lbl" style="margin-top:14px">PIN 4자리를 입력해주세요</div>
    <div class="pin">${[0, 1, 2, 3].map((i) => `<span class="${i < pinBuf.length ? 'on' : ''}"></span>`).join('')}</div>
    <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-act="pin" data-n="${n}">${n}</button>`).join('')}
      <button data-act="pin" data-n="c" style="font-size:14px">지움</button><button data-act="pin" data-n="0">0</button><button data-act="pin" data-n="b" style="font-size:18px">←</button></div>
    <div id="loginMsg" class="lbl" style="margin-top:14px;min-height:20px"></div></div>`;
}
/* PIN을 누르는 동안 서버를 미리 깨워 둔다(구글 서버는 처음 요청에 2~4초 걸리므로) */
let warmedAt = 0;
function warmServer() {
  const url = (S.auth && S.auth.url) || API_URL || LS.get('lastUrl', '');
  if (!/^https:\/\//.test(url) || Date.now() - warmedAt < 60000) return;
  warmedAt = Date.now();
  fetch(url, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
}
async function tryLogin() {
  const url = API_URL || ($('#apiUrl') && $('#apiUrl').value.trim());
  const msg = $('#loginMsg');
  if (!url) { msg.textContent = '서버 주소를 먼저 입력해주세요.'; pinBuf = ''; refreshPin(); return; }
  msg.textContent = '확인 중…';
  const auth = { url, pin: pinBuf, user: '' };
  try {
    const j = await call('login', {}, auth);
    auth.user = j.user;
    const sameServer = LS.get('lastUrl', '') === url;
    S.auth = auth; LS.set('auth', auth); LS.set('lastUrl', url);
    seenReset(j.reset, j.resetScope, true);
    if (!sameServer || !loadCache()) { S.serverTime = 0; S.recs = {}; dirty(); S.loading = true; }
    S.tab = 'home'; render(true);
    sync(true).finally(() => { if (S.loading) { S.loading = false; render(); } });
    if (j.data && j.data.weakPin) setTimeout(() => pinSheet(true), 300);
  } catch (e) {
    pinBuf = '';
    $('#app').innerHTML = viewLogin();
    $('#loginMsg').textContent = e.server ? e.message : '서버에 연결할 수 없어요. 주소와 인터넷을 확인해주세요.';
  }
}
/* 내 PIN 바꾸기 (처음 PIN 그대로면 로그인 직후 바로 띄움) */
function pinSheet(first) {
  openSheet(`<h3>${first ? '처음 PIN을 바꿔주세요' : '내 PIN 바꾸기'}</h3>
    ${first ? '<div class="lbl" style="margin-bottom:10px">처음 설정된 PIN은 누구나 알 수 있어서, 나만 아는 숫자로 바꿔야 안전해요.</div>' : ''}
    <div class="field"><label>새 PIN (숫자 4자리)</label><input id="np" type="password" inputmode="numeric" maxlength="4"></div>
    <div class="field"><label>한 번 더</label><input id="np2" type="password" inputmode="numeric" maxlength="4"></div>
    <button class="primary" id="save">바꾸기</button>${first ? '' : '<button class="ghost" id="cancel">닫기</button>'}`, (el) => {
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'cancel') { closeSheet(); return; }
      if (b.id !== 'save' || b.disabled) return;
      const p = $('#np').value.trim();
      if (!/^\d{4}$/.test(p)) { note('숫자 4자리로 입력해주세요'); return; }
      if (p !== $('#np2').value.trim()) { note('두 번 입력한 PIN이 달라요'); return; }
      b.disabled = true; S.pinChanging = true;
      try { await call('changeMyPin', { pin: p }); S.auth.pin = p; LS.set('auth', S.auth); closeSheet(); note('PIN을 바꿨어요'); }
      catch (err) { note(errMsg(err)); b.disabled = false; }
      finally { S.pinChanging = false; if (S.queue.length) scheduleFlush(300); }
    });
  }, { locked: first });
}
function refreshPin() { const p = $('.pin'); if (p) p.innerHTML = [0, 1, 2, 3].map((i) => `<span class="${i < pinBuf.length ? 'on' : ''}"></span>`).join(''); }
/* 로그아웃해도 아직 안 올라간 기록(대기열)은 지우지 않는다 */
function logout(msg) {
  S.auth = null; LS.del('auth'); pinBuf = ''; S.tab = 'home'; render(true);
  if (msg) $('#loginMsg').textContent = msg;
}

/* ---------- 시트(아래 창)와 알림 ---------- */
function openSheet(html, onMount, opts = {}) {
  closeSheet();
  const d = document.createElement('div');
  d.className = 'dim'; d.id = 'dim';
  d.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
  if (!opts.locked) d.addEventListener('click', (e) => { if (e.target === d) closeSheet(); });
  document.body.appendChild(d);
  if (onMount) onMount(d.firstChild);
}
function closeSheet() { const d = $('#dim'); if (d) d.remove(); }
function ask(msg, yes = '추가', no = '취소') {
  return new Promise((res) => {
    openSheet(`<h3>확인</h3><div style="line-height:1.6">${msg}</div><button class="primary" data-r="1">${yes}</button><button class="ghost" data-r="0">${no}</button>`, (el) => {
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { closeSheet(); res(b.dataset.r === '1'); } });
    });
    $('#dim').addEventListener('click', (e) => { if (e.target.id === 'dim') res(false); });
  });
}
let noteTimer = 0;
function note(t) {
  let n = $('#note');
  if (!n) { n = document.createElement('div'); n.id = 'note'; n.className = 'note'; document.body.appendChild(n); }
  n.textContent = t; clearTimeout(noteTimer); noteTimer = setTimeout(() => n.remove(), 2600);
}

let toastTimer = 0;
function toast(rec, mode, label, opts = {}) {
  closeToast();
  const t = document.createElement('div');
  t.className = 'toast'; t.id = 'toast';
  const field = mode === 'end' ? 'end' : 'start';
  t.innerHTML = `<div class="msg"><span>${esc(label)}</span><small id="toastTime">${hm(rec[field])}</small></div>
    <div class="acts"><button data-t="-5">−5분</button><button data-t="-10">−10분</button><button data-t="edit">시각 수정</button><button data-t="undo" class="x">취소</button></div>
    <div class="timer"><i></i></div>`;
  t.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const v = b.dataset.t;
    const r = S.recs[rec.id]; if (!r) { closeToast(); return; }
    if (v === 'undo') {
      if (mode === 'end') updateRec(r.id, { end: null, kind: opts.prevKind || r.kind }); else removeRec(r.id);
      closeToast(); note('취소했어요'); return;
    }
    if (v === 'edit') { closeToast(); editSheet(r.id); return; }
    const nv = r[field] + Number(v) * MIN;
    if (field === 'end' && nv <= r.start) { note('잠든 시각보다 앞으로 갈 수 없어요'); return; }
    if (field === 'start' && r.type === 'sleep') {
      const prev = sleeps().filter((x) => x.id !== r.id && x.end && x.start < r.start).pop();
      if (prev && nv < prev.end) { note('앞의 잠과 겹쳐요'); return; }
    }
    updateRec(r.id, { [field]: nv });
    $('#toastTime').textContent = hm(nv);
    restartToastTimer(t);
  });
  document.body.appendChild(t);
  restartToastTimer(t);
}
function restartToastTimer(t) {
  clearTimeout(toastTimer);
  const bar = t.querySelector('.timer i');
  bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
  toastTimer = setTimeout(closeToast, 5000);
}
function closeToast() { clearTimeout(toastTimer); const t = $('#toast'); if (t) t.remove(); }

/* ---------- 기록 만들기·고치기 ---------- */
function addRec(r) {
  const rec = Object.assign({ id: uid(), end: null, value: null, d1: '', d2: '', d3: '', kind: '', memo: '', by: S.auth.user, created: Date.now(), updated: Date.now(), deleted: false }, r);
  S.recs[rec.id] = rec; dirty(); render(); saveCache();
  const { _local, _dk, _dks, _nk, _nks, ...send } = rec;
  rec._local = Date.now();
  enqueue({ op: 'add', id: rec.id, rec: send });
  return rec;
}
function updateRec(id, patch) {
  const r = S.recs[id]; if (!r) return;
  Object.assign(r, patch, { updated: Date.now(), _local: Date.now() }); dirty(); render(); saveCache();
  enqueue({ op: 'update', id, rec: { ...patch } });
}
function removeRec(id) {
  const r = S.recs[id]; if (!r) return;
  r.deleted = true; r._local = Date.now(); dirty(); render(); saveCache();
  enqueue({ op: 'remove', id });
}
async function dupCheck(type, fn) {
  const now = Date.now();
  const d = live().filter((r) => r.type === type && Math.abs(now - r.start) < 10 * MIN && r.by !== S.auth.user && (!fn || fn(r))).pop();
  if (!d) return true;
  const x = recText(d);
  return ask(`${Math.max(1, Math.round((now - d.start) / MIN))}분 전에 다른 가족이 <b>${esc(x.t)}</b>을(를) 기록했어요.<br>그래도 추가할까요?`);
}
const LABEL = { bath: '목욕', walk: '산책' };

let lookT = 0;
const ACTIONS = {
  tab(el) {
    S.tab = el.dataset.tab;
    if (S.tab === 'day') { S.day = dkey(Date.now()); S.dayAll = false; S.planAll = false; }
    // 하단 탭을 누르면 패턴·성장은 첫 화면부터
    if (el.closest('#tabs')) { if (S.tab === 'pattern') S.pat.sub = 'week'; if (S.tab === 'growth') GR.sub = 'growth'; }
    closeToast(); render(); window.scrollTo(0, 0);
  },
  patSub(el) { S.pat.sub = el.dataset.k; render(); window.scrollTo(0, 0); },
  dayMore(el) { S[el.dataset.k] = !S[el.dataset.k]; render(); },
  alertGo(el) {
    const k = el.dataset.k;
    if (k === 'memo') { S.tab = 'day'; S.day = dkey(Date.now()); } else { S.tab = 'growth'; GR.sub = k === 'anni' ? 'anni' : 'health'; if (k === 'health') GR.health = 'vax'; }
    closeToast(); render(); window.scrollTo(0, 0);
  },
  goPlan() { const c = curApply(); planSheet(c ? c.name : (Object.keys(S.plans)[0] || '')); },
  look(el) {
    // 화면 전체를 다시 그리지 않고 고른 표시만 바꾼다(글씨체가 바뀌면 다시 그리기가 무거움)
    const k = el.dataset.k, v = el.dataset.v;
    // 글씨체는 화면 전체 글자를 다시 배치해야 해서 무거움: 고른 표시를 먼저 보여주고 바로 다음에 적용
    if (k === 'font') { LOOK.set(k, v, true); clearTimeout(lookT); lookT = setTimeout(() => LOOK.apply(), 60); } else LOOK.set(k, v);
    document.querySelectorAll(`[data-act="look"][data-k="${k}"]`).forEach((b) => {
      const on = b.dataset.v === v;
      b.classList.toggle('on', on);
      if (k === 'theme') b.lastChild.textContent = (LOOK.themes.find((t) => t.k === b.dataset.v) || {}).n + (on ? ' ✓' : '');
    });
  },
  async photo(el) {
    const r = await LOOK.pickPhoto(el.dataset.slot);
    if (r === 'ok') { render(); note('사진을 바꿨어요'); }
    else if (r === 'bad') note('이 사진은 열 수 없어요. 다른 사진을 골라주세요.');
    else if (r === 'full') note('휴대폰 저장 공간이 부족해 사진을 저장하지 못했어요');
  },
  photoClear(el) { LOOK.clearPhoto(el.dataset.slot); render(); },
  async quick(el) {
    const type = el.dataset.type;
    if (type === 'bath' && !(await dupCheck('bath'))) return;
    const r = addRec({ type, start: Date.now() });
    toast(r, 'new', `${LABEL[type]} 기록했어요`);
  },
  async sleep() {
    const now = Date.now();
    const opens = sleeps().filter((r) => !r.end);
    if (opens.length) {
      const first = opens[0];
      if (now - first.start < MIN) { note('잠든 지 1분도 안 됐어요. 취소하려면 기록을 눌러 삭제하세요.'); return; }
      // 두 사람이 동시에 '잠 시작'을 눌러 열린 잠이 여러 개면 가장 먼저 시작한 것 하나로 합친다
      opens.slice(1).forEach((r) => removeRec(r.id));
      const prevKind = first.kind;
      const kind = sleepKind(first.start, now);
      updateRec(first.id, { end: now, kind });
      toast(S.recs[first.id], 'end', `${kind === '밤' ? '밤잠' : '낮잠'} ${minTxt((now - first.start) / MIN)} 기록했어요`, { prevKind });
      if (opens.length > 1) note('동시에 기록된 잠을 하나로 합쳤어요');
      return;
    }
    if (!(await dupCheck('sleep'))) return;
    const r = addRec({ type: 'sleep', start: now, kind: isNightTime(now) ? '밤' : '낮' });
    toast(r, 'new', `${r.kind === '밤' ? '밤잠' : '낮잠'} 시작`);
    quickSync();
  },
  feed() { quickSync(); feedSheet(); },
  diaper() { quickSync(); diaperSheet(); },
  temp() { tempSheet(); },
  med() { medSheet(); },
  memo() { memoSheet(); },
  food() { foodSheet(); },
  edit(el) { editSheet(el.dataset.id); },
  day(el) {
    const n = addDays(S.day, Number(el.dataset.d));
    if (n > dkey(Date.now())) return;
    S.day = n; S.dayAll = false; S.planAll = false; render();
    ensureRange(n);
  },
  pin(el) {
    const n = el.dataset.n;
    if (n === 'c') pinBuf = ''; else if (n === 'b') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 8) pinBuf += n;
    refreshPin();
    if (pinBuf.length === 4) tryLogin();
  },
  toggle(el) { const k = el.dataset.k; saveSettings({ [k]: set(k) === 'true' ? 'false' : 'true' }); },
  resync() { note('새로 불러오는 중…'); sync(true); },
  changePin() { pinSheet(false); },
  patMode(el) { if (S.pat.mode === el.dataset.m) return; S.pat.mode = el.dataset.m; S.pat.offset = 0; render(); },
  patNav(el) {
    const n = S.pat.offset + Number(el.dataset.d);
    if (n > 0) return;
    S.pat.offset = n; render();
    ensureRange(patKeys()[0]);
  },
  patToggle(el) { const t = patToggles(); t[el.dataset.k] = !t[el.dataset.k]; LS.set('patToggles', t); render(); },
  patDay(el) { S.day = el.dataset.d; S.tab = 'day'; S.dayAll = false; S.planAll = false; closeToast(); render(); window.scrollTo(0, 0); ensureRange(S.day); },
  patPeriod(el) { S.pat.period = Number(el.dataset.n); render(); ensureRange(addDays(dkey(Date.now()), -S.pat.period - 7)); },
  patTrend(el) { S.pat.trend = el.dataset.t; render(); },
  addPast() {
    const types = ['feed', 'sleep', 'diaper', 'bath', 'temp', 'med', 'walk', 'memo'].concat(set('showFood') === 'true' ? ['food'] : []);
    const now = Date.now();
    const start = S.day === dkey(now) ? now - 30 * MIN : at(S.day, '12:00');
    openSheet(`<h3>지난 기록 추가 · ${dayLabel(S.day)}</h3><div class="lbl" style="margin-bottom:10px">무엇을 기록할까요? 다음 화면에서 시각을 고를 수 있어요.</div>
      <div class="chips">${types.map((t) => `<button class="chip" data-t="${t}">${TYPES[t].n}</button>`).join('')}</div>`, (el) => {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-t]'); if (!b) return;
        const t = b.dataset.t;
        const draft = { type: t, start };
        if (t === 'sleep') draft.end = Math.min(start + 60 * MIN, now);
        if (t === 'feed') { const lf = lastOf('feed'); draft.value = (lf && Number(lf.value)) || 150; }
        if (t === 'diaper') draft.d1 = '소변';
        if (t === 'temp') draft.value = 36.8;
        if (t === 'food') draft.d3 = '없음';
        editSheet(draft);
      });
    });
  },
  retryFailed() { S.queue.push(...S.failed.map((o) => Object.assign(o, { tries: 0, sending: false, err: undefined }))); S.failed = []; saveQueue(); render(); flush(); },
  async dropFailed() { if (await ask(`저장 못 한 기록 ${S.failed.length}건을 버릴까요?`, '버리기')) { S.failed = []; saveQueue(); render(); } },
  async logout() {
    const n = S.queue.length;
    if (await ask(`이 기기에서 로그아웃할까요?${n ? `<br><span class="lbl">아직 올라가지 않은 기록 ${n}건은 다시 로그인하면 이어서 올라가요.</span>` : ''}`, '로그아웃')) logout();
  },
};
Object.assign(ACTIONS, GROWTH_ACTIONS, SET_SHEETS);
/* 서버를 기다리는 버튼은 누르는 동안 막아 두 번 눌리지 않게 */
function busy(fn) {
  let running = false;
  return async (el) => {
    if (running) return;
    running = true; if (el) el.disabled = true;
    try { await fn(el); } finally { running = false; if (el && el.isConnected) el.disabled = false; }
  };
}

/* 설정 저장: 순서대로 하나씩 보내 서로 덮어쓰지 않게 */
let settingsChain = Promise.resolve();
function saveSettings(values) {
  const prev = {}; Object.keys(values).forEach((k) => { prev[k] = S.settings[k]; });
  Object.assign(S.settings, values); dirty(); render(); saveCache();
  settingsChain = settingsChain.then(async () => {
    try { const j = await call('setSettings', { values }); Object.keys(values).forEach((k) => { S.settings[k] = j.data.settings[k]; }); saveCache(); render(); }
    catch (e) { Object.assign(S.settings, prev); render(); note(e.server ? e.message : '설정은 인터넷 연결이 필요해요'); }
  });
  return settingsChain;
}

/* 분유 */
function feedSheet() {
  const presets = String(set('feedPresets')).split(',').map((x) => Number(x.trim())).filter((x) => x > 0);
  const last = lastOf('feed');
  let amt = last ? Number(last.value) || presets[0] || 120 : presets[0] || 120;
  openSheet(`<h3>${ART.icons.feed}분유</h3>
    <div class="chips" id="pre">${presets.map((p) => `<button class="chip ${p === amt ? 'on' : ''}" data-p="${p}">${p}</button>`).join('')}</div>
    <div class="amount"><button class="round" data-d="-5">−5</button><div class="n" id="amt">${amt}<small>ml</small></div><button class="round" data-d="5">+5</button></div>
    <button class="primary feed" id="save">저장</button>`, (el) => {
    const show = () => { $('#amt').innerHTML = `${amt}<small>ml</small>`; el.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('on', Number(b.dataset.p) === amt)); };
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.p) { amt = Number(b.dataset.p); show(); }
      else if (b.dataset.d) { amt = Math.max(5, Math.min(400, amt + Number(b.dataset.d))); show(); }
      else if (b.id === 'save') {
        closeSheet();
        if (!(await dupCheck('feed'))) return;
        const r = addRec({ type: 'feed', start: Date.now(), value: amt });
        toast(r, 'new', `분유 ${amt}ml 기록했어요`);
      }
    });
  });
}

/* 기저귀 */
const POO_COLORS = [['노랑', '#EF9F27'], ['갈색', '#854F0B'], ['초록', '#639922'], ['흰색·회색', '#ECEAF6'], ['빨강', '#E24B4A'], ['검정', '#2C2C2A']];
const POO_STATES = ['묽음', '보통', '단단', '점액'];
function diaperSheet() {
  openSheet(`<h3>${ART.icons.diaper}기저귀</h3>
    <div class="grid2" style="grid-template-columns:1fr 1fr 1fr"><button class="chip" data-k="소변">소변</button><button class="chip" data-k="대변">대변</button><button class="chip" data-k="둘다">둘 다</button></div>
    <div id="poo" style="display:none">
      <div class="sec">색 (선택)</div><div class="chips" id="pc">${POO_COLORS.map(([n, c]) => `<button class="chip" data-c="${n}"><span class="dot" style="background:${c}"></span>${n}</button>`).join('')}</div>
      <div class="sec">상태 (선택)</div><div class="chips" id="ps">${POO_STATES.map((n) => `<button class="chip" data-s="${n}">${n}</button>`).join('')}</div>
      <button class="primary" id="save" style="background:var(--diaper);color:var(--diaper-ink)">저장</button></div>`, (el) => {
    let kind = '', color = '', state = '';
    const pick = (attr, v) => el.querySelectorAll(`[data-${attr}]`).forEach((b) => b.classList.toggle('on', b.dataset[attr] === v));
    const save = async () => {
      closeSheet();
      if (!(await dupCheck('diaper'))) return;
      const r = addRec({ type: 'diaper', start: Date.now(), d1: kind, d2: color, d3: state });
      toast(r, 'new', `${kind === '둘다' ? '소변 + 대변' : kind} 기록했어요`);
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.k) {
        kind = b.dataset.k; pick('k', kind);
        if (kind === '소변') save(); else $('#poo').style.display = '';
      } else if (b.dataset.c) { color = color === b.dataset.c ? '' : b.dataset.c; pick('c', color); }
      else if (b.dataset.s) { state = state === b.dataset.s ? '' : b.dataset.s; pick('s', state); }
      else if (b.id === 'save') save();
    });
  });
}

/* 체온 */
function tempSheet() {
  const last = lastOf('temp');
  let v = last && Date.now() - last.start < 2 * DAY ? Number(last.value) : 36.8;
  openSheet(`<h3>${ART.icons.temp}체온</h3>
    <div class="amount"><button class="round" data-d="-0.1">−</button><div class="n" id="tv">${v.toFixed(1)}<small>℃</small></div><button class="round" data-d="0.1">+</button></div>
    <div class="lbl" style="text-align:center" id="tw"></div><button class="primary" id="save">저장</button>`, (el) => {
    const show = () => {
      $('#tv').innerHTML = `${v.toFixed(1)}<small>℃</small>`;
      const tw = $('#tw');
      tw.textContent = v >= Number(set('tempHigh')) ? '고열 기준 이상이에요' : v >= Number(set('tempWarn')) ? '주의 기준 이상이에요' : '';
      tw.className = v >= Number(set('tempHigh')) ? 'c-danger' : 'c-over';
    };
    show();
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.d) { v = Math.round((v + Number(b.dataset.d)) * 10) / 10; v = Math.max(34, Math.min(42, v)); show(); }
      else if (b.id === 'save') { closeSheet(); const r = addRec({ type: 'temp', start: Date.now(), value: v }); toast(r, 'new', `체온 ${v.toFixed(1)}℃ 기록했어요`); }
    });
  });
}

/* 약 */
function medSheet() {
  const names = [...new Set(live().filter((r) => r.type === 'med' && r.d1).map((r) => r.d1).reverse())].slice(0, 8);
  openSheet(`<h3>${ART.icons.med}약</h3>
    ${names.length ? `<div class="sec">최근 먹인 약</div><div class="chips">${names.map((n) => `<button class="chip" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
    <div class="field" style="margin-top:12px"><label>약 이름</label><input id="mn" maxlength="30" placeholder="예: 해열제"></div>
    <div class="field"><label>양</label><input id="ma" maxlength="20" placeholder="예: 2.5ml"></div>
    <button class="primary" id="save">저장</button>`, (el) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.n) {
        $('#mn').value = b.dataset.n;
        const prev = live().filter((r) => r.type === 'med' && r.d1 === b.dataset.n).pop();
        if (prev && prev.d2) $('#ma').value = prev.d2;
      } else if (b.id === 'save') {
        const n = $('#mn').value.trim(); if (!n) { note('약 이름을 입력해주세요'); return; }
        closeSheet(); const r = addRec({ type: 'med', start: Date.now(), d1: n, d2: $('#ma').value.trim() }); toast(r, 'new', `약 ${n} 기록했어요`);
      }
    });
  });
}

/* 메모 */
function memoSheet() {
  openSheet(`<h3>${ART.icons.memo}메모</h3><textarea id="mt" rows="3" maxlength="300" placeholder="남길 내용"></textarea><button class="primary" id="save">저장</button>`, (el) => {
    setTimeout(() => $('#mt').focus(), 50);
    el.addEventListener('click', (e) => {
      if (e.target.id !== 'save') return;
      const t = $('#mt').value.trim(); if (!t) { note('내용을 입력해주세요'); return; }
      closeSheet(); const r = addRec({ type: 'memo', start: Date.now(), memo: t }); toast(r, 'new', '메모 기록했어요');
    });
  });
}

/* 이유식 */
const FOOD_REACT = ['없음', '발진', '구토', '설사', '기타'];
function foodSheet() {
  openSheet(`<h3>${ART.icons.food}이유식</h3>
    <div class="field"><label>재료</label><input id="fi" maxlength="40" placeholder="예: 쌀미음, 애호박"></div>
    <div class="field"><label>양</label><div class="inline"><input id="fv" type="number" inputmode="decimal" placeholder="숫자"><select id="fu"><option>g</option><option>숟가락</option></select></div></div>
    <div class="sec">반응</div><div class="chips">${FOOD_REACT.map((n, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-r="${n}">${n}</button>`).join('')}</div>
    <button class="primary" id="save">저장</button>`, (el) => {
    let react = '없음';
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.r) { react = b.dataset.r; el.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x.dataset.r === react)); }
      else if (b.id === 'save') {
        const i = $('#fi').value.trim(); if (!i) { note('재료를 입력해주세요'); return; }
        closeSheet();
        const r = addRec({ type: 'food', start: Date.now(), d1: i, value: $('#fv').value ? Number($('#fv').value) : null, d2: $('#fu').value, d3: react });
        toast(r, 'new', `이유식 ${i} 기록했어요`);
      }
    });
  });
}

/* 기록 수정 */
/* editSheet(기록 id) = 수정, editSheet({type, start}) = 지난 기록 새로 추가 */
function editSheet(arg) {
  const isNew = typeof arg === 'object';
  const r = isNew ? Object.assign({ end: null, value: null, d1: '', d2: '', d3: '', kind: '', memo: '', by: S.auth.user }, arg) : S.recs[arg];
  if (!r) return;
  const id = isNew ? null : arg;
  const T = TYPES[r.type] || { n: r.type, i: 'memo' };
  let body = `<div class="field"><label>${r.type === 'sleep' ? '잠든 시각' : '시각'}</label><input type="datetime-local" id="es" value="${toLocalInput(r.start)}"></div>`;
  if (r.type === 'sleep') body += `<div class="field"><label>깬 시각 (비우면 자는 중)</label><input type="datetime-local" id="ee" value="${toLocalInput(r.end)}"></div>
    <div class="field"><label>구분 <span class="lbl">(시각을 바꾸면 자동으로 다시 판단)</span></label><select id="ek"><option value="">자동</option><option ${!isNew && r.kind === '낮' ? 'selected' : ''}>낮</option><option ${!isNew && r.kind === '밤' ? 'selected' : ''}>밤</option></select></div>`;
  if (r.type === 'feed') body += `<div class="field"><label>양 (ml)</label><input type="number" inputmode="numeric" id="ev" value="${esc(r.value)}"></div>`;
  if (r.type === 'temp') body += `<div class="field"><label>체온 (℃)</label><input type="number" step="0.1" inputmode="decimal" id="ev" value="${esc(r.value)}"></div>`;
  if (r.type === 'diaper') body += `<div class="field"><label>종류</label><select id="e1">${['소변', '대변', '둘다'].map((k) => `<option ${r.d1 === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
    <div class="field"><label>색</label><select id="e2"><option value="">선택 안 함</option>${POO_COLORS.map(([n]) => `<option ${r.d2 === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="field"><label>상태</label><select id="e3"><option value="">선택 안 함</option>${POO_STATES.map((n) => `<option ${r.d3 === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  if (r.type === 'med') body += `<div class="field"><label>약 이름</label><input id="e1" value="${esc(r.d1)}"></div><div class="field"><label>양</label><input id="e2" value="${esc(r.d2)}"></div>`;
  if (r.type === 'food') body += `<div class="field"><label>재료</label><input id="e1" value="${esc(r.d1)}"></div>
    <div class="field"><label>양</label><div class="inline"><input type="number" id="ev" value="${esc(r.value)}"><select id="e2">${['g', '숟가락'].map((u) => `<option ${r.d2 === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
    <div class="field"><label>반응</label><select id="e3">${FOOD_REACT.map((n) => `<option ${r.d3 === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  body += `<div class="field"><label>${r.type === 'memo' ? '내용' : '메모'}</label><textarea id="em" rows="2" maxlength="300">${esc(r.memo)}</textarea></div>`;
  openSheet(`<h3>${ART.icons[T.i]}${T.n} ${isNew ? '기록 추가' : '기록 수정'}</h3>${body}
    <button class="primary" id="save">${isNew ? '추가' : '저장'}</button>${isNew ? '<button class="ghost" id="cancel">닫기</button>' : '<button class="ghost danger" id="del">삭제</button>'}`, (el) => {
    el.addEventListener('change', (e) => { if ((e.target.id === 'es' || e.target.id === 'ee') && $('#ek')) $('#ek').value = ''; });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'cancel') { closeSheet(); return; }
      if (b.id === 'del') { if (await ask('이 기록을 삭제할까요?', '삭제')) { removeRec(id); note('삭제했어요'); } else editSheet(id); return; }
      if (b.id !== 'save') return;
      const patch = { start: fromLocalInput($('#es').value), memo: $('#em').value.trim() };
      if (!patch.start) { note('시각을 입력해주세요'); return; }
      if (patch.start > Date.now() + 5 * MIN) { note('미래 시각은 저장할 수 없어요'); return; }
      if (r.type === 'sleep') {
        patch.end = fromLocalInput($('#ee').value);
        if (patch.end && patch.end <= patch.start) { note('깬 시각이 잠든 시각보다 늦어야 해요'); return; }
        if (patch.end && patch.end > Date.now() + 5 * MIN) { note('깬 시각이 미래예요'); return; }
        if (!patch.end && openSleep() && openSleep().id !== id) { note('이미 자는 중인 기록이 있어요'); return; }
        patch.kind = $('#ek').value || (patch.end ? sleepKind(patch.start, patch.end) : (isNightTime(patch.start) ? '밤' : '낮'));
        // 겹침 검사는 시각을 새로 넣거나 바꿀 때만. 수정은 알려주고 고를 수 있게(메모만 고칠 때 막히지 않게)
        const timesChanged = isNew || patch.start !== r.start || patch.end !== r.end;
        if (timesChanged) {
          const s2 = patch.start, e2 = patch.end || Date.now();
          const clash = sleeps().find((x) => x.id !== id && x.start < e2 && (x.end || Date.now()) > s2);
          if (clash) {
            if (isNew) { note(`${hm(clash.start)} 잠 기록과 시간이 겹쳐요`); return; }
            if (!(await ask(`${hm(clash.start)} 잠 기록과 시간이 겹쳐요. 그래도 저장할까요?`, '저장'))) { editSheet(id); return; }
          }
        }
      }
      if ($('#ev')) patch.value = $('#ev').value === '' ? null : Number($('#ev').value);
      if (r.type === 'feed' && !(patch.value > 0)) { note('양을 입력해주세요'); return; }
      if (r.type === 'temp' && !(patch.value >= 34 && patch.value <= 42)) { note('체온을 확인해주세요'); return; }
      if ($('#e1')) patch.d1 = $('#e1').value.trim();
      if ($('#e2')) patch.d2 = $('#e2').value.trim();
      if ($('#e3')) patch.d3 = $('#e3').value.trim();
      if ((r.type === 'med' || r.type === 'food') && !patch.d1) { note(r.type === 'med' ? '약 이름을 입력해주세요' : '재료를 입력해주세요'); return; }
      if (r.type === 'memo' && !patch.memo) { note('내용을 입력해주세요'); return; }
      closeSheet();
      if (isNew) {
        addRec(Object.assign({ type: r.type }, patch));
        if (dkey(patch.start) !== S.day && S.tab === 'day') { S.day = dkey(patch.start); render(); }
        note('추가했어요');
      } else { updateRec(id, patch); note('수정했어요'); }
    });
  });
}

/* 일정 편집 */
function planSheet(name) {
  const p = JSON.parse(JSON.stringify(S.plans[name] || { wake: '07:00', bed: '19:40', bath: '19:00', feedInterval: 180, feeds: [['07:20', '수유1']], naps: [['09:00', '10:00', '']] }));
  const draw = () => `<h3>${name ? `${esc(name)} 편집` : '새 일정'}</h3>
    ${name ? '' : '<div class="field"><label>일정 이름</label><input id="pn" placeholder="예: 낮잠 2회"></div>'}
    <div class="grid2"><div class="field"><label>기상</label><input type="time" data-f="wake" value="${esc(p.wake)}"></div><div class="field"><label>밤잠 시작</label><input type="time" data-f="bed" value="${esc(p.bed)}"></div>
    <div class="field"><label>목욕</label><input type="time" data-f="bath" value="${esc(p.bath || '')}"></div><div class="field"><label>수유 간격(분)</label><input type="number" data-f="feedInterval" value="${esc(p.feedInterval)}"></div></div>
    <div class="sec">낮잠 (시작 · 끝 · 최대 분)</div><table class="plantbl">${p.naps.map((n, i) => `<tr><td>${i + 1}</td><td><input type="time" data-n="${i}" data-j="0" value="${esc(n[0])}"></td><td><input type="time" data-n="${i}" data-j="1" value="${esc(n[1])}"></td><td><input type="number" data-n="${i}" data-j="2" value="${esc(n[2] || '')}" placeholder="-"></td><td><button class="chip" data-delnap="${i}">×</button></td></tr>`).join('')}</table>
    <button class="chip" data-addnap="1" style="margin-top:6px">＋ 낮잠</button>
    <div class="sec">수유 (시각 · 이름)</div><table class="plantbl">${p.feeds.map((f, i) => `<tr><td><input type="time" data-fe="${i}" data-j="0" value="${esc(f[0])}"></td><td><input data-fe="${i}" data-j="1" value="${esc(f[1])}"></td><td><button class="chip" data-delfeed="${i}">×</button></td></tr>`).join('')}</table>
    <button class="chip" data-addfeed="1" style="margin-top:6px">＋ 수유</button>
    <div class="lbl" style="margin-top:10px">깨시는 기상·낮잠·밤잠 시각으로 자동 계산돼요.</div>
    <button class="primary" id="save">저장</button><button class="ghost" id="cancel">닫기</button>`;
  const read = (el) => {
    el.querySelectorAll('[data-f]').forEach((i) => { p[i.dataset.f] = i.dataset.f === 'feedInterval' ? Number(i.value) || 180 : i.value; });
    el.querySelectorAll('[data-n]').forEach((i) => { p.naps[i.dataset.n][i.dataset.j] = i.value; });
    el.querySelectorAll('[data-fe]').forEach((i) => { p.feeds[i.dataset.fe][i.dataset.j] = i.value; });
  };
  openSheet(draw(), (el) => {
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const nm = name || ($('#pn') && $('#pn').value.trim());
      read(el);
      if (b.dataset.addnap) p.naps.push(['', '', '']);
      else if (b.dataset.delnap) p.naps.splice(Number(b.dataset.delnap), 1);
      else if (b.dataset.addfeed) p.feeds.push(['', `수유${p.feeds.length + 1}`]);
      else if (b.dataset.delfeed) p.feeds.splice(Number(b.dataset.delfeed), 1);
      else if (b.id === 'cancel') { closeSheet(); return; }
      else if (b.id === 'save') {
        if (b.disabled) return;
        if (!nm) { note('일정 이름을 입력해주세요'); return; }
        if (!name && S.plans[nm]) { note('같은 이름의 일정이 있어요'); return; }
        const bad = !p.wake || !p.bed || p.naps.some((n) => !n[0] || !n[1] || toMin(n[1]) <= toMin(n[0])) || p.feeds.some((f) => !f[0]);
        if (bad) { note('비어 있거나 끝이 시작보다 빠른 칸이 있어요'); return; }
        p.naps.sort((a, c) => toMin(a[0]) - toMin(c[0])); p.feeds.sort((a, c) => toMin(a[0]) - toMin(c[0]));
        b.disabled = true;
        try {
          const j = await call('savePlan', { name: nm, plan: p });
          S.plans = j.data.plans; saveCache(); closeSheet(); render();
          const cur = [...S.apply].sort((a, c) => (a.from < c.from ? -1 : 1)).filter((a) => a.from <= dkey(Date.now())).pop();
          if (cur && cur.name === nm && await ask('지금 쓰는 일정이에요. 오늘부터 바뀐 내용으로 적용할까요?<br><span class="lbl">지난 날짜는 예전 내용 그대로 비교돼요.</span>', '오늘부터 적용', '나중에')) {
            const k = await call('applyPlan', { name: nm, from: dkey(Date.now()) }); S.apply = k.data.apply; saveCache(); render();
          }
          note('일정 저장됨');
        } catch (err) { b.disabled = false; note(err.server ? err.message : '일정 저장은 인터넷 연결이 필요해요'); }
        return;
      } else return;
      el.innerHTML = draw();
      if (!name && nm) $('#pn').value = nm;
    });
  });
}

/* 지난 날짜 불러오기 */
let rangeLoading = null;
async function ensureRange(key) {
  const a = dstart(key);
  if (!S.loadedFrom || a >= S.loadedFrom || rangeLoading) return;   // 이미 불러오는 중이면 겹쳐 보내지 않음
  const from = dstart(addDays(key, -30)), to = S.loadedFrom;
  rangeLoading = (async () => {
    try {
      const w0 = S.wipeN || 0;
      const j = await call('range', { from, to });
      if ((S.wipeN || 0) !== w0) return;   // 응답 도중 기록 지우기: 옛 기록을 되살리지 않음
      mergeRecs(j.data.recs); S.loadedFrom = Math.min(S.loadedFrom, from); bgRender();
    } catch (e) { note('지난 기록을 불러오지 못했어요'); }
  })();
  try { await rangeLoading; } finally { rangeLoading = null; }
  if (a < S.loadedFrom) ensureRange(key);
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('.sheet') || el.closest('.toast')) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.set) {
    if (el.tagName === 'SELECT') el.blur();   // 고른 뒤 바로 화면에 반영되게(선택 칸이 포커스를 잡고 있으면 다시 그리기를 미룸)
    let v = el.value.trim();
    if (el.dataset.set === 'feedPresets') {
      const nums = v.split(/[,\s]+/).map(Number).filter((x) => x > 0 && x <= 400);
      if (!nums.length) { note('숫자를 쉼표로 구분해 입력해주세요'); el.value = set('feedPresets'); return; }
      v = nums.join(',');
    }
    if (el.dataset.set === 'nightStart' || el.dataset.set === 'nightEnd' || el.dataset.set === 'birthDate') { if (!v) { el.value = set(el.dataset.set); return; } }
    saveSettings({ [el.dataset.set]: v });
  }
  if (el.id === 'daymemo') saveDayMemo(el);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'daymemo') e.target.blur(); });
let memoTimer = 0;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'daymemo') return;
  clearTimeout(memoTimer); const el = e.target;
  memoTimer = setTimeout(() => saveDayMemo(el, true), 800);
});
function saveDayMemo(el, quiet) {
  if (!S.auth) return;
  clearTimeout(memoTimer);
  const key = el.dataset.key, text = el.value.trim();
  const cur = S.memos[key];
  if ((cur ? cur.text : '') === text) return;
  S.memos[key] = { text, by: S.auth.user }; saveCache();
  enqueue({ op: 'memo', id: key, text });
  if (!quiet) note('메모 저장됨');
}

/* 주기적 갱신: 화면 숫자 30초마다, 서버 확인 20초마다(앱이 보일 때만, 바뀐 게 없으면 거의 비용 없음) */
setInterval(() => { if (S.auth && !document.hidden && S.tab === 'home') bgRender(); }, 30000);
setInterval(() => { if (S.auth && !document.hidden) sync(); }, 20000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { const m = $('#daymemo'); if (m) saveDayMemo(m, true); writeCache(); if (S.queue.length) flush(); return; }
  if (S.auth) { render(); sync(); warmServer(); }
  checkUpdate();
});
window.addEventListener('online', () => { if (S.auth) flush(); });

/* 새 버전: 앱이 다시 보일 때 확인하고, 입력 중이 아닐 때 조용히 새로고침 */
let swReg = null, reloading = false;
function checkUpdate() { if (swReg) swReg.update().catch(() => {}); }
function safeReload() {
  if (reloading) return;
  if (typing() || $('#dim') || $('#toast')) { setTimeout(safeReload, 3000); return; }
  reloading = true; location.reload();
}

/* 시작 */
(function start() {
  // 휴대폰이 저장 공간을 정리할 때 대기 기록·서버 주소가 지워지지 않도록 요청
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  if (S.auth) {
    const had = loadCache();
    if (!had) S.loading = true;
    render();
    sync(!had).finally(() => { if (S.loading) { S.loading = false; render(); } });
    warmServer();
    if (S.queue.length) scheduleFlush(300);
  } else render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) safeReload(); });
    navigator.serviceWorker.register('./sw.js').then((r) => { swReg = r; }).catch(() => {});
  }
})();
