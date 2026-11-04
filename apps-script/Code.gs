/**
 * 아기 기록 앱 - 서버(구글 Apps Script)
 * 이 파일 전체를 Apps Script 편집기의 Code.gs에 붙여넣고, setup 실행 후 "웹 앱"으로 배포하세요.
 */
const TZ = 'Asia/Seoul';
const API_VERSION = 2;
const KEEP_DAYS = 45;
const MAX_FAILS = 10;              // PIN을 이만큼 틀리면
const LOCK_SECONDS = 3600;         // 이 시간 동안 잠금
const WEAK_PINS = ['1111', '2222', '3333', '0000', '1234'];

const SHEETS = {
  rec: { name: '기록', head: ['id', '종류', '시작ms', '종료ms', '시작', '종료', '값', '세부1', '세부2', '세부3', '잠구분', '메모', '기록자', '입력ms', '수정ms', '삭제'], text: ['A:B', 'E:F', 'H:M'] },
  users: { name: '사용자', head: ['이름', 'PIN', '사용'], text: ['A:C'] },
  settings: { name: '설정', head: ['키', '값'], text: ['A:B'] },
  plans: { name: '일정', head: ['일정명', '내용(JSON)'], text: ['A:B'] },
  apply: { name: '일정적용', head: ['적용시작일', '일정명', '내용(JSON)', '기록자', '기록ms'], text: ['A:D'] },
  memo: { name: '하루메모', head: ['날짜', '메모', '기록자', '수정ms'], text: ['A:C'] },
  log: { name: '변경기록', head: ['시각', '사용자', '항목', '이전값', '새값'], text: ['A:E'] },
};

const DEFAULT_SETTINGS = {
  babyName: '', birthDate: '2026-07-30', feedPresets: '105,135,150,170,200',
  nightStart: '19:00', nightEnd: '07:00', tempWarn: '37.5', tempHigh: '38.0', showFood: 'false', nightMode: 'start',
};
const PLAN_4 = {
  wake: '07:00', bed: '19:40', bath: '19:00', feedInterval: 180,
  feeds: [['07:20', '수유1'], ['10:20', '수유2'], ['13:20', '수유3'], ['16:20', '수유4'], ['19:20', '막수']],
  naps: [['08:45', '09:45', ''], ['11:30', '13:00', ''], ['14:45', '15:25', ''], ['17:10', '17:50', '']],
};
const PLAN_3 = {
  wake: '07:00', bed: '19:40', bath: '19:00', feedInterval: 180,
  feeds: [['07:20', '수유1'], ['11:00', '수유2'], ['14:20', '수유3'], ['17:30', '수유4(절반)'], ['19:20', '막수']],
  naps: [['08:45', '10:00', '60'], ['12:00', '14:00', '120'], ['16:30', '17:10', '']],
};

/* 쓰기 요청만 잠금을 잡는다(읽기는 잠금 없이 빠르게) */
const WRITES = { batch: 1, setSettings: 1, savePlan: 1, applyPlan: 1, saveUsers: 1, changeMyPin: 1 };

/* ---------- 진입점 ---------- */
function doGet() { return out_({ ok: true, msg: '아기 기록 서버가 동작 중입니다.' }); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!isReady_()) withLock_(function () { if (!isReady_()) ensure_(); });
    // 맞는 PIN은 언제나 통과. 틀린 PIN만 세어서, 많이 틀리면 '틀린 PIN 시도'만 막는다(가족은 영향 없음)
    const user = auth_(req.pin);
    if (!user) {
      // 틀린 PIN: 잠금을 잡고 세어(동시에 여러 번 보내도 정확히 셈), 일부러 천천히 답한다
      Utilities.sleep(1500);
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(3000)) return out_({ ok: false, code: 'pin', err: 'PIN이 맞지 않아요.' });
      try {
        const cache = CacheService.getScriptCache();
        const fails = Number(cache.get('pinFails') || 0);
        if (fails >= MAX_FAILS) return out_({ ok: false, code: 'locked', err: 'PIN을 여러 번 틀려 잠시 막혔어요. 1시간 뒤 다시 해주세요.' });
        cache.put('pinFails', String(fails + 1), LOCK_SECONDS);
      } finally { lock.releaseLock(); }
      return out_({ ok: false, code: 'pin', err: 'PIN이 맞지 않아요.' });
    }
    const fn = API[req.action];
    if (!fn) return out_({ ok: false, code: 'error', api: API_VERSION, err: '서버 코드가 옛 버전이에요. 다시 배포해주세요. (' + req.action + ')' });
    let rev;
    const data = WRITES[req.action]
      ? withLock_(function () { const r = fn(req.data || {}, user, req.pin); bumpRev_(); rev = rev_(); return r; })
      : (function () { rev = rev_(); if (isArchiving_()) throw new Error('잠시 정리 중(lock)'); return fn(req.data || {}, user, req.pin); })();
    // 읽기는 '읽기 시작 전' 번호를 돌려준다: 읽는 도중 들어온 기록을 다음 확인 때 놓치지 않게
    return out_({ ok: true, api: API_VERSION, user: user, now: Date.now(), rev: rev, data: data });
  } catch (err) {
    return out_({ ok: false, code: isTransient_(err) ? 'retry' : 'error', err: msg_(err) });
  }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function msg_(err) { return String((err && err.message) || err); }
function isTransient_(err) { return /lock|timed out|시간 초과|Service|잠시|Exceeded|too many|서비스/i.test(msg_(err)); }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('서버가 잠시 바빠요(lock).');
  try { return fn(); } finally { lock.releaseLock(); }
}
function props_() { return PropertiesService.getScriptProperties(); }
function isReady_() { return props_().getProperty('ready') === '3'; }
function rev_() { return Number(props_().getProperty('rev') || 0); }
function bumpRev_() { props_().setProperty('rev', String(rev_() + 1)); }

/* ---------- API ---------- */
const API = {
  login: function (d, user, pin) { return { weakPin: WEAK_PINS.indexOf(String(pin)) >= 0 }; },

  load: function () {
    const since = Date.now() - KEEP_DAYS * 864e5;
    return {
      settings: readSettings_(), plans: readPlans_(), apply: readApply_(), memos: readMemos_(),
      users: readUsers_().map(function (u) { return { name: u.name, active: u.active }; }),
      recs: readRecs_(function (r) { return r.start >= since || r.updated >= since; }),
    };
  },

  sync: function (d) {
    if (d.rev && Number(d.rev) === rev_()) return { same: true };
    const since = Number(d.since || 0);
    return {
      settings: readSettings_(), plans: readPlans_(), apply: readApply_(), memos: readMemos_(),
      users: readUsers_().map(function (u) { return { name: u.name, active: u.active }; }),
      recs: readRecs_(function (r) { return r.updated > since; }),
    };
  },

  range: function (d) {
    const from = Number(d.from), to = Number(d.to);
    return { recs: readRecs_(function (r) { return r.start >= from && r.start < to; }) };
  },

  /** 기록 변경 여러 건을 한 번에, 순서대로 처리. 일시적 오류가 나면 나머지는 다음에 다시 보내도록 'retry' */
  batch: function (d, user) {
    const s = sh_('rec');
    const names = readUsers_().map(function (u) { return u.name; });
    let stop = false;
    const results = (d.ops || []).map(function (op) {
      if (stop) return { ok: false, code: 'retry' };
      try {
        if (op.op === 'add') return { ok: true, rec: addRec_(s, op.rec, user, names) };
        if (op.op === 'update') return { ok: true, rec: updateRec_(s, Object.assign({}, op.rec, { id: op.id })) };
        if (op.op === 'remove') return { ok: true, rec: updateRec_(s, { id: op.id, deleted: true }) };
        if (op.op === 'memo') { saveMemo_(op.id, op.text, user); return { ok: true }; }
        return { ok: false, code: 'error', err: '알 수 없는 작업' };
      } catch (err) {
        if (isTransient_(err)) { stop = true; return { ok: false, code: 'retry', err: msg_(err) }; }
        return { ok: false, code: /찾을 수 없/.test(msg_(err)) ? 'notfound' : 'error', err: msg_(err) };
      }
    });
    return { results: results };
  },

  setSettings: function (d, user) {
    const cur = readSettings_();
    const s = sh_('settings');
    Object.keys(d.values || {}).forEach(function (k) {
      const v = String(d.values[k]);
      if (cur[k] === v) return;
      const row = findRow_(s, k);
      if (row) s.getRange(row, 2).setValue(safe_(v)); else s.appendRow([k, safe_(v)]);
      log_(user, '설정:' + k, cur[k], v);
    });
    return { settings: readSettings_() };
  },

  savePlan: function (d, user) {
    const s = sh_('plans');
    const json = JSON.stringify(d.plan);
    const row = findRow_(s, d.name);
    const old = row ? s.getRange(row, 2).getValue() : '';
    if (row) s.getRange(row, 2).setValue(json); else s.appendRow([safe_(d.name), json]);
    log_(user, '일정:' + d.name, old, json);
    return { plans: readPlans_() };
  },

  applyPlan: function (d, user) {
    const p = readPlans_()[d.name];
    if (!p) throw new Error('일정을 찾을 수 없어요.');
    const list = readApply_();
    const last = list[list.length - 1];
    if (last && last.from === d.from && last.name === d.name && JSON.stringify(last.plan) === JSON.stringify(p)) return { apply: list };
    sh_('apply').appendRow([String(d.from), safe_(d.name), JSON.stringify(p), safe_(user), Date.now()]);
    log_(user, '일정 적용', '', d.from + ' ' + d.name);
    return { apply: readApply_() };
  },

  saveUsers: function (d, user) {
    const s = sh_('users');
    const list = (d.users || []).filter(function (u) { return u.name; });
    const cur = readUsers_();
    const rows = list.map(function (u) {
      const prev = cur.filter(function (c) { return c.name === (u.oldName || u.name); })[0];
      const pin = u.pin ? String(u.pin) : (prev ? prev.pin : '');
      if (!/^\d{4}$/.test(pin)) throw new Error(u.name + '님의 PIN(숫자 4자리)을 입력해주세요.');
      return [safe_(u.name), pin, u.active ? 'Y' : 'N'];
    });
    const pins = rows.filter(function (r) { return r[2] === 'Y'; }).map(function (r) { return r[1]; });
    if (!pins.length) throw new Error('사용 중인 사람이 한 명 이상 있어야 해요.');
    if (new Set(pins).size !== pins.length) throw new Error('사람마다 PIN을 다르게 해주세요.');
    if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 3).clearContent();
    s.getRange(2, 1, rows.length, 3).setValues(rows);
    log_(user, '사용자', cur.map(function (c) { return c.name + (c.active ? '' : '(중지)'); }).join(','),
      rows.map(function (r) { return r[0] + (r[2] === 'Y' ? '' : '(중지)'); }).join(','));
    return { users: readUsers_().map(function (u) { return { name: u.name, active: u.active }; }) };
  },

  changeMyPin: function (d, user) {
    const pin = String(d.pin || '');
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN은 숫자 4자리로 해주세요.');
    if (WEAK_PINS.indexOf(pin) >= 0) throw new Error('너무 쉬운 PIN이에요. 다른 숫자로 해주세요.');
    const us = readUsers_();
    if (us.some(function (u) { return u.name !== user && u.pin === pin; })) throw new Error('다른 사람과 같은 PIN이에요.');
    const s = sh_('users');
    const row = findRow_(s, user);
    s.getRange(row, 2).setValue(pin);
    log_(user, 'PIN 변경', '', '');
    return {};
  },

  getLog: function () {
    const s = sh_('log');
    if (s.getLastRow() < 2) return { log: [] };
    const start = Math.max(2, s.getLastRow() - 29);
    return { log: s.getRange(start, 1, s.getLastRow() - start + 1, 5).getDisplayValues().reverse().map(function (r) { return r.map(unsafe_); }) };
  },
};

/* ---------- 기록 쓰기 ---------- */
function addRec_(s, r, user, names) {
  const row = findRow_(s, r.id);
  if (row) return rowToRec_(s.getRange(row, 1, 1, SHEETS.rec.head.length).getValues()[0]); // 재전송: 이미 저장됨
  const now = Date.now();
  r.id = r.id || Utilities.getUuid().slice(0, 12);
  r.by = names.indexOf(r.by) >= 0 ? r.by : user;
  r.created = now; r.updated = now; r.deleted = false;
  s.appendRow(recToRow_(r));
  return r;
}
function updateRec_(s, r) {
  const row = findRow_(s, r.id);
  if (!row) throw new Error('기록을 찾을 수 없어요.');
  const old = rowToRec_(s.getRange(row, 1, 1, SHEETS.rec.head.length).getValues()[0]);
  delete r.by; delete r.created;
  const merged = Object.assign(old, r, { updated: Date.now() });
  s.getRange(row, 1, 1, SHEETS.rec.head.length).setValues([recToRow_(merged)]);
  return merged;
}
function saveMemo_(date, text, user) {
  const s = sh_('memo');
  const row = findRow_(s, date);
  const vals = [String(date), safe_(text), safe_(user), Date.now()];
  if (row) s.getRange(row, 1, 1, 4).setValues([vals]); else s.appendRow(vals);
}

/* ---------- 시트 준비 ---------- */
function ensure_() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (k) {
    const def = SHEETS[k];
    let s = ss.getSheetByName(def.name);
    const fresh = !s;
    if (fresh) {
      s = ss.insertSheet(def.name);
      s.getRange(1, 1, 1, def.head.length).setValues([def.head]).setFontWeight('bold');
      s.setFrozenRows(1);
    }
    def.text.forEach(function (a1) { s.getRange(a1).setNumberFormat('@'); });   // 글자가 날짜·숫자로 바뀌지 않게
    if (k === 'rec') { s.getRange('C:D').setNumberFormat('0'); s.getRange('N:O').setNumberFormat('0'); }
    if (fresh) seed_(k, s);
  });
  props_().setProperty('ready', '3');
}

function seed_(k, s) {
  if (k === 'users') s.getRange(2, 1, 3, 3).setValues([['재현', '1111', 'Y'], ['아내', '2222', 'Y'], ['장모님', '3333', 'Y']]);
  if (k === 'settings') {
    const rows = Object.keys(DEFAULT_SETTINGS).map(function (key) { return [key, DEFAULT_SETTINGS[key]]; });
    s.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  if (k === 'plans') s.getRange(2, 1, 2, 2).setValues([['낮잠 4회', JSON.stringify(PLAN_4)], ['낮잠 3회', JSON.stringify(PLAN_3)]]);
  if (k === 'apply') s.getRange(2, 1, 1, 5).setValues([['2026-11-04', '낮잠 4회', JSON.stringify(PLAN_4), '처음 설정', Date.now()]]);
}

/** 처음 1번 편집기에서 실행: 시트를 만들고 서식을 맞춥니다. (다시 실행해도 기록은 지워지지 않아요) */
function setup() {
  props_().deleteProperty('ready');
  ensure_();
  SpreadsheetApp.getActive().toast('시트 준비 완료. 사용자 탭에서 PIN을 바꿔주세요.');
}

/** 1년 넘은 기록을 '보관' 시트로 옮겨 앱을 빠르게 유지합니다. 필요할 때 편집기에서 실행하세요. */
function archiveOld() {
  withLock_(function () {
    const s = sh_('rec');
    const n = s.getLastRow() - 1;
    if (n < 1) return;
    props_().setProperty('archiving', String(Date.now()));
    try { archiveRows_(s, n); } finally { props_().deleteProperty('archiving'); }
  });
}
/** 정리 표시가 10분 넘게 남아 있으면(중간에 강제 종료된 경우) 무시 */
function isArchiving_() {
  const t = Number(props_().getProperty('archiving') || 0);
  return t > 0 && Date.now() - t < 10 * 60000;
}
/** 옮길 행을 먼저 '보관'에 복사한 뒤, 원본에서는 그 행들만 아래쪽부터 지운다(중간에 끊겨도 기록이 사라지지 않음) */
function archiveRows_(s, n) {
  const cut = Date.now() - 400 * 864e5;
  const vals = s.getRange(2, 1, n, SHEETS.rec.head.length).getValues();
  const oldIdx = [];
  vals.forEach(function (r, i) { if (r[0] && Number(r[2]) < cut) oldIdx.push(i); });
  if (!oldIdx.length) return;
  const ss = SpreadsheetApp.getActive();
  const a = ss.getSheetByName('보관') || ss.insertSheet('보관');
  if (a.getLastRow() === 0) a.appendRow(SHEETS.rec.head);
  const old = oldIdx.map(function (i) { return vals[i]; });
  a.getRange(a.getLastRow() + 1, 1, old.length, old[0].length).setValues(old);
  SpreadsheetApp.flush();
  // 연속된 구간 단위로 아래에서 위로 삭제
  for (let k = oldIdx.length - 1; k >= 0;) {
    let j = k;
    while (j > 0 && oldIdx[j - 1] === oldIdx[j] - 1) j--;
    s.deleteRows(oldIdx[j] + 2, k - j + 1);
    k = j - 1;
  }
  bumpRev_();
}

/* ---------- 읽기 도우미 ---------- */
function sh_(k) {
  const s = SpreadsheetApp.getActive().getSheetByName(SHEETS[k].name);
  if (!s) { props_().deleteProperty('ready'); throw new Error('시트가 없어요. 잠시 후 다시 시도해주세요.'); }
  return s;
}
function rows_(k) {
  const s = sh_(k);
  const n = s.getLastRow() - 1;
  return n < 1 ? [] : s.getRange(2, 1, n, SHEETS[k].head.length).getValues();
}
function findRow_(s, key) {
  if (!key || s.getLastRow() < 2) return 0;
  const f = s.getRange(2, 1, s.getLastRow() - 1, 1).createTextFinder(String(key)).matchEntireCell(true).findNext();
  return f ? f.getRow() : 0;
}
/** =, +, -, @ 로 시작하는 글자가 수식으로 바뀌지 않게 */
function safe_(v) { const s = String(v == null ? '' : v); return /^[=+\-@]/.test(s) ? "'" + s : s; }
/** 위에서 붙인 ' 가 글자로 남아 있으면 떼어낸다(시트 설정에 따라 남을 수 있음) */
function unsafe_(v) { const s = String(v == null ? '' : v); return /^'[=+\-@]/.test(s) ? s.slice(1) : s; }
function str_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v); }

function auth_(pin) {
  if (!pin) return null;
  const u = readUsers_().filter(function (x) { return x.active && x.pin === String(pin); })[0];
  return u ? u.name : null;
}
function readUsers_() {
  return rows_('users').filter(function (r) { return r[0]; })
    .map(function (r) { return { name: unsafe_(r[0]), pin: String(r[1]).padStart(4, '0'), active: String(r[2]).toUpperCase() !== 'N' }; });
}
function readSettings_() {
  const o = Object.assign({}, DEFAULT_SETTINGS);
  rows_('settings').forEach(function (r) { if (r[0]) o[String(r[0])] = unsafe_(str_(r[1])); });
  return o;
}
function readPlans_() {
  const o = {};
  rows_('plans').forEach(function (r) { if (r[0]) { try { o[String(r[0])] = JSON.parse(r[1]); } catch (e) {} } });
  return o;
}
function readApply_() {
  return rows_('apply').filter(function (r) { return r[0]; }).map(function (r) {
    let plan = null;
    try { plan = JSON.parse(r[2]); } catch (e) {}
    return { from: str_(r[0]), name: String(r[1]), plan: plan };
  });
}
function readMemos_() {
  const o = {};
  rows_('memo').forEach(function (r) { if (r[0]) o[str_(r[0])] = { text: unsafe_(r[1]), by: unsafe_(r[2]) }; });
  return o;
}
function readRecs_(filter) { return rows_('rec').filter(function (r) { return r[0]; }).map(rowToRec_).filter(filter); }
function num_(v) { return v === '' || v === null ? null : Number(v); }
function rowToRec_(r) {
  return {
    id: String(r[0]), type: String(r[1]), start: num_(r[2]), end: num_(r[3]),
    value: r[6] === '' ? null : r[6], d1: unsafe_(r[7]), d2: unsafe_(r[8]), d3: unsafe_(r[9]),
    kind: unsafe_(r[10]), memo: unsafe_(r[11]), by: unsafe_(r[12]),
    created: num_(r[13]), updated: num_(r[14]), deleted: r[15] === true || String(r[15]).toUpperCase() === 'TRUE',
  };
}
function fmt_(ms) { return ms ? Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd HH:mm') : ''; }
function recToRow_(r) {
  return [String(r.id), String(r.type), r.start || '', r.end || '', fmt_(r.start), fmt_(r.end),
    r.value === null || r.value === undefined || r.value === '' ? '' : Number(r.value),
    safe_(r.d1), safe_(r.d2), safe_(r.d3), safe_(r.kind), safe_(r.memo), safe_(r.by),
    r.created || '', r.updated || '', r.deleted ? true : false];
}
function log_(user, item, before, after) {
  sh_('log').appendRow([fmt_(Date.now()), safe_(user), safe_(item), safe_(before || ''), safe_(after || '')]);
}
