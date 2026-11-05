'use strict';
/* 성장 탭: 기념일·월간 리포트, 키·몸무게(백분위), 예방접종·검진·병원, 발달·이유식
   모든 기록은 기존 '기록' 시트에 새 종류로 저장한다(저장·재시도·동기화는 app.js 대기열 그대로). */

const LONG_TYPES = new Set(['growth', 'vax', 'checkup', 'hospital', 'milestone', 'anniv', 'food']);
const GROWTH_ONLY = new Set(['growth', 'vax', 'checkup', 'hospital', 'milestone', 'anniv']);   // 홈·하루 목록에 안 나옴
const GR = { kind: 'w', health: 'vax', dev: 'ms', allGrowth: false, allHosp: false, month: null, vaxAll: false, open: {} };

/* ---------- 날짜 ---------- */
function addMonths(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(Math.min(d, last))}`;
}
const birthKey = () => set('birthDate') || null;
const ageMonths = (key) => { const b = birthKey(); return b ? (dstart(key) - dstart(b)) / DAY / 30.4375 : null; };
const shortDate = (key) => { const [y, m, d] = key.split('-').map(Number); return y === new Date().getFullYear() ? `${m}/${d}` : `${y}.${m}.${d}`; };
const dDay = (key) => Math.round((dstart(key) - dstart(dkey(Date.now()))) / DAY);
const dateInputVal = (ms) => (ms ? dkey(ms) : dkey(Date.now()));

/* ---------- WHO 백분위 ---------- */
function lmsAt(kind, age) {
  if (age == null || age < 0 || age >= 36) return null;
  const tbl = kind === 'w' ? WHO_BOYS.weight : age < 24 ? WHO_BOYS.length : WHO_BOYS.height;
  const base = tbl[0][0], i = Math.min(Math.floor(age) - base, tbl.length - 2), f = age - base - i;
  const a = tbl[i], b = tbl[i + 1];
  return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
}
function erf(x) {   // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
function percentile(kind, age, val) {
  const lms = lmsAt(kind, age);
  if (!lms || !(val > 0)) return null;
  const [L, M, S2] = lms;
  const z = Math.abs(L) < 1e-6 ? Math.log(val / M) / S2 : (Math.pow(val / M, L) - 1) / (L * S2);
  return 50 * (1 + erf(z / Math.SQRT2));
}
function valueAtZ(kind, age, z) {
  const lms = lmsAt(kind, age);
  if (!lms) return null;
  const [L, M, S2] = lms;
  return Math.abs(L) < 1e-6 ? M * Math.exp(S2 * z) : M * Math.pow(1 + L * S2 * z, 1 / L);
}
const pctTxt = (p) => (p == null ? '' : p < 1 ? '1 미만' : p > 99 ? '99 초과' : String(Math.round(p)));

/* ---------- 기록 모으기 ---------- */
const byType = (t) => live().filter((r) => r.type === t);
function measures() {
  const g = byType('growth');
  return {
    all: g.slice().sort((a, b) => b.start - a.start),
    w: g.filter((r) => Number(r.value) > 0).map((r) => ({ r, key: dk(r), v: Number(r.value) })),
    h: g.filter((r) => Number(r.d1) > 0).map((r) => ({ r, key: dk(r), v: Number(r.d1) })),
  };
}

/* ---------- 예방접종·검진 일정 (질병관리청 표준예방접종일정, 국가건강정보포털 영유아검진 시기) ---------- */
function vaxList(rv = set('rvType'), je = set('jeType')) {
  const L = [
    ['HepB1', 'B형간염', '1차', 0, 0], ['BCG', '결핵(BCG)', '1회', 0, null, { endDays: 28, note: '피내용 무료, 경피용 유료' }], ['HepB2', 'B형간염', '2차', 1, 1],
    ['DTaP1', 'DTaP', '1차', 2, 2], ['IPV1', '폴리오', '1차', 2, 2], ['Hib1', 'Hib(뇌수막염)', '1차', 2, 2], ['PCV1', '폐렴구균', '1차', 2, 2], ['RV1', '로타바이러스', '1차', 2, 2],
    ['DTaP2', 'DTaP', '2차', 4, 4], ['IPV2', '폴리오', '2차', 4, 4], ['Hib2', 'Hib(뇌수막염)', '2차', 4, 4], ['PCV2', '폐렴구균', '2차', 4, 4], ['RV2', '로타바이러스', '2차', 4, 4],
    ['DTaP3', 'DTaP', '3차', 6, 6], ['IPV3', '폴리오', '3차', 6, 6], ['Hib3', 'Hib(뇌수막염)', '3차', 6, 6], ['PCV3', '폐렴구균', '3차', 6, 6], ['HepB3', 'B형간염', '3차', 6, 6],
  ];
  if (rv !== '로타릭스') L.push(['RV3', '로타바이러스', '3차', 6, 6, { note: rv === '로타텍' ? '' : '로타텍만 3차 (로타릭스는 2차로 끝)' }]);
  L.push(['Flu1', '인플루엔자', '첫해 1차', 6, null, { note: '생후 6개월부터, 이후 매년' }], ['Flu2', '인플루엔자', '첫해 2차', 6, null, { after: 'Flu1', gapD: 28, note: '1차 4주 뒤' }]);
  L.push(['Hib4', 'Hib(뇌수막염)', '4차', 12, 15], ['PCV4', '폐렴구균', '4차', 12, 15], ['MMR1', 'MMR', '1차', 12, 15], ['VAR', '수두', '1회', 12, 15],
    ['HepA1', 'A형간염', '1차', 12, 23], ['HepA2', 'A형간염', '2차', 12, 23, { after: 'HepA1', gapM: 6, note: '1차 6~12개월 뒤' }]);
  if (je === '사백신') L.push(['IJEV1', '일본뇌염(사백신)', '1차', 12, 23], ['IJEV2', '일본뇌염(사백신)', '2차', 12, 23, { after: 'IJEV1', gapD: 7, note: '1차 7~30일 뒤' }], ['IJEV3', '일본뇌염(사백신)', '3차', 24, 35, { after: 'IJEV2', gapM: 12, note: '2차 12개월 뒤' }]);
  else if (je === '생백신') L.push(['LJEV1', '일본뇌염(생백신)', '1차', 12, 23, { note: '생백신은 유료' }], ['LJEV2', '일본뇌염(생백신)', '2차', 24, 35, { after: 'LJEV1', gapM: 12, note: '1차 12개월 뒤' }]);
  else L.push(['JE', '일본뇌염', '종류 선택 필요', 12, 23, { note: '사백신(5회) 또는 생백신(2회) — 위에서 골라주세요', pick: true }]);
  L.push(['DTaP4', 'DTaP', '4차', 15, 18], ['DTaP5', 'DTaP', '5차', 48, 83], ['IPV4', '폴리오', '4차', 48, 83], ['MMR2', 'MMR', '2차', 48, 83]);
  if (je === '사백신') L.push(['IJEV4', '일본뇌염(사백신)', '4차', 72, 83]);
  L.push(['Tdap', 'Tdap', '6차', 132, 155]);
  if (je === '사백신') L.push(['IJEV5', '일본뇌염(사백신)', '5차', 144, 155]);
  return L.map(([k, n, dose, from, to, o]) => Object.assign({ k, n, dose, from, to }, o || {}));
}
const VAX_NAMES = (() => {   // 종류 선택과 상관없이 모든 접종 키 → 이름
  const m = new Map();
  [['', ''], ['로타텍', '사백신'], ['로타릭스', '생백신']].forEach(([rv, je]) => vaxList(rv, je).forEach((x) => m.set(x.k, `${x.n} ${x.dose}`)));
  return m;
});
const CHECKS = [
  ['C1', '1차 검진', null, null, { d0: 14, d1: 35, win: '생후 14~35일' }], ['C2', '2차 검진', 4, 6], ['C3', '3차 검진', 9, 12], ['C4', '4차 검진', 18, 24],
  ['C5', '5차 검진', 30, 36], ['C6', '6차 검진', 42, 48], ['C7', '7차 검진', 54, 60], ['C8', '8차 검진', 66, 71],
  ['O1', '구강검진 1차', 18, 29], ['O2', '구강검진 2차', 30, 41], ['O3', '구강검진 3차', 42, 53], ['O4', '구강검진 4차', 54, 65],
].map(([k, n, from, to, o]) => Object.assign({ k, n, dose: '', from, to }, o || {}));

function doneMap(type) {
  const m = new Map();
  byType(type).filter((r) => r.d3 !== '선택').sort((a, b) => a.start - b.start).forEach((r) => { if (!m.has(r.d1)) m.set(r.d1, r); });
  return m;
}
const dupsOf = (type, key) => byType(type).filter((r) => r.d1 === key && r.d3 !== '선택').sort((a, b) => a.start - b.start);
const monthWin = (from, to) => (from === to ? `${from}개월` : to == null ? `${from}개월부터` : from >= 48 && to % 12 === 11 ? `${from / 12}~${(to + 1) / 12 - 1}세` : `${from}~${to}개월`);
function schedInfo(item, done) {
  const b = birthKey(); if (!b) return null;
  const today = dkey(Date.now());
  let start, end, win;
  if (item.d0 != null) { start = addDays(b, item.d0); end = addDays(b, item.d1); win = item.win; }
  else {
    start = addMonths(b, item.from);
    end = item.endDays ? addDays(b, item.endDays) : item.to == null ? null : addDays(addMonths(b, item.to + 1), -1);
    win = item.endDays ? '생후 4주 이내' : item.from === 0 && item.to === 0 ? '출생 시' : monthWin(item.from, item.to);
    if (item.after) {   // 앞 접종을 한 날 + 최소 간격부터. 앞 접종 전이면 '1차 후'
      const prev = done.get(item.after);
      const byGap = prev ? (item.gapM ? addMonths(dk(prev), item.gapM) : addDays(dk(prev), item.gapD || 0)) : null;
      start = byGap ? (byGap > start ? byGap : start) : null;
      if (start && end && start > end) end = null;
      win = item.note || win;
    }
  }
  const rec = done.get(item.k);
  let st;
  if (rec) st = 'done';
  else if (!start) st = 'wait';
  else if (today < start) st = 'wait';
  else if (end && today > end) st = 'late';
  else st = 'now';
  return { start, end, win, rec, st };
}
function statusTag(s) {
  if (s.st === 'done') return `<span class="tag ok-tag">✓ ${shortDate(dk(s.rec))}</span>`;
  if (s.st === 'now') return `<span class="tag now-tag">지금 시기${s.end ? ` · ~${shortDate(s.end)}` : ''}</span>`;
  if (s.st === 'late') return '<span class="tag late-tag">시기 지남</span>';
  if (!s.start) return '<span class="tag">앞 차수 후</span>';
  const d = dDay(s.start);
  return `<span class="tag">${d <= 60 ? `D-${d}` : shortDate(s.start)}</span>`;
}

/* ---------- 화면 ---------- */
function viewGrowth() {
  if (!birthKey()) return `${header()}<div class="card placeholder">설정에서 생일을 먼저 입력해주세요.</div>`;
  return `${header()}${anniCard()}${growthCard()}${healthCard()}${devCard()}`;
}

/* 기념일 + 월간 리포트 */
function anniList() {
  const b = birthKey();
  const fixed = [['100일', addDays(b, 99)], ['200일', addDays(b, 199)], ['300일', addDays(b, 299)], ['돌', addMonths(b, 12)], ['두 돌', addMonths(b, 24)]]
    .map(([n, k]) => ({ n, k }));
  const custom = byType('anniv').map((r) => ({ n: r.d1, k: dk(r), r }));
  return fixed.concat(custom).sort((a, c) => (a.k < c.k ? -1 : 1));
}
function anniCard() {
  const today = dkey(Date.now());
  const all = anniList();
  const up = all.filter((a) => a.k >= today).slice(0, 3);
  const pastCustom = all.filter((a) => a.r && a.k < today).reverse();
  const cell = (a) => {
    const dd = dDay(a.k);
    const inner = `<div class="lbl">${esc(a.n)}</div><b>${dd === 0 ? '오늘!' : `D-${dd}`}</b><div class="lbl">${shortDate(a.k)}</div>`;
    return a.r ? `<button class="anni-c" data-act="grAnni" data-id="${esc(a.r.id)}">${inner}</button>` : `<div class="anni-c">${inner}</div>`;
  };
  return `<div class="card"><div class="h">기념일<button class="chip" data-act="grAnni" style="padding:5px 10px;font-size:12px">＋ 추가</button></div>
    <div class="anni">${up.length ? up.map(cell).join('') : '<div class="empty">다가오는 기념일이 없어요</div>'}</div>
    ${pastCustom.length ? `<div class="sec">지난 기념일</div><div class="list">${pastCustom.map((a) => `<button class="item" data-act="grAnni" data-id="${esc(a.r.id)}"><span class="t">${shortDate(a.k)}</span><span class="what">${esc(a.n)}</span><span class="tag">${babyAge(a.k) ? `${babyAge(a.k).n}일째` : ''}</span></button>`).join('')}</div>` : ''}
    <button class="report-btn" data-act="grReport">이번 달 리포트 보기 →</button></div>`;
}

/* 키·몸무게 */
function growthCard() {
  const M = measures();
  const last = (arr) => arr.slice().sort((a, b) => a.r.start - b.r.start);
  const w = last(M.w), h = last(M.h);
  const stat = (arr, unit, kind, label) => {
    if (!arr.length) return `<div class="gstat"><div class="lbl">${label}</div><div class="gv">-</div><div class="lbl">아직 기록이 없어요</div></div>`;
    const a = arr[arr.length - 1], p = arr[arr.length - 2];
    const pc = percentile(kind, ageMonths(a.key), a.v);
    const diff = p ? a.v - p.v : null;
    return `<div class="gstat"><div class="lbl">${label} · ${shortDate(a.key)}</div><div class="gv">${kind === 'w' ? a.v.toFixed(2).replace(/0$/, '') : a.v.toFixed(1)}<small> ${unit}</small></div>
      <div class="lbl">${pc != null ? `백분위 ${pctTxt(pc)}` : ''}${diff != null ? `${pc != null ? ' · ' : ''}${diff >= 0 ? '+' : ''}${kind === 'w' ? diff.toFixed(2) : diff.toFixed(1)}${unit}` : ''}</div></div>`;
  };
  const rows = M.all.slice(0, GR.allGrowth ? 999 : 5).map((r) => `<button class="item" data-act="grGrowth" data-id="${esc(r.id)}">
      <span class="t">${shortDate(dk(r))}</span><span class="what">${[Number(r.value) > 0 ? `${Number(r.value)}kg` : '', Number(r.d1) > 0 ? `${Number(r.d1)}cm` : ''].filter(Boolean).join(' · ')}${r.d2 ? `<small>${esc(r.d2)}</small>` : ''}</span><span class="tag">${esc(r.by)}</span></button>`).join('');
  return `<div class="card"><div class="h">키·몸무게<button class="chip" data-act="grGrowth" style="padding:5px 10px;font-size:12px">＋ 기록</button></div>
    <div class="grid2" style="margin-bottom:8px">${stat(w, 'kg', 'w', '몸무게')}${stat(h, 'cm', 'h', '키')}</div>
    <div class="seg"><button class="seg-b ${GR.kind === 'w' ? 'on' : ''}" data-act="grKind" data-k="w">몸무게</button><button class="seg-b ${GR.kind === 'h' ? 'on' : ''}" data-act="grKind" data-k="h">키</button></div>
    ${growthSvg(GR.kind === 'w' ? w : h, GR.kind)}
    <div class="lbl" style="text-align:center;margin:2px 0 8px">옅은 선: 같은 월령 남아 3·15·50·85·97 백분위 (WHO 기준, 질병관리청 성장도표 3세 미만)</div>
    <div class="list">${rows || '<div class="empty">출생 때나 검진 때 잰 값을 ＋ 기록으로 넣어보세요</div>'}
    ${M.all.length > 5 ? `<button class="more" data-act="grMore" data-k="allGrowth">${GR.allGrowth ? '접기' : `전체 보기 (${M.all.length})`}</button>` : ''}</div></div>`;
}
function growthSvg(pts, kind) {
  const W = 320, H = 200, L = 32, R = 22, T = 8, B = 18, iw = W - L - R, ih = H - T - B;
  const ages = pts.map((p) => ageMonths(p.key)).filter((a) => a != null);
  const xmax = Math.min(36, Math.max(6, Math.ceil((Math.max(ageMonths(dkey(Date.now())) || 0, ...ages) + 2) / 3) * 3));
  const Z = [[-1.881, '3'], [-1.036, '15'], [0, '50'], [1.036, '85'], [1.881, '97']];
  const steps = []; for (let a = 0; a <= xmax - 0.001; a += 0.5) steps.push(a); steps.push(Math.min(xmax, 35.99));
  const curves = Z.map(([z, n]) => ({ n, z, p: steps.map((a) => [a, valueAtZ(kind, a, z)]) }));
  const vals = curves.flatMap((c) => c.p.map((p) => p[1])).concat(pts.map((p) => p.v)).filter((v) => v != null);
  const step = kind === 'w' ? 1 : 5;
  const lo = Math.floor(Math.min(...vals) / step) * step, hi = Math.ceil(Math.max(...vals) / step) * step;
  const x = (a) => L + (a / xmax) * iw, y = (v) => T + ih - ((v - lo) / (hi - lo)) * ih;
  let g = '';
  const ystep = kind === 'w' ? (hi - lo > 10 ? 2 : 1) : 5;
  for (let v = lo; v <= hi + 1e-9; v += ystep) g += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#2A2846" stroke-width="0.6"/><text x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#9E99C4">${v}</text>`;
  const xs = xmax <= 12 ? 1 : 3;
  for (let a = 0; a <= xmax; a += xs) g += `<text x="${x(a).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#9E99C4">${a}</text>`;
  g += `<text x="${W - R + 2}" y="${H - 4}" font-size="8" fill="#9E99C4">개월</text>`;
  curves.forEach((c) => {
    g += `<polyline points="${c.p.map(([a, v]) => `${x(a).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${c.z === 0 ? '#7F77DD' : '#3E3A68'}" stroke-width="${c.z === 0 ? 1.4 : 1}"/>`;
    const lp = c.p[c.p.length - 1]; g += `<text x="${(x(lp[0]) + 2).toFixed(1)}" y="${(y(lp[1]) + 3).toFixed(1)}" font-size="8" fill="#9E99C4">${c.n}</text>`;
  });
  const ps = pts.map((p) => [ageMonths(p.key), p.v]).filter(([a]) => a != null && a <= xmax);
  if (ps.length > 1) g += `<polyline points="${ps.map(([a, v]) => `${x(a).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="#FAC775" stroke-width="2"/>`;
  ps.forEach(([a, v]) => { g += `<circle cx="${x(a).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="#FAC775"/>`; });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="성장곡선">${g}</svg>`;
}

/* 건강: 예방접종·검진·병원 */
function healthCard() {
  const vd = doneMap('vax'), cd = doneMap('checkup');
  const vax = vaxList().map((it) => ({ it, s: schedInfo(it, vd), type: 'vax' }));
  const chk = CHECKS.map((it) => ({ it, s: schedInfo(it, cd), type: 'checkup' }));
  const open = vax.concat(chk).filter((x) => x.s && x.s.st !== 'done');
  const nowItems = open.filter((x) => x.s.st === 'now').sort((a, b) => ((a.s.end || '9') < (b.s.end || '9') ? -1 : 1));
  const next = open.filter((x) => x.s.st === 'wait' && x.s.start).sort((a, b) => (a.s.start < b.s.start ? -1 : 1));
  const upcoming = nowItems.concat(next).slice(0, 2);
  const lateN = open.filter((x) => x.s.st === 'late').length;
  const upHtml = upcoming.map((x) => `<button class="up-row" data-act="${x.type === 'vax' ? 'grVax' : 'grCheck'}" data-k="${x.it.k}">
      <span>${esc(x.it.n)} ${esc(x.it.dose)}</span>${statusTag(x.s)}</button>`).join('');
  const seg = [['vax', '예방접종'], ['check', '검진'], ['hosp', '병원']].map(([k, n]) => `<button class="seg-b ${GR.health === k ? 'on' : ''}" data-act="grHealth" data-k="${k}">${n}</button>`).join('');
  let body = '';
  if (GR.health === 'vax') body = vaxBody(vax);
  else if (GR.health === 'check') body = itemRows(chk, 'grCheck');
  else body = hospBody();
  return `<div class="card"><div class="h">건강</div>
    ${upHtml ? `<div class="sec" style="margin-top:0">다가오는 일정</div><div class="up">${upHtml}</div>` : ''}
    ${lateN ? `<div class="lbl" style="margin:6px 0 2px">시기 지난 미완료 ${lateN}건 · 이미 했다면 눌러서 체크해주세요</div>` : ''}
    <div class="seg" style="margin-top:10px">${seg}</div>${body}</div>`;
}
function itemRows(list, act) {
  return `<div class="list">${list.map((x) => `<button class="item" data-act="${act}" data-k="${x.it.k}">
      <span class="what">${esc(x.it.n)} <span class="lbl">${esc(x.it.dose)}</span><small>${esc(x.s.win)}${x.it.note && !x.it.pick ? ` · ${esc(x.it.note)}` : ''}</small></span>${statusTag(x.s)}</button>`).join('')}</div>`;
}
function vaxBody(vax) {
  const groups = [];
  vax.forEach((x) => {
    const g = x.it.from === 0 ? '출생~1개월' : x.it.to == null ? `${x.it.from}개월부터` : monthWin(x.it.from, x.it.to);
    const last = groups[groups.length - 1];
    if (last && last.g === g) last.l.push(x); else groups.push({ g, l: [x] });
  });
  const keys = new Set(vax.map((x) => x.it.k)), names = VAX_NAMES();
  const custom = byType('vax').filter((r) => r.d3 === '선택' || !keys.has(r.d1)).sort((a, b) => b.start - a.start);
  return `<div class="grid2" style="margin:2px 0 6px">
      <div class="field" style="margin:0"><label>로타바이러스</label><select data-set="rvType"><option value="">선택 안 함</option>${['로타텍', '로타릭스'].map((v) => `<option ${set('rvType') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label>일본뇌염</label><select data-set="jeType"><option value="">선택 안 함</option>${['사백신', '생백신'].map((v) => `<option ${set('jeType') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
    ${vaxGroups(groups)}
    <div class="sec">선택 접종 <span class="tag">선택</span></div>
    <div class="list">${custom.map((r) => `<button class="item" data-act="grVaxCustom" data-id="${esc(r.id)}"><span class="what">${esc(names.get(r.d1) || r.d1)}${r.d3 === '선택' ? '' : ' <span class="lbl">(종류 변경 전 기록)</span>'}${r.d2 ? `<small>${esc(r.d2)}</small>` : ''}</span><span class="tag ok-tag">✓ ${shortDate(dk(r))}</span></button>`).join('') || '<div class="empty">수막구균 등 선택 접종은 ＋로 기록해요</div>'}</div>
    <button class="chip" data-act="grVaxCustom" style="margin-top:8px">＋ 선택 접종 기록</button>
    <div class="lbl" style="margin-top:8px">일정: 질병관리청 표준예방접종일정 기준. 실제 접종은 소아과 안내를 따르세요.</div>`;
}
/* 다 맞은 시기는 한 줄로 접고, 다음 시기까지만 보여준다(나머지는 '이후 일정 보기') */
function vaxGroups(groups) {
  const today = dkey(Date.now());
  let cut = groups.findIndex((g) => g.l.some((x) => x.s.st === 'wait' && x.s.start && x.s.start > today));
  if (cut < 0) cut = groups.length - 1;
  const shown = GR.vaxAll ? groups : groups.slice(0, cut + 1);
  const html = shown.map((g) => {
    const allDone = g.l.every((x) => x.s.st === 'done');
    if (allDone && !GR.open[g.g]) return `<button class="stage-done" data-act="grStage" data-g="${esc(g.g)}"><span>${esc(g.g)}</span><span class="tag ok-tag">✓ ${g.l.length}건 모두 완료</span></button>`;
    return `<div class="sec">${esc(g.g)}${allDone ? ` <button class="lbl" data-act="grStage" data-g="${esc(g.g)}">접기</button>` : ''}</div>${itemRows(g.l, 'grVax')}`;
  }).join('');
  const rest = groups.length - shown.length;
  return html + (rest > 0 || GR.vaxAll ? `<button class="more" data-act="grMore" data-k="vaxAll">${GR.vaxAll ? '이후 일정 접기' : `이후 일정 보기 (${groups.slice(cut + 1).reduce((n, g) => n + g.l.length, 0)}건)`}</button>` : '');
}
function hospBody() {
  const h = byType('hospital').sort((a, b) => b.start - a.start);
  return `<div class="list">${h.slice(0, GR.allHosp ? 999 : 6).map((r) => `<button class="item" data-act="grHosp" data-id="${esc(r.id)}"><span class="t">${shortDate(dk(r))}</span>
      <span class="what">${esc(r.d1 || '병원')}${r.d2 ? ` <span class="lbl">${esc(r.d2)}</span>` : ''}${r.memo ? `<small>${esc(r.memo)}</small>` : ''}</span></button>`).join('') || '<div class="empty">병원 다녀온 기록이 없어요</div>'}
    ${h.length > 6 ? `<button class="more" data-act="grMore" data-k="allHosp">${GR.allHosp ? '접기' : `전체 보기 (${h.length})`}</button>` : ''}</div>
    <button class="chip" data-act="grHosp" style="margin-top:8px">＋ 병원 기록</button>`;
}

/* 발달·이유식 */
const MILESTONES = ['목 가누기', '소리 내어 웃기', '옹알이', '뒤집기', '되집기', '배밀이', '혼자 앉기', '기기', '잡고 서기', '첫 이', '첫 걸음'];
function devCard() {
  const seg = [['ms', '발달'], ['food', '이유식']].map(([k, n]) => `<button class="seg-b ${GR.dev === k ? 'on' : ''}" data-act="grDev" data-k="${k}">${n}</button>`).join('');
  let body;
  if (GR.dev === 'ms') {
    const ms = byType('milestone').sort((a, b) => b.start - a.start);
    body = `<div class="list">${ms.map((r) => `<button class="item" data-act="grMs" data-id="${esc(r.id)}"><span class="t">${shortDate(dk(r))}</span>
        <span class="what">${esc(r.d1)}${r.memo ? `<small>${esc(r.memo)}</small>` : ''}</span><span class="tag">${babyAge(dk(r)) ? `${babyAge(dk(r)).n}일째` : ''}</span></button>`).join('') || '<div class="empty">처음 해낸 날을 기록해보세요</div>'}</div>
      <button class="chip" data-act="grMs" style="margin-top:8px">＋ 발달 기록</button>`;
  } else body = foodTable();
  return `<div class="card"><div class="h">발달·이유식</div><div class="seg">${seg}</div>${body}</div>`;
}
function foodTable() {
  const m = new Map();
  byType('food').sort((a, b) => a.start - b.start).forEach((r) => {
    String(r.d1 || '').split(/[,，·、/]/).map((x) => x.trim()).filter(Boolean).forEach((name) => {
      if (!m.has(name)) m.set(name, { name, first: dk(r), n: 0, react: [] });
      const o = m.get(name); o.n++;
      if (r.d3 && r.d3 !== '없음') o.react.push(r.d3);
    });
  });
  const rows = [...m.values()].sort((a, b) => (a.first < b.first ? 1 : -1));
  if (!rows.length) return `<div class="empty">이유식을 기록하면 재료별로 정리돼요${set('showFood') === 'true' ? '' : '<br>설정 → 기능에서 이유식 버튼을 켜세요'}</div>`;
  return `<div class="ttable"><div class="thead" style="grid-template-columns:1.3fr 1fr .6fr 1fr"><span>재료</span><span>처음</span><span>횟수</span><span>반응</span></div>
    ${rows.map((o) => `<div class="trow" style="grid-template-columns:1.3fr 1fr .6fr 1fr"><span>${esc(o.name)}</span><span>${shortDate(o.first)}</span><span>${o.n}회</span>
      <span>${o.react.length ? `<span class="tag late-tag">${esc([...new Set(o.react)].join('·'))} ${o.react.length}회</span>` : '<span class="lbl">없음</span>'}</span></div>`).join('')}</div>`;
}

/* ---------- 입력 창 ---------- */
function dateField(id, label, val) { return `<div class="field"><label>${label}</label><input type="date" id="${id}" value="${val}" max="${dkey(Date.now())}" min="${birthKey() || ''}"></div>`; }
function checkDate(v) {
  if (!v) return '날짜를 골라주세요';
  if (v > dkey(Date.now())) return '미래 날짜는 저장할 수 없어요';
  if (birthKey() && v < birthKey()) return '생일보다 이전 날짜예요';
  return null;
}
function formSheet({ title, icon, body, rec, onSave, onMount, reopen }) {
  openSheet(`<h3>${icon || ''}${title}</h3>${body}
    <button class="primary" id="save">저장</button>${rec ? '<button class="ghost danger" id="del">삭제</button>' : '<button class="ghost" id="cancel">닫기</button>'}`, (el) => {
    if (onMount) onMount(el);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'cancel') { closeSheet(); return; }
      if (b.id === 'del') { if (await ask('이 기록을 삭제할까요?', '삭제')) { closeSheet(); removeRec(rec.id); note('삭제했어요'); } else if (reopen) reopen(); return; }
      if (b.id === 'save') { const err = onSave(el); if (err) note(err); }
    });
  });
}
const numVal = (id) => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
function saveOrAdd(rec, fields) {
  closeSheet();
  if (rec) { updateRec(rec.id, fields); note('수정했어요'); } else { addRec(fields); note('저장했어요'); }
}

function growthSheet(rec) {
  formSheet({
    title: rec ? '키·몸무게 수정' : '키·몸무게 기록', rec, reopen: () => growthSheet(S.recs[rec.id]),
    body: `${dateField('gd', '잰 날', rec ? dk(rec) : dkey(Date.now()))}
      <div class="grid2"><div class="field"><label>몸무게 (kg)</label><input id="gw" type="number" step="0.01" inputmode="decimal" placeholder="예: 6.8" value="${rec && Number(rec.value) > 0 ? esc(rec.value) : ''}"></div>
      <div class="field"><label>키 (cm)</label><input id="gh" type="number" step="0.1" inputmode="decimal" placeholder="예: 62.5" value="${rec && Number(rec.d1) > 0 ? esc(rec.d1) : ''}"></div></div>
      <div class="field"><label>장소·메모</label><input id="gp" maxlength="40" placeholder="예: 소아과, 집" value="${esc(rec ? rec.d2 : '')}"></div>`,
    onSave: () => {
      const d = $('#gd').value, w = numVal('#gw'), h = numVal('#gh');
      const err = checkDate(d); if (err) return err;
      if (w == null && h == null) return '몸무게나 키 중 하나는 입력해주세요';
      if (w != null && !(w >= 1 && w <= 30)) return '몸무게를 확인해주세요 (1~30kg)';
      if (h != null && !(h >= 30 && h <= 130)) return '키를 확인해주세요 (30~130cm)';
      saveOrAdd(rec, { type: 'growth', start: at(d, '12:00'), value: w, d1: h == null ? '' : String(h), d2: $('#gp').value.trim() });
      return null;
    },
  });
}

function vaxSheet(k) {
  const it = vaxList().find((x) => x.k === k); if (!it) return;
  const vd = doneMap('vax'), s = schedInfo(it, vd), rec = s.rec;
  formSheet({
    title: `${esc(it.n)} ${esc(it.dose)}`, rec, reopen: () => vaxSheet(k),
    body: `<div class="lbl" style="margin-bottom:10px">권장 시기: ${esc(s.win)}${s.start ? ` (${shortDate(s.start)}${s.end ? ` ~ ${shortDate(s.end)}` : '부터'})` : ''}${it.note ? `<br>${esc(it.note)}` : ''}</div>
      ${it.pick ? '<div class="lbl">일본뇌염은 사백신·생백신 중 하나를 먼저 골라주세요(예방접종 목록 위 선택 칸).</div>' : `${dateField('vd', '접종한 날', rec ? dk(rec) : dkey(Date.now()))}
      <div class="field"><label>병원</label><input id="vh" maxlength="30" value="${esc(rec ? rec.d2 : '')}"></div>
      <div class="field"><label>메모</label><input id="vm" maxlength="100" placeholder="예: 백신 이름, 열 남" value="${esc(rec ? rec.memo : '')}"></div>
      ${dupsOf('vax', it.k).length > 1 ? `<div class="lbl c-over" style="margin-bottom:6px">같은 접종이 ${dupsOf('vax', it.k).length}건 기록돼 있어요 <button class="chip" id="dedup" style="padding:4px 9px;font-size:12px">첫 기록만 남기기</button></div>` : ''}`}`,
    onMount: (el) => el.addEventListener('click', (e) => { if (e.target.id !== 'dedup') return; dupsOf('vax', it.k).slice(1).forEach((r) => removeRec(r.id)); closeSheet(); note('중복 기록을 정리했어요'); }),
    onSave: () => {
      if (it.pick) { closeSheet(); return null; }
      const d = $('#vd').value, err = checkDate(d); if (err) return err;
      saveOrAdd(rec, { type: 'vax', start: at(d, '12:00'), d1: it.k, d2: $('#vh').value.trim(), memo: $('#vm').value.trim() });
      return null;
    },
  });
}
function vaxCustomSheet(id) {
  const rec = id ? S.recs[id] : null;
  const sugg = ['수막구균', '인플루엔자(매년)', '코로나19'];
  formSheet({
    title: rec ? '선택 접종 수정' : '선택 접종 기록', rec, reopen: () => vaxCustomSheet(id),
    body: `<div class="field"><label>접종 이름</label><input id="cn" maxlength="30" value="${esc(rec ? rec.d1 : '')}"></div>
      <div class="chips" style="margin:-4px 0 10px">${sugg.map((x) => `<button class="chip" data-s="${esc(x)}" style="padding:6px 10px;font-size:12px">${esc(x)}</button>`).join('')}</div>
      ${dateField('cd', '접종한 날', rec ? dk(rec) : dkey(Date.now()))}
      <div class="field"><label>병원·메모</label><input id="cm" maxlength="60" value="${esc(rec ? rec.d2 : '')}"></div>`,
    onMount: (el) => el.addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) $('#cn').value = b.dataset.s; }),
    onSave: () => {
      const n = $('#cn').value.trim(), d = $('#cd').value;
      if (!n) return '접종 이름을 입력해주세요';
      const err = checkDate(d); if (err) return err;
      saveOrAdd(rec, { type: 'vax', start: at(d, '12:00'), d1: n, d2: $('#cm').value.trim(), d3: '선택' });
      return null;
    },
  });
}
function checkSheet(k) {
  const it = CHECKS.find((x) => x.k === k); if (!it) return;
  const s = schedInfo(it, doneMap('checkup')), rec = s.rec;
  formSheet({
    title: esc(it.n), rec, reopen: () => checkSheet(k),
    body: `<div class="lbl" style="margin-bottom:10px">검진 시기: ${esc(s.win)} (${shortDate(s.start)} ~ ${shortDate(s.end)})</div>
      ${dateField('kd', '검진 받은 날', rec ? dk(rec) : dkey(Date.now()))}
      <div class="field"><label>병원</label><input id="kh" maxlength="30" value="${esc(rec ? rec.d2 : '')}"></div>
      ${rec ? '' : `<div class="grid2"><div class="field"><label>몸무게 (kg)</label><input id="kw" type="number" step="0.01" inputmode="decimal"></div>
      <div class="field"><label>키 (cm)</label><input id="kc" type="number" step="0.1" inputmode="decimal"></div></div>
      <div class="lbl" style="margin:-4px 0 10px">키·몸무게를 넣으면 성장 기록에도 함께 저장돼요</div>`}
      <div class="field"><label>메모</label><input id="km" maxlength="100" value="${esc(rec ? rec.memo : '')}"></div>`,
    onSave: () => {
      const d = $('#kd').value, err = checkDate(d); if (err) return err;
      let w = null, h = null;
      if (!rec) {
        w = numVal('#kw'); h = numVal('#kc');
        if (w != null && !(w >= 1 && w <= 30)) return '몸무게를 확인해주세요 (1~30kg)';
        if (h != null && !(h >= 30 && h <= 130)) return '키를 확인해주세요 (30~130cm)';
      }
      saveOrAdd(rec, { type: 'checkup', start: at(d, '12:00'), d1: it.k, d2: $('#kh').value.trim(), memo: $('#km').value.trim() });
      if (!rec && (w != null || h != null)) addRec({ type: 'growth', start: at(d, '12:00'), value: w, d1: h == null ? '' : String(h), d2: it.n });
      return null;
    },
  });
}
const HOSP_REASONS = ['검진', '예방접종', '감기', '열', '장염', '피부', '기타'];
function hospSheet(id) {
  const rec = id ? S.recs[id] : null;
  let reason = rec ? rec.d2 : '';
  formSheet({
    title: rec ? '병원 기록 수정' : '병원 기록', rec, reopen: () => hospSheet(id),
    body: `${dateField('hd', '다녀온 날', rec ? dk(rec) : dkey(Date.now()))}
      <div class="field"><label>병원</label><input id="hn" maxlength="30" value="${esc(rec ? rec.d1 : '')}"></div>
      <div class="sec" style="margin-top:0">이유</div><div class="chips" style="margin-bottom:10px">${HOSP_REASONS.map((x) => `<button class="chip ${reason === x ? 'on' : ''}" data-r="${x}">${x}</button>`).join('')}</div>
      <div class="field"><label>메모 (진료 내용, 처방 등)</label><textarea id="hm" rows="3" maxlength="300">${esc(rec ? rec.memo : '')}</textarea></div>`,
    onMount: (el) => el.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (!b) return; reason = reason === b.dataset.r ? '' : b.dataset.r; el.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x.dataset.r === reason)); }),
    onSave: () => {
      const d = $('#hd').value, err = checkDate(d); if (err) return err;
      if (!$('#hn').value.trim() && !reason) return '병원이나 이유를 입력해주세요';
      saveOrAdd(rec, { type: 'hospital', start: at(d, '12:00'), d1: $('#hn').value.trim(), d2: reason, memo: $('#hm').value.trim() });
      return null;
    },
  });
}
function msSheet(id) {
  const rec = id ? S.recs[id] : null;
  formSheet({
    title: rec ? '발달 기록 수정' : '처음 해낸 날', rec, reopen: () => msSheet(id),
    body: `<div class="chips" style="margin-bottom:10px">${MILESTONES.map((x) => `<button class="chip ${rec && rec.d1 === x ? 'on' : ''}" data-m="${x}">${x}</button>`).join('')}</div>
      <div class="field"><label>항목 (직접 입력 가능)</label><input id="mn" maxlength="30" value="${esc(rec ? rec.d1 : '')}"></div>
      ${dateField('md', '날짜', rec ? dk(rec) : dkey(Date.now()))}
      <div class="field"><label>메모</label><input id="mm" maxlength="100" value="${esc(rec ? rec.memo : '')}"></div>`,
    onMount: (el) => el.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; $('#mn').value = b.dataset.m; el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); }),
    onSave: () => {
      const n = $('#mn').value.trim(), d = $('#md').value;
      if (!n) return '항목을 골라주세요';
      const err = checkDate(d); if (err) return err;
      saveOrAdd(rec, { type: 'milestone', start: at(d, '12:00'), d1: n, memo: $('#mm').value.trim() });
      return null;
    },
  });
}
function anniSheet(id) {
  const rec = id ? S.recs[id] : null;
  formSheet({
    title: rec ? '기념일 수정' : '기념일 추가', rec, reopen: () => anniSheet(id),
    body: `<div class="field"><label>이름</label><input id="an" maxlength="20" placeholder="예: 첫 외출" value="${esc(rec ? rec.d1 : '')}"></div>
      <div class="field"><label>날짜</label><input type="date" id="ad" value="${rec ? dk(rec) : dkey(Date.now())}" min="${birthKey() || ''}"></div>`,
    onSave: () => {
      const n = $('#an').value.trim(), d = $('#ad').value;
      if (!n) return '이름을 입력해주세요';
      if (!d) return '날짜를 골라주세요';
      if (birthKey() && d < birthKey()) return '생일보다 이전 날짜예요';
      saveOrAdd(rec, { type: 'anniv', start: at(d, '12:00'), d1: n });
      return null;
    },
  });
}

/* ---------- 월간 리포트 ---------- */
const monthKeys = (ym) => {
  const [y, m] = ym.split('-').map(Number), n = new Date(y, m, 0).getDate();
  return [...Array(n)].map((_, i) => `${ym}-${pad(i + 1)}`);
};
const prevMonth = (ym) => addMonths(`${ym}-01`, -1).slice(0, 7);
function monthStats(ym) {
  const today = dkey(Date.now()), b = birthKey();
  const days = monthKeys(ym).filter((k) => k < today && (!b || k >= b) && hasData(k));
  const sums = days.map((k) => ({ s: daySummary(k), n: nightStats(k) }));
  const f = sums.filter((x) => x.s.feedN);
  const nt = sums.filter((x) => x.n.tot && !x.n.open);
  const M = measures();
  const lastIn = (arr, from, to) => arr.filter((p) => p.key >= from && p.key <= to).sort((a, c) => a.r.start - c.r.start).pop();
  const end = `${ym}-31`;
  return {
    days: days.length,
    feed: avg(f.map((x) => x.s.feedMl)), feedN: avg(f.map((x) => x.s.feedN)),
    night: avg(nt.map((x) => x.n.tot)), longest: avg(nt.map((x) => x.n.longest)), maxLongest: nt.length ? Math.max(...nt.map((x) => x.n.longest)) : null,
    naps: avg(sums.filter((x) => x.s.napN).map((x) => x.s.napN)),
    w: lastIn(M.w, `${ym}-01`, end), h: lastIn(M.h, `${ym}-01`, end),
    ms: byType('milestone').filter((r) => dk(r).startsWith(ym)).sort((a, c) => a.start - c.start),
  };
}
const arrow = (d, n) => (Math.abs(d) < 1e-9 ? '변화 없음 ' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(n)}`);
function reportSheet(ym) {
  const html = reportHtml(ym);
  const open = $('#dim .sheet.report');
  if (open) { open.innerHTML = html; return; }
  openSheet(html, (el) => {
    el.classList.add('report');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'close') { GR.month = null; closeSheet(); return; }
      if (b.dataset.m) {
        const cur = GR.month;
        const n = b.dataset.m === '1' ? addMonths(`${cur}-01`, 1).slice(0, 7) : prevMonth(cur);
        reportSheet(n); loadMonth(n);
      }
    });
  });
}
function reportHtml(ym) {
  const cur = dkey(Date.now()).slice(0, 7), first = (birthKey() || cur).slice(0, 7);
  GR.month = ym;
  const a = monthStats(ym), p = monthStats(prevMonth(ym));
  const cmp = (v, pv, fmt, unit) => {
    if (v == null) return '<span class="lbl">-</span>';
    if (pv == null) return `${fmt(v)}${unit}`;
    const d = v - pv;
    return `${fmt(v)}${unit} <span class="lbl">${Math.abs(d) < 1e-9 ? '변화 없음' : `${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}${unit}`}</span>`;
  };
  const n0 = (v) => String(Math.round(v)), n1 = (v) => (Math.round(v * 10) / 10).toString(), t = (v) => minShort(v);
  const [y, m] = ym.split('-').map(Number);
  const row = (k, v) => `<div class="k">${k}</div><div class="a">${v}</div>`;
  return (`<div class="daynav" style="margin-bottom:6px"><button data-m="-1" ${ym <= first ? 'style="visibility:hidden"' : ''}>‹</button>
      <div class="d">${y}년 ${m}월 리포트<small>${a.days ? `기록 ${a.days}일 기준 · 지난달과 비교` : '이 달 기록이 없어요'}</small></div>
      <button data-m="1" ${ym >= cur ? 'style="visibility:hidden"' : ''}>›</button></div>
    <div class="cmp" style="grid-template-columns:auto 1fr">
      ${row('하루 수유량', cmp(a.feed, p.feed, n0, 'ml'))}${row('하루 수유 횟수', cmp(a.feedN, p.feedN, n1, '회'))}
      ${row('밤잠', cmp(a.night, p.night, t, ''))}${row('평균 최장 통잠', cmp(a.longest, p.longest, t, ''))}
      ${row('가장 길게 잔 밤', a.maxLongest != null ? t(a.maxLongest) : '<span class="lbl">-</span>')}${row('하루 낮잠 횟수', cmp(a.naps, p.naps, n1, '회'))}
      ${row('몸무게', a.w ? `${a.w.v}kg${p.w ? ` <span class="lbl">${arrow(a.w.v - p.w.v, 2)}kg</span>` : ''}` : '<span class="lbl">이 달 측정 없음</span>')}
      ${row('키', a.h ? `${a.h.v}cm${p.h ? ` <span class="lbl">${arrow(a.h.v - p.h.v, 1)}cm</span>` : ''}` : '<span class="lbl">이 달 측정 없음</span>')}</div>
    ${a.ms.length ? `<div class="sec">이 달의 발달</div>${a.ms.map((r) => `<div class="lbl" style="padding:3px 0">${shortDate(dk(r))} · <b style="color:var(--text)">${esc(r.d1)}</b></div>`).join('')}` : ''}
    <div class="lbl" style="margin-top:10px">진행 중인 오늘은 빼고, 기록이 있는 날만 평균 내요.</div>
    <button class="ghost" id="close">닫기</button>`);
}
function loadMonth(ym) {
  const need = `${prevMonth(ym)}-01`;
  if (!S.loadedFrom || dstart(need) >= S.loadedFrom) return;   // 이미 있는 기간이면 다시 계산하지 않음
  ensureRange(need).then(() => { if (GR.month === ym && $('#dim .sheet.report')) reportSheet(ym); });
}

/* ---------- 동작 ---------- */
const GROWTH_ACTIONS = {
  grKind(el) { GR.kind = el.dataset.k; render(); },
  grHealth(el) { GR.health = el.dataset.k; render(); },
  grDev(el) { GR.dev = el.dataset.k; render(); },
  grMore(el) { GR[el.dataset.k] = !GR[el.dataset.k]; render(); },
  grStage(el) { GR.open[el.dataset.g] = !GR.open[el.dataset.g]; render(); },
  grGrowth(el) { growthSheet(el.dataset.id ? S.recs[el.dataset.id] : null); },
  grVax(el) { vaxSheet(el.dataset.k); },
  grVaxCustom(el) { vaxCustomSheet(el.dataset.id); },
  grCheck(el) { checkSheet(el.dataset.k); },
  grHosp(el) { hospSheet(el.dataset.id); },
  grMs(el) { msSheet(el.dataset.id); },
  grAnni(el) { anniSheet(el.dataset.id); },
  grReport() { const ym = dkey(Date.now()).slice(0, 7); reportSheet(ym); loadMonth(ym); },
};
