/* 서버(Code.gs) 단위 테스트: 구글 서비스를 흉내 내어 PIN 해시·잠금·관리자 권한·메모 합치기·값 검사를 확인한다.
   실행: node tests/server.test.js */
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');
function mkSheet(name) {
  const rows = [];
  const sh = {
    name, rows,
    getLastRow: () => { let n = rows.length; while (n && !rows[n - 1].some((v) => v !== '' && v != null)) n--; return n; },
    appendRow: (r) => { rows.splice(sh.getLastRow(), 0, r.slice()); },
    getRange(a, b, nr, nc) {
      if (typeof a === 'string') return { setNumberFormat() { return this; } };
      nr = nr || 1; nc = nc || 1;
      const R = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const r = rows[a - 1 + i] || []; return r[b - 1 + j] ?? ''; })),
        getDisplayValues: () => R.getValues().map((r) => r.map(String)),
        getValue: () => R.getValues()[0][0],
        setValues: (v) => { v.forEach((r, i) => { rows[a - 1 + i] = rows[a - 1 + i] || []; r.forEach((x, j) => { rows[a - 1 + i][b - 1 + j] = x; }); }); return R; },
        setValue: (x) => R.setValues([[x]]),
        clearContent: () => R.setValues(Array.from({ length: nr }, () => Array(nc).fill(''))),
        setFontWeight: () => R, setNumberFormat: () => R,
        createTextFinder: (key) => ({ matchEntireCell: () => ({ findNext: () => { for (let i = 0; i < nr; i++) if (String((rows[a - 1 + i] || [])[b - 1]) === key) return { getRow: () => a + i }; return null; } }) }),
      };
      return R;
    },
    setFrozenRows() {}, deleteRows(i, n) { rows.splice(i - 1, n); },
    copyTo() { return { setName() {} }; },
  };
  return sh;
}
const sheets = {};
const store = {}, cache = {};
const ctx = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mkSheet(n)), toast() {} }), flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] ?? null, setProperty: (k, v) => { store[k] = String(v); }, deleteProperty: (k) => { delete store[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Utilities: {
    sleep() {}, getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b + 256) % 256)).toString('base64'),
    formatDate: (d) => d.toISOString().slice(0, 16),
  },
  ContentService: { createTextOutput: (s) => ({ setMimeType() { return JSON.parse(s); } }), MimeType: { JSON: 1 } },
  Date, JSON, Math, Number, String, Object, Array, Set, Error, isFinite, console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/Code.gs', 'utf8'), ctx);
const post = (o) => ctx.doPost({ postData: { contents: JSON.stringify(o) } });
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '  → ' + JSON.stringify(d))); if (!ok) fails++; };

console.log('[서버]');
// setup()만 먼저 실행해도 PIN은 그대로(웹 앱 요청 때 변환)
ctx.setup = ctx.setup; vm.runInContext('setup()', ctx);
check('편집기에서 setup만 실행하면 PIN을 바꾸지 않음(옛 웹 앱과 어긋나지 않게)', String(sheets['사용자'].rows[1][1]) === '1111', sheets['사용자'].rows[1]);
let r = post({ pin: '1111', action: 'login' });
check('처음 실행: 시트 만들고 1111 로그인', r.ok && r.user === '재현', r);
const pinCol = sheets['사용자'].rows.slice(1).map((x) => String(x[1]));
check('PIN은 시트에 해시로 저장(숫자 그대로 없음)', pinCol.every((p) => /^h1:/.test(p)) && !pinCol.includes('1111'), pinCol);
check('아내 2222·장모님 3333도 로그인', post({ pin: '2222', action: 'login' }).user === '아내' && post({ pin: '3333', action: 'login' }).user === '장모님');
// 예전 시트(숫자 PIN) → 새 버전 배포 후 첫 요청에서 자동 변환
sheets['사용자'].rows[2][1] = '2468'; store.ready = '3'; delete store.pinHashed;   // 옛 배포 상태
r = post({ pin: '2468', action: 'login' });
check('옛 숫자 PIN도 로그인되고 자동으로 해시로 바뀜', r.ok && r.user === '아내' && /^h1:/.test(String(sheets['사용자'].rows[2][1])), [r, sheets['사용자'].rows[2][1]]);
check('관리자가 아니면 사용자·PIN 관리 불가', !post({ pin: '2468', action: 'saveUsers', data: { users: [{ name: '재현', active: true }, { name: '아내', pin: '9999', active: true }] } }).ok);
r = post({ pin: '1111', action: 'saveUsers', data: { users: [{ name: '재현', active: true }, { name: '아내', pin: '2222', oldName: '아내', active: true }, { name: '장모님', active: true }] } });
check('관리자는 다른 사람 PIN을 새로 정할 수 있음(기존 PIN은 유지)', r.ok && post({ pin: '2222', action: 'login' }).user === '아내' && post({ pin: '3333', action: 'login' }).user === '장모님', r);
check('내 PIN 바꾸기(해시로 저장)', post({ pin: '3333', action: 'changeMyPin', data: { pin: '3579' } }).ok && post({ pin: '3579', action: 'login' }).user === '장모님' && !post({ pin: '3333', action: 'login' }).ok);
// 값 검사
const now = Date.now();
r = post({ pin: '1111', action: 'batch', data: { now, ops: [
  { op: 'add', id: 'a1', rec: { id: 'a1', type: 'feed', start: now, value: 150, created: now }, at: now },
  { op: 'add', id: 'a2', rec: { id: 'a2', type: 'hack', start: now }, at: now },
  { op: 'add', id: 'a3', rec: { id: 'a3', type: 'feed', start: 'abc' }, at: now },
  { op: 'update', id: 'a1', rec: { memo: '잘 먹음' }, at: now },
  { op: 'update', id: 'a1', rec: { value: 160 }, at: now },
] } });
const res = r.data.results;
check('정상 기록 저장 · 이상한 종류/시각은 거절', res[0].ok && !res[1].ok && !res[2].ok, res);
check('두 사람이 다른 칸을 고치면 둘 다 남음(메모·양)', res[4].ok && res[4].rec.memo === '잘 먹음' && res[4].rec.value === 160, res[4]);
// 메모 합치기
const day = '2026-11-06';
post({ pin: '1111', action: 'batch', data: { now, ops: [{ op: 'memo', id: day, text: '병원 다녀옴', base: '', at: now }] } });
post({ pin: '2222', action: 'batch', data: { now, ops: [{ op: 'memo', id: day, text: '이유식 시작', base: '', at: now }] } });
let memo = post({ pin: '1111', action: 'load' }).data.memos[day].text;
check('메모를 동시에 쓰면 덮어쓰지 않고 이어 붙임', memo === '병원 다녀옴 / 이유식 시작', memo);
post({ pin: '1111', action: 'batch', data: { now, ops: [{ op: 'memo', id: day, text: '병원 다녀옴 / 이유식 시작 · 잘 먹음', base: memo, at: now }] } });
memo = post({ pin: '1111', action: 'load' }).data.memos[day].text;
check('최신 메모를 보고 고치면 그대로 저장', memo === '병원 다녀옴 / 이유식 시작 · 잘 먹음', memo);
// 잠금(앞에서 틀린 1번은 지우고 시작)
delete cache.pinFails;
// 미래 기념일 허용, 미래 분유는 거절
const fut = post({ pin: '1111', action: 'batch', data: { now, ops: [
  { op: 'add', id: 'f1', rec: { id: 'f1', type: 'anniv', start: now + 100 * 864e5, d1: '백일', created: now }, at: now },
  { op: 'add', id: 'f2', rec: { id: 'f2', type: 'feed', start: now + 3 * 864e5, value: 100, created: now }, at: now }] } }).data.results;
check('기념일은 미래 날짜도 저장, 분유는 미래 3일 거절', fut[0].ok && !fut[1].ok, fut);
const ev = post({ pin: '1111', action: 'batch', data: { now, ops: [{ op: 'add', id: 'e1', rec: { id: 'e1', type: 'event', start: now + 30 * 864e5, d1: '검진', d2: '검진', created: now }, at: now }] } }).data.results;
check('일정(event) 미래 날짜 저장', ev[0].ok, ev);
post({ pin: '1111', action: 'batch', data: { now, ops: [{ op: 'add', id: 'e0', rec: { id: 'e0', type: 'event', start: now - 100 * 864e5, d1: '지난 일정', created: now }, at: now }] } });
check('일정은 오래돼도 항상 앱에 보냄', post({ pin: '1111', action: 'load' }).data.recs.some((r) => r.id === 'e1') && post({ pin: '1111', action: 'load' }).data.recs.some((r) => r.id === 'e0'));
// 메모 비우기 충돌
post({ pin: '2222', action: 'batch', data: { now, ops: [{ op: 'memo', id: '2026-11-07', text: '예방접종', base: '', at: now }] } });
post({ pin: '1111', action: 'batch', data: { now, ops: [{ op: 'memo', id: '2026-11-07', text: '', base: '', at: now }] } });
check('비우려 했는데 그사이 다른 가족이 쓴 메모는 남음', post({ pin: '1111', action: 'load' }).data.memos['2026-11-07'].text === '예방접종');
for (let i = 0; i < 9; i++) post({ pin: String(5000 + i), action: 'login' });
check('9번 틀려도 맞는 PIN은 통과', post({ pin: '1111', action: 'login' }).ok);
r = post({ pin: '5999', action: 'login' });
check('10번째 틀리면 잠김', r.code === 'locked', r);
r = post({ pin: '1111', action: 'login' });
check('잠긴 동안은 맞는 PIN도 막힘(대입 공격 방지)', !r.ok && r.code === 'locked', r);
delete cache.pinLock;
check('잠금이 풀리면 다시 로그인', post({ pin: '1111', action: 'login' }).ok);
console.log(fails ? `\n서버 테스트 ${fails}건 실패` : '\n서버 테스트 모두 통과');
process.exit(fails ? 1 : 0);
