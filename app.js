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
const DEF = { babyName: '', birthDate: '2026-07-30', feedPresets: '105,135,150,170,200', nightStart: '19:00', nightEnd: '07:00', tempWarn: '37.5', tempHigh: '38.0', showFood: 'false', nightMode: 'start' };
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
  cacheTimer = setTimeout(() => {
    const cut = Date.now() - 60 * DAY;
    LS.set('cache', { settings: S.settings, plans: S.plans, apply: S.apply, users: S.users, memos: S.memos, serverTime: S.serverTime,
      loadedFrom: Math.max(S.loadedFrom, cut), recs: Object.values(S.recs).filter((r) => r.start >= cut) });
  }, 300);
}
function dirty() { S._sorted = null; }
function live() {
  if (!S._sorted) S._sorted = Object.values(S.recs).filter((r) => !r.deleted && r.start).sort((a, b) => a.start - b.start);
  return S._sorted;
}

/* ---------- 서버 통신 ---------- */
async function call(action, data, auth = S.auth) {
  if (!auth) { const e = new Error('로그인이 필요해요'); e.code = 'pin'; throw e; }
  if (auth.url === 'demo') return DEMO.call(action, data, auth.pin);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 40000);
  try {
    const res = await fetch(auth.url, { method: 'POST', body: JSON.stringify({ action, pin: auth.pin, data }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctrl.signal });
    const j = await res.json();
    if (!j.ok) { const e = new Error(j.err || '서버 오류'); e.server = true; e.code = j.code || 'error'; e.pinUsed = auth.pin; throw e; }
    return j;
  } finally { clearTimeout(t); }
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
function applyMeta(d) {
  if (d.settings) S.settings = d.settings;
  if (d.plans) S.plans = d.plans;
  if (d.apply) S.apply = d.apply;
  if (d.users) S.users = d.users;
  if (d.memos) {
    const busy = new Set(S.queue.filter((q) => q.op === 'memo').map((q) => q.id));
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
    const sentAt = Date.now();
    const j = isFull ? await call('load', {}) : await call('sync', { since: S.serverTime - 3 * MIN, rev: S.rev || 0 });
    if (!S.auth) return;
    lastSync = Date.now();
    if (!isFull && j.data.same) { S.rev = j.rev; return; }
    if (isFull) {
      const keep = new Set([...S.queue, ...S.failed].map((q) => q.id));
      Object.keys(S.recs).forEach((id) => { const r = S.recs[id]; if (!keep.has(id) && !(r._local && r._local >= sentAt)) delete S.recs[id]; });
      S.loadedFrom = j.now - 45 * DAY;
    }
    applyMeta(j.data);
    mergeRecs(j.data.recs || [], sentAt);
    S.serverTime = j.now; S.rev = j.rev;
    if (j.user && j.user !== S.auth.user) { S.auth.user = j.user; LS.set('auth', S.auth); }
    saveCache();
    render();
  } catch (e) {
    if (isAuthErr(e)) authFailed(e.code === 'locked' ? e.message : null);
  } finally { syncing = false; }
}
/* 화면을 막지 않고, 최근 동기화가 오래됐으면 조용히 새로 받아온다 */
function quickSync() { if (Date.now() - lastSync > 15000) sync(); }

/* 기록 저장 대기열: 같은 기록에 대한 변경은 합쳐서 보낸다 */
function enqueue(op) {
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
    if (m) m.text = op.text; else q.push(op);
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
      try {
        j = await call('batch', { ops: ops.map((o) => ({ op: o.op, id: o.id, rec: o.rec, text: o.text })) });
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
          if (r.rec && !S.queue.some((x) => x !== o && x.id === o.id)) {
            // 이 기기에서 고친 시각 표시는 유지: 동시에 진행 중이던 옛 동기화 응답이 덮어쓰지 못하게
            const prev = S.recs[r.rec.id];
            if (prev && prev._local) r.rec._local = prev._local;
            S.recs[r.rec.id] = r.rec; dirty();
          }
        } else if (r.code === 'retry') again = true;
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
    if (S.tab === 'home' || S.tab === 'settings') render();
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
const nightOf = (r) => (minOfDay(r.start) < 12 * 60 ? addDays(dkey(r.start), -1) : dkey(r.start));
const sleepEnd = (r, now) => r.end || now;
const sleeps = () => live().filter((r) => r.type === 'sleep');
const openSleep = () => { const s = sleeps(); for (let i = s.length - 1; i >= 0; i--) if (!s[i].end) return s[i]; return null; };
const lastOf = (type, fn) => { const l = live(); for (let i = l.length - 1; i >= 0; i--) if (l[i].type === type && (!fn || fn(l[i]))) return l[i]; return null; };
const isPoop = (r) => r.d1 === '대변' || r.d1 === '둘다';
const WARN_COLORS = ['흰색·회색', '빨강', '검정'];

function morningWake(key) {
  let w = null;
  sleeps().forEach((r) => { if (r.kind === '밤' && r.end && nightOf(r) === addDays(key, -1) && (!w || r.end > w)) w = r.end; });
  return w;
}
function dayNaps(key) { return sleeps().filter((r) => r.kind === '낮' && dkey(r.start) === key); }
function nightStats(key) {
  const now = Date.now();
  if (set('nightMode') === 'midnight') {
    const a = dstart(key), b = dstart(addDays(key, 1));
    let tot = 0, longest = 0;
    sleeps().filter((r) => r.kind === '밤').forEach((r) => {
      const s = Math.max(r.start, a), e = Math.min(sleepEnd(r, now), b);
      if (e > s) { tot += e - s; longest = Math.max(longest, sleepEnd(r, now) - r.start); }
    });
    return { tot: tot / MIN, longest: longest / MIN, first: null };
  }
  const segs = sleeps().filter((r) => r.kind === '밤' && nightOf(r) === key);
  let tot = 0, longest = 0;
  segs.forEach((r) => { const d = sleepEnd(r, now) - r.start; tot += d; longest = Math.max(longest, d); });
  return { tot: tot / MIN, longest: longest / MIN, first: segs[0] || null, count: segs.length };
}
function daySummary(key) {
  const now = Date.now();
  const l = live().filter((r) => dkey(r.start) === key);
  const feeds = l.filter((r) => r.type === 'feed');
  const naps = l.filter((r) => r.type === 'sleep' && r.kind === '낮');
  const dia = l.filter((r) => r.type === 'diaper');
  return {
    feedN: feeds.length, feedMl: feeds.reduce((s, r) => s + (Number(r.value) || 0), 0),
    napN: naps.length, napMin: naps.reduce((s, r) => s + (sleepEnd(r, now) - r.start) / MIN, 0),
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
      const segs = sleeps().filter((r) => r.kind === '밤' && nightOf(r) === nightOf(open));
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
function recItem(r) {
  const x = recText(r);
  const ic = ART.icons[r.type === 'sleep' && !r.end ? 'sleep' : (TYPES[r.type] || {}).i || 'memo'];
  const memo = r.type !== 'memo' && r.memo ? `<small>${esc(r.memo)}</small>` : '';
  return `<button class="item" data-act="edit" data-id="${esc(r.id)}">
    <span class="t">${hm(r.start)}</span><span class="ico">${ic}</span>
    <span class="what"><span class="${x.c}">${esc(x.t)}</span>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}${memo}</span>
    ${x.warn ? '<span class="tag warn-tag">확인 필요</span>' : ''}<span class="tag">${esc(r.by || '')}</span></button>`;
}

/* ---------- 화면 ---------- */
/* 입력 중인 칸이 있으면 다시 그리지 않고, 입력이 끝나면 그린다(쓰던 글이 사라지지 않게) */
let renderPending = false;
const typing = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#app')); };
// 입력을 마친 직후 누른 버튼이 사라지지 않도록, 미뤄둔 다시 그리기는 잠깐 기다렸다 실행
document.addEventListener('focusout', () => setTimeout(() => { if (renderPending && !typing()) render(); }, 350));
function render(force) {
  if (!force && S.auth && typing()) { renderPending = true; return; }
  renderPending = false;
  const root = $('#app');
  if (!S.auth) { root.innerHTML = viewLogin(); $('#tabs').innerHTML = ''; return; }
  const v = { home: viewHome, day: viewDay, pattern: viewPattern, growth: viewGrowth, settings: viewSettings }[S.tab] || viewHome;
  root.innerHTML = v();
  renderTabs();
}
function renderTabs() {
  const t = [['home', '홈'], ['day', '하루'], ['pattern', '패턴'], ['growth', '성장']];
  $('#tabs').innerHTML = `<div class="in">${t.map(([k, n]) => `<button data-act="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${ART.icons[k === 'day' ? 'day' : k]}${n}</button>`).join('')}</div>`;
}
function header() {
  const a = babyAge(dkey(Date.now()));
  return `<div class="top"><div class="avatar">${ART.chars[charState()]}</div>
    <div><div class="name">${esc(babyName())}</div><div class="age">${a ? `${a.months}개월 · ${a.n}일째` : '설정에서 생일을 입력해주세요'}</div></div>
    <button class="gear" data-act="tab" data-tab="settings" aria-label="설정">${ART.icons.gear}</button></div>`;
}

function viewHome() {
  const st = statusInfo();
  const today = dkey(Date.now()), yest = addDays(today, -1);
  const sm = daySummary(today), ns = nightStats(set('nightMode') === 'midnight' ? today : yest);
  const recent = live().slice(-3).reverse();
  const open = openSleep();
  return `${header()}${statusCard(st)}
  <div class="btns">
    <button class="btn-big b-feed" data-act="feed">${ART.icons.feed}분유</button>
    <button class="btn-big b-sleep ${open ? 'on' : ''}" data-act="sleep">${open ? ART.icons.wake + '깸' : ART.icons.sleep + '잠 시작'}</button>
    <button class="btn-big b-diaper" data-act="diaper">${ART.icons.diaper}기저귀</button>
    <button class="btn-big b-bath" data-act="quick" data-type="bath">${ART.icons.bath}목욕</button>
  </div>
  <div class="smalls">
    <button class="btn-sm" data-act="temp">${ART.icons.temp}체온</button>
    <button class="btn-sm" data-act="med">${ART.icons.med}약</button>
    <button class="btn-sm" data-act="quick" data-type="walk">${ART.icons.walk}산책</button>
    <button class="btn-sm" data-act="memo">${ART.icons.memo}메모</button>
    ${set('showFood') === 'true' ? `<button class="btn-sm" data-act="food">${ART.icons.food}이유식</button>` : ''}
  </div>
  <div class="card sum">
    <div><div class="lbl">수유</div><div class="v c-feed">${sm.feedN}회 · ${sm.feedMl}</div></div>
    <div><div class="lbl">낮잠</div><div class="v c-nap">${sm.napN}회 · ${minShort(sm.napMin)}</div></div>
    <div><div class="lbl">${set('nightMode') === 'midnight' ? '오늘 밤잠' : '어젯밤'}</div><div class="v c-night">${ns.tot ? minShort(ns.tot) : '-'}</div></div>
    <div><div class="lbl">기저귀</div><div class="v c-diaper">소${sm.pee} · 대${sm.poo}</div></div>
  </div>
  <div class="card list">${recent.length ? recent.map(recItem).join('') : '<div class="empty">아직 기록이 없어요. 위 버튼을 눌러 시작해보세요.</div>'}
    <button class="more" data-act="tab" data-tab="day">오늘 기록 전체 보기 →</button></div>
  ${S.queue.length ? `<div class="lbl" style="text-align:center">저장 대기 ${S.queue.length}건 · 연결되면 자동으로 올라가요</div>` : ''}`;
}

function statusCard(st) {
  const char = `<div class="char">${ART.chars[charState()]}</div>`;
  const feed = st.feedInfo ? `<div class="subcard"><div class="substat"><span class="lbl">마지막 수유 후</span><span class="lbl">${st.poo ? `대변 ${agoTxt(st.poo.start)}` : ''}</span>
      <span class="feedtxt">${minTxt(st.feedInfo.el)}</span><span></span></div>
      <div class="bar"><i style="width:${st.feedInfo.pct}%;background:${st.feedInfo.color === 'var(--nap)' ? 'var(--feed)' : st.feedInfo.color}"></i></div>
      <div class="row2"><span>목표 간격 ${minTxt(st.feedInfo.target)}</span><span><b>수유 ${hm(st.feedInfo.pred)}쯤</b></span></div></div>`
    : `<div class="subcard lbl">수유 기록이 아직 없어요</div>`;
  if (st.mode === 'night') {
    return `<div class="card status sleeping">${char}<div class="body">
      <div class="lbl">밤잠 중 · ${hm(st.open.start)} 잠듦</div><div class="big">${minTxt(st.el)}째</div>
      <div class="bar"><i style="width:${st.pct}%;background:var(--night)"></i></div>
      <div class="row2"><span>오늘 밤 ${minTxt(st.tot)}</span><span>기상 목표 <b>${hm(st.wakeAt)}</b></span></div></div></div>`;
  }
  if (st.mode === 'nap') {
    return `<div class="card status sleeping">${char}<div class="body">
      <div class="lbl">낮잠${st.idx} 중 · ${hm(st.open.start)} 잠듦</div><div class="big">${minTxt(st.el)}째</div>
      ${st.target ? `<div class="bar"><i style="width:${st.pct}%;background:${st.color}"></i></div>
      <div class="row2"><span>${st.max ? `최대 ${minTxt(st.max)}` : `목표 ${minTxt(st.target)}`}</span><span><b>${hm(st.pred)}쯤</b> 깸 예상</span></div>`
        : '<div class="row2"><span>일정표에 없는 잠이에요 · 깰 때 낮잠/밤잠을 자동으로 판단해요</span></div>'}</div></div>`;
  }
  if (st.mode === 'nodata') {
    return `<div class="card status">${char}<div class="body"><div class="lbl">반가워요</div><div class="big" style="font-size:20px">잠 기록부터 시작해볼까요?</div>
      <div class="row2"><span>잠·수유를 기록하면 다음 할 일을 계산해드려요</span></div>${feed}</div></div>`;
  }
  if (st.mode === 'nightwake') {
    return `<div class="card status">${char}<div class="body"><div class="lbl">밤중에 깸 · ${hm(st.last.end)}</div><div class="big">${minTxt(st.el)}째</div>
      <div class="row2"><span>다시 재우면 "잠 시작"을 눌러주세요</span></div>${feed}</div></div>`;
  }
  return `<div class="card status">${char}<div class="body">
    <div class="lbl">깨어 있은 지 · ${st.last ? '마지막 깨시' : `${st.n}번째 깨시`}</div><div class="big">${minTxt(st.el)}</div>
    <div class="bar"><i style="width:${st.pct}%;background:${st.color}"></i></div>
    <div class="row2"><span>목표 ${minTxt(st.target)}</span><span><b>${st.next} ${hm(st.pred)}쯤</b></span></div>${feed}</div></div>`;
}
function agoTxt(ms) {
  const m = (Date.now() - ms) / MIN;
  if (m < 60) return `${Math.round(m)}분 전`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
}

/* 하루 탭 */
function viewDay() {
  const key = S.day, today = dkey(Date.now());
  const a = babyAge(key);
  const sm = daySummary(key), ns = nightStats(key);
  const recs = live().filter((r) => dkey(r.start) === key).reverse();
  const memo = S.memos[key];
  return `<div class="daynav"><button data-act="day" data-d="-1" aria-label="이전 날">‹</button>
    <div class="d">${dayLabel(key)}<small>${a ? `${a.n}일째` : ''}${key === today ? ' · 오늘' : ''}</small></div>
    <button data-act="day" data-d="1" aria-label="다음 날" ${key >= today ? 'style="visibility:hidden"' : ''}>›</button></div>
  <div class="card"><div class="clock">${clockSvg(key, sm)}</div>
    <div class="legend"><span><i style="background:var(--night)"></i>밤잠</span><span><i style="background:var(--nap)"></i>낮잠</span>
    <span><i style="background:var(--feed);height:3px"></i>수유</span><span><i style="background:var(--bath);height:3px"></i>목욕</span></div></div>
  <div class="card sum">
    <div><div class="lbl">수유</div><div class="v c-feed">${sm.feedN}회 · ${sm.feedMl}</div></div>
    <div><div class="lbl">낮잠</div><div class="v c-nap">${sm.napN}회 · ${minShort(sm.napMin)}</div></div>
    <div><div class="lbl">밤잠${ns.count > 1 ? ` (최장 ${minShort(ns.longest)})` : ''}</div><div class="v c-night">${ns.tot ? minShort(ns.tot) : '-'}</div></div>
    <div><div class="lbl">기저귀</div><div class="v c-diaper">소${sm.pee} · 대${sm.poo}</div></div></div>
  <div class="card"><div class="h">계획 대비<span class="lbl">${esc(planFor(key).name)}</span></div>${compareTable(key)}</div>
  <div class="card list"><div class="h">기록 전체<span class="lbl">${recs.length}건</span></div>${recs.length ? recs.map(recItem).join('') : '<div class="empty">기록이 없어요</div>'}</div>
  <div class="card"><div class="h">한 줄 메모${memo && memo.by ? `<span class="lbl">${esc(memo.by)}</span>` : ''}</div>
    <input id="daymemo" maxlength="120" placeholder="오늘 있었던 일을 한 줄로" value="${esc(memo ? memo.text : '')}" data-key="${key}"></div>`;
}

function clockSvg(key, sm) {
  const C = 120, R = 86, W = 26, a0 = dstart(key), a1 = dstart(addDays(key, 1)), now = Date.now();
  const pt = (frac, r) => { const ang = frac * 2 * Math.PI - Math.PI / 2; return [C + r * Math.cos(ang), C + r * Math.sin(ang)]; };
  const fr = (ms) => (ms - a0) / (a1 - a0);
  const arc = (f1, f2, color) => {
    if (f2 - f1 >= 0.9999) return `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="${W}"/>`;
    const [x1, y1] = pt(f1, R), [x2, y2] = pt(f2, R);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 ${f2 - f1 > 0.5 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${W}"/>`;
  };
  const tick = (ms, color) => { const f = fr(ms), [x1, y1] = pt(f, R - W / 2), [x2, y2] = pt(f, R + W / 2); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`; };
  let g = `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#2A2846" stroke-width="${W}"/>`;
  sleeps().forEach((r) => {
    const s = Math.max(r.start, a0), e = Math.min(sleepEnd(r, Math.min(now, a1)), a1);
    if (e > s) g += arc(fr(s), fr(e), r.kind === '밤' ? 'var(--night)' : 'var(--nap)');
  });
  live().forEach((r) => {
    if (r.start < a0 || r.start >= a1) return;
    if (r.type === 'feed') g += tick(r.start, 'var(--feed)');
    if (r.type === 'bath') g += tick(r.start, 'var(--bath)');
  });
  for (let h = 0; h < 24; h += 3) {
    const [x, y] = pt(h / 24, R + W / 2 + 10);
    g += `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="middle" font-size="10" fill="#9E99C4">${h}</text>`;
  }
  if (now >= a0 && now < a1) { const [x, y] = pt(fr(now), R - W / 2 - 8); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#ECEAF6"/>`; }
  const a = babyAge(key);
  g += `<text x="${C}" y="${C - 4}" text-anchor="middle" font-size="15" font-weight="600" fill="#ECEAF6">${a ? `${a.n}일째` : ''}</text>
    <text x="${C}" y="${C + 16}" text-anchor="middle" font-size="13" fill="#FAC775">${sm.feedMl}ml</text>`;
  return `<svg viewBox="0 0 240 240" role="img" aria-label="${dayLabel(key)} 24시간 기록">${g}</svg>`;
}

function diffTxt(d, kind) {
  const ad = Math.abs(Math.round(d));
  if (ad <= 10) return `<span class="c-ok">${ad === 0 ? '정확' : '비슷'}</span>`;
  const w = kind === 'len' ? (d > 0 ? '길게' : '짧게') : (d > 0 ? '늦게' : '일찍');
  return `<span class="c-over">${minTxt(ad)} ${w}</span>`;
}
function compareTable(key) {
  const P = planFor(key), now = Date.now();
  const rows = [];
  const row = (k, p, a) => rows.push(`<div class="k">${k}</div><div class="p">${p}</div><div class="a">${a}</div>`);
  const mw = morningWake(key);
  row('기상', hmM(P.wake), mw ? `${hm(mw)} · ${diffTxt(minOfDay(mw) - P.wake + (dkey(mw) !== key ? -1440 : 0))}` : '<span class="lbl">기록 없음</span>');
  // 계획과 실제를 가까운 시각끼리 짝지음(한 번 빠져도 뒤가 밀리지 않게)
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
    const r = np.by[i];
    const plan = `${hmM(pn.s)} · ${minTxt(pn.e - pn.s)}`;
    if (!r) { row(`낮잠${i + 1}`, plan, '<span class="lbl">-</span>'); return; }
    const len = (sleepEnd(r, now) - r.start) / MIN;
    row(`낮잠${i + 1}`, plan, `${hm(r.start)} · ${minTxt(len)}${r.end ? '' : '째'}<br>${diffTxt(minOfDay(r.start) - pn.s)}${r.end ? ' · ' + diffTxt(len - (pn.e - pn.s), 'len') : ''}`);
  });
  naps.filter((r) => !np.used.has(r.id)).forEach((r) => row('추가 낮잠', '<span class="lbl">-</span>', `${hm(r.start)} · ${minTxt((sleepEnd(r, now) - r.start) / MIN)}`));
  // 수유: 계획 시각과 가장 가까운 실제 수유를 짝지음(±2시간 안). 순서로 맞추면 한 번 빠질 때 전부 밀리기 때문
  const feeds = live().filter((r) => r.type === 'feed' && dkey(r.start) === key && !(isNightTime(r.start) && minOfDay(r.start) < 12 * 60));
  const fp = pairUp(P.feeds, feeds, (p) => p.t, 120);
  const ml = (r) => `${esc(r.value)}ml`;
  P.feeds.forEach((pf, i) => {
    const r = fp.by[i];
    row(esc(pf.l), hmM(pf.t), r ? `${hm(r.start)} · ${ml(r)}<br>${diffTxt(minOfDay(r.start) - pf.t)}` : '<span class="lbl">-</span>');
  });
  feeds.filter((r) => !fp.used.has(r.id)).forEach((r) => row('추가 수유', '<span class="lbl">-</span>', `${hm(r.start)} · ${ml(r)}`));
  const nightFeeds = live().filter((r) => r.type === 'feed' && dkey(r.start) === key && isNightTime(r.start) && minOfDay(r.start) < 12 * 60);
  if (nightFeeds.length) row('새벽 수유', '<span class="lbl">-</span>', nightFeeds.map((r) => `${hm(r.start)} · ${ml(r)}`).join('<br>'));
  if (P.bath != null) {
    const b = live().find((r) => r.type === 'bath' && dkey(r.start) === key);
    row('목욕', hmM(P.bath), b ? `${hm(b.start)} · ${diffTxt(minOfDay(b.start) - P.bath)}` : '<span class="lbl">-</span>');
  }
  const ns = nightStats(key);
  const first = sleeps().find((r) => r.kind === '밤' && nightOf(r) === key);
  row('밤잠 시작', hmM(P.bed), first ? `${hm(first.start)} · ${diffTxt(minOfDay(first.start) - P.bed + (minOfDay(first.start) < 720 ? 1440 : 0))}` : '<span class="lbl">-</span>');
  if (ns.count) row('밤잠', '', `총 ${minTxt(ns.tot)} · 최장 ${minTxt(ns.longest)}`);
  return `<div class="cmp"><div class="hd">항목</div><div class="hd">계획</div><div class="hd a">실제</div>${rows.join('')}</div>`;
}
const hmM = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/* 패턴·성장 (2차) */
function viewPattern() {
  return `${header()}<div class="card placeholder">패턴 탭은 2차에서 만들어요.<br>주간 패턴, 수유량·통잠·리듬 추이, 목표 vs 실제가 들어갈 자리예요.</div>`;
}
function viewGrowth() {
  const b = set('birthDate');
  let anni = '';
  if (b) {
    const today = dstart(dkey(Date.now()));
    const mk = (label, key) => { const left = Math.round((dstart(key) - today) / DAY); return `<div><div class="lbl">${label}</div><b>${left > 0 ? `D-${left}` : left === 0 ? '오늘!' : '지남'}</b><div class="lbl">${dayLabel(key)}</div></div>`; };
    const [y, m, d] = b.split('-').map(Number);
    const list = [['100일', addDays(b, 99)], ['200일', addDays(b, 199)], ['돌', `${y + 1}-${pad(m)}-${pad(d)}`]].filter(([, k]) => dstart(k) >= today - 7 * DAY);
    anni = `<div class="card"><div class="h">기념일</div><div class="anni">${list.map(([l, k]) => mk(l, k)).join('')}</div></div>`;
  }
  return `${header()}${anni}<div class="card placeholder">성장 탭은 2차에서 만들어요.<br>키·몸무게, 예방접종·검진, 발달·이유식 기록이 들어갈 자리예요.</div>`;
}

/* 설정 */
function viewSettings() {
  const cur = [...S.apply].sort((a, b) => (a.from < b.from ? -1 : 1)).filter((a) => a.from <= dkey(Date.now())).pop();
  const names = Object.keys(S.plans);
  const sw = (k) => `<button class="switch ${set(k) === 'true' ? 'on' : ''}" data-act="toggle" data-k="${k}" aria-label="켜기/끄기"></button>`;
  const inp = (k, type, extra = '') => `<input type="${type}" data-set="${k}" value="${esc(set(k))}" ${extra}>`;
  return `<div class="top"><button class="gear" style="margin:0" data-act="tab" data-tab="home" aria-label="뒤로">‹</button><div class="name">설정</div></div>
  <div class="card set"><div class="h">아기</div>
    <div class="item"><span class="k">이름</span><input type="text" data-set="babyName" value="${esc(set('babyName'))}" placeholder="우리 아기" maxlength="12"></div>
    <div class="item"><span class="k">생일</span>${inp('birthDate', 'date')}</div></div>
  <div class="card set"><div class="h">일정표</div>
    <div class="item"><span class="k">지금 적용 중<small>${cur ? `${esc(cur.from)}부터` : ''}</small></span><b>${esc(cur ? cur.name : '-')}</b></div>
    <div class="item"><span class="k">일정 바꾸기<small>지난 날짜는 그날 일정 그대로 비교돼요</small></span></div>
    <div class="field"><select id="applyName">${names.map((n) => `<option ${cur && cur.name === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="inline" style="margin-bottom:12px"><input type="date" id="applyFrom" value="${dkey(Date.now())}"><button class="chip on" style="flex:0 0 auto" data-act="applyPlan">이 날부터 적용</button></div>
    <div class="chips">${names.map((n) => `<button class="chip" data-act="editPlan" data-name="${esc(n)}">${esc(n)} 편집</button>`).join('')}<button class="chip" data-act="newPlan">＋ 새 일정</button></div></div>
  <div class="card set"><div class="h">분유</div>
    <div class="item"><span class="k">자주 쓰는 양 (ml)<small>쉼표로 구분</small></span>${inp('feedPresets', 'text', 'inputmode="numeric"')}</div></div>
  <div class="card set"><div class="h">기준값</div>
    <div class="item"><span class="k">밤잠 시작<small>이 시각 이후 잠은 밤잠</small></span>${inp('nightStart', 'time')}</div>
    <div class="item"><span class="k">밤잠 끝<small>이 시각 이전 잠도 밤잠</small></span>${inp('nightEnd', 'time')}</div>
    <div class="item"><span class="k">체온 주의 (℃)</span>${inp('tempWarn', 'number', 'step="0.1"')}</div>
    <div class="item"><span class="k">체온 고열 (℃)</span>${inp('tempHigh', 'number', 'step="0.1"')}</div></div>
  <div class="card set"><div class="h">기능</div>
    <div class="item"><span class="k">이유식 버튼</span>${sw('showFood')}</div>
    <div class="item"><span class="k">밤잠 집계<small>잠든 날: 밤 전체를 잠든 날로 / 자정: 0시에서 나눔</small></span>
      <select data-set="nightMode"><option value="start" ${set('nightMode') !== 'midnight' ? 'selected' : ''}>잠든 날 기준</option><option value="midnight" ${set('nightMode') === 'midnight' ? 'selected' : ''}>자정 기준</option></select></div></div>
  <div class="card set"><div class="h">사용자</div><div id="users">${S.users.map((u, i) => userRow(u, i)).join('')}</div>
    <div class="inline" style="margin-top:8px"><button class="chip" data-act="addUser">＋ 사람 추가</button><button class="chip on" data-act="saveUsers">사용자 저장</button></div>
    <div class="lbl" style="margin-top:6px">PIN은 바꿀 때만 입력하세요. 비워두면 그대로예요.</div></div>
  ${S.failed.length ? `<div class="card set"><div class="h c-over">저장 못 한 기록 ${S.failed.length}건</div>
    <div class="lbl" style="margin-bottom:8px">${esc(S.failed[0].err || '')}</div>
    <div class="inline"><button class="chip on" data-act="retryFailed">다시 시도</button><button class="chip danger" data-act="dropFailed">버리기</button></div></div>` : ''}
  <div class="card set"><div class="h">이 기기</div>
    <div class="item"><span class="k">지금 사용자</span><b>${esc(S.auth.user)}</b></div>
    <div class="item"><span class="k">내 PIN 바꾸기</span><button class="chip" data-act="changePin">바꾸기</button></div>
    ${S.queue.length ? `<div class="item"><span class="k">올라가기 기다리는 기록</span><b>${S.queue.length}건</b></div>` : ''}
    <div class="item"><span class="k">서버<small>${S.auth.url === 'demo' ? '데모 모드' : '구글 시트 연결됨'}</small></span><button class="chip" data-act="resync">새로고침</button></div>
    <div class="item"><span class="k">다른 사람으로 바꾸기</span><button class="chip danger" data-act="logout">로그아웃</button></div></div>
  <div class="card set"><div class="h">변경 기록<button class="chip" data-act="loadLog">불러오기</button></div>
    <div class="log">${S.logLines ? (S.logLines.length ? S.logLines.map((l) => `<div>${esc(l[0])} · ${esc(l[1])} · ${esc(l[2])}</div>`).join('') : '<div>기록이 없어요</div>') : ''}</div></div>`;
}
function userRow(u, i) {
  return `<div class="item" data-u="${i}" data-old="${esc(u.oldName !== undefined ? u.oldName : u.name)}"><input type="text" class="u-name" value="${esc(u.name)}" placeholder="이름" maxlength="10" style="max-width:34%">
    <input type="password" class="u-pin" inputmode="numeric" maxlength="4" placeholder="${u.name ? '새 PIN' : 'PIN 4자리'}" value="${esc(u.draftPin || '')}" style="max-width:34%">
    <button class="switch ${u.active ? 'on' : ''}" data-act="userActive" aria-label="사용"></button></div>`;
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
  return `<div class="login"><div class="char">${ART.chars.awake}</div><div class="name" style="font-size:20px;font-weight:600">아기 기록</div>
    ${!API_URL ? `<div style="margin:16px 0 0;${known ? 'display:none' : ''}" id="urlBox"><input id="apiUrl" placeholder="서버 주소 (https://script.google.com/...)" value="${esc(known)}"></div>
      ${known ? '<button class="lbl" style="margin-top:8px" onclick="document.getElementById(\'urlBox\').style.display=\'\';this.remove()">서버 주소 바꾸기</button>' : ''}` : ''}
    <div class="lbl" style="margin-top:14px">PIN 4자리를 입력해주세요</div>
    <div class="pin">${[0, 1, 2, 3].map((i) => `<span class="${i < pinBuf.length ? 'on' : ''}"></span>`).join('')}</div>
    <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-act="pin" data-n="${n}">${n}</button>`).join('')}
      <button data-act="pin" data-n="c" style="font-size:14px">지움</button><button data-act="pin" data-n="0">0</button><button data-act="pin" data-n="b" style="font-size:18px">←</button></div>
    <div id="loginMsg" class="lbl" style="margin-top:14px;min-height:20px"></div></div>`;
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
    if (!sameServer || !loadCache()) { S.serverTime = 0; S.recs = {}; dirty(); }
    S.tab = 'home'; render(true);
    sync(true);
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
  const { _local, ...send } = rec;
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
  return ask(`<b>${esc(d.by)}</b>님이 ${Math.max(1, Math.round((now - d.start) / MIN))}분 전에 <b>${esc(x.t)}</b>을(를) 기록했어요.<br>그래도 추가할까요?`);
}
const LABEL = { bath: '목욕', walk: '산책' };

const ACTIONS = {
  tab(el) { S.tab = el.dataset.tab; if (S.tab === 'day') S.day = dkey(Date.now()); S.logLines = null; closeToast(); render(); window.scrollTo(0, 0); },
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
    S.day = n; render();
    ensureRange(n);
  },
  pin(el) {
    const n = el.dataset.n;
    if (n === 'c') pinBuf = ''; else if (n === 'b') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 8) pinBuf += n;
    refreshPin();
    if (pinBuf.length === 4) tryLogin();
  },
  toggle(el) { const k = el.dataset.k; saveSettings({ [k]: set(k) === 'true' ? 'false' : 'true' }); },
  applyPlan: busy(async () => {
    const name = $('#applyName').value, from = $('#applyFrom').value;
    if (!from) { note('적용 시작일을 골라주세요'); return; }
    try { const j = await call('applyPlan', { name, from }); S.apply = j.data.apply; saveCache(); render(); note(`${from}부터 ${name} 적용`); }
    catch (e) { note(errMsg(e)); }
  }),
  editPlan(el) { planSheet(el.dataset.name); },
  newPlan() { planSheet(''); },
  addUser() { S.users = readUserRows().map((u) => ({ name: u.name, active: u.active, draftPin: u.pin, oldName: u.oldName })); S.users.push({ name: '', active: true }); render(true); },
  userActive(el) { el.classList.toggle('on'); },
  saveUsers: busy(async () => {
    const list = readUserRows().filter((u) => u.name);
    if (list.some((u) => u.pin && !/^\d{4}$/.test(u.pin))) { note('PIN은 숫자 4자리로 해주세요'); return; }
    if (new Set(list.map((u) => u.name)).size !== list.length) { note('이름이 겹쳐요'); return; }
    const me = list.find((u) => u.oldName === S.auth.user);
    try {
      const j = await call('saveUsers', { users: list });
      S.users = j.data.users;
      if (me) { S.auth.user = me.name; if (me.pin) S.auth.pin = me.pin; LS.set('auth', S.auth); if (!me.active) { authFailed('사용이 중지됐어요.'); return; } }
      saveCache(); render(true); note('사용자 저장됨');
    } catch (e) { note(errMsg(e)); }
  }),
  loadLog: busy(async () => { try { const j = await call('getLog', {}); S.logLines = j.data.log; render(); } catch (e) { note('불러오지 못했어요'); } }),
  resync() { note('새로 불러오는 중…'); sync(true); },
  changePin() { pinSheet(false); },
  retryFailed() { S.queue.push(...S.failed.map((o) => Object.assign(o, { tries: 0, sending: false, err: undefined }))); S.failed = []; saveQueue(); render(); flush(); },
  async dropFailed() { if (await ask(`저장 못 한 기록 ${S.failed.length}건을 버릴까요?`, '버리기')) { S.failed = []; saveQueue(); render(); } },
  async logout() {
    const n = S.queue.length;
    if (await ask(`이 기기에서 로그아웃할까요?${n ? `<br><span class="lbl">아직 올라가지 않은 기록 ${n}건은 다시 로그인하면 이어서 올라가요.</span>` : ''}`, '로그아웃')) logout();
  },
};
/* 서버를 기다리는 버튼은 누르는 동안 막아 두 번 눌리지 않게 */
function busy(fn) {
  let running = false;
  return async (el) => {
    if (running) return;
    running = true; if (el) el.disabled = true;
    try { await fn(el); } finally { running = false; if (el && el.isConnected) el.disabled = false; }
  };
}
function readUserRows() {
  return [...document.querySelectorAll('#users .item')].map((row) => ({
    name: row.querySelector('.u-name').value.trim(), oldName: row.dataset.old || '', pin: row.querySelector('.u-pin').value.trim(), active: row.querySelector('.switch').classList.contains('on'),
  }));
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
function editSheet(id) {
  const r = S.recs[id]; if (!r) return;
  const T = TYPES[r.type] || { n: r.type, i: 'memo' };
  let body = `<div class="field"><label>${r.type === 'sleep' ? '잠든 시각' : '시각'}</label><input type="datetime-local" id="es" value="${toLocalInput(r.start)}"></div>`;
  if (r.type === 'sleep') body += `<div class="field"><label>깬 시각 (비우면 자는 중)</label><input type="datetime-local" id="ee" value="${toLocalInput(r.end)}"></div>
    <div class="field"><label>구분</label><select id="ek"><option ${r.kind === '낮' ? 'selected' : ''}>낮</option><option ${r.kind === '밤' ? 'selected' : ''}>밤</option></select></div>`;
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
  openSheet(`<h3>${ART.icons[T.i]}${T.n} 기록 수정</h3>${body}<div class="lbl">기록: ${esc(r.by)}</div>
    <button class="primary" id="save">저장</button><button class="ghost danger" id="del">삭제</button>`, (el) => {
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'del') { if (await ask('이 기록을 삭제할까요?', '삭제')) { removeRec(id); note('삭제했어요'); } else editSheet(id); return; }
      if (b.id !== 'save') return;
      const patch = { start: fromLocalInput($('#es').value), memo: $('#em').value.trim() };
      if (!patch.start) { note('시각을 입력해주세요'); return; }
      if (r.type === 'sleep') {
        patch.end = fromLocalInput($('#ee').value); patch.kind = $('#ek').value;
        if (patch.end && patch.end <= patch.start) { note('깬 시각이 잠든 시각보다 늦어야 해요'); return; }
        if (!patch.end && openSleep() && openSleep().id !== id) { note('이미 자는 중인 기록이 있어요'); return; }
      }
      if (patch.start > Date.now() + 5 * MIN) { note('미래 시각은 저장할 수 없어요'); return; }
      if ($('#ev')) patch.value = $('#ev').value === '' ? null : Number($('#ev').value);
      if ($('#e1')) patch.d1 = $('#e1').value.trim();
      if ($('#e2')) patch.d2 = $('#e2').value.trim();
      if ($('#e3')) patch.d3 = $('#e3').value.trim();
      closeSheet(); updateRec(id, patch); note('수정했어요');
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
async function ensureRange(key) {
  const a = dstart(key);
  if (!S.loadedFrom || a >= S.loadedFrom) return;
  const from = dstart(addDays(key, -30));
  try {
    const j = await call('range', { from, to: S.loadedFrom });
    mergeRecs(j.data.recs); S.loadedFrom = from; render();
  } catch (e) { note('지난 기록을 불러오지 못했어요'); }
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
setInterval(() => { if (S.auth && !document.hidden && S.tab === 'home') render(); }, 30000);
setInterval(() => { if (S.auth && !document.hidden) sync(); }, 20000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { const m = $('#daymemo'); if (m) saveDayMemo(m, true); if (S.queue.length) flush(); return; }
  if (S.auth) { render(); sync(); }
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
    render();
    sync(!had);
    if (S.queue.length) scheduleFlush(300);
  } else render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) safeReload(); });
    navigator.serviceWorker.register('./sw.js').then((r) => { swReg = r; }).catch(() => {});
  }
})();
