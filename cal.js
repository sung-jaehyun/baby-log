'use strict';
/* 일정 탭: 한 달 달력 + 고른 날 일정 + 다가오는 일정 (docs/CHECKLIST.md 6차)
   우리 일정 = 기록 종류 'event' (세부1 제목 · 세부2 분류 · 세부3 '종일'이면 시간 없음 · 메모)
   자동 표시 = 기념일(100일·200일·돌 + 직접 넣은 기념일), 아직 안 한 접종·검진의 '시작되는 날' */
const CAL = { m: null, sel: null };
const EV_CATS = ['병원', '검진', '접종', '촬영', '가족', '기타'];

/* 날짜별 표시 항목: { k, c: 'me'|'an'|'hl', n(칸 글자), t(목록 제목), sub, r(우리 일정 기록), go } */
function calItems() {
  const key = `${dkey(Date.now())}|${set('babyName')}|${set('birthDate')}|${set('rvType')}|${set('jeType')}`, ref = live();
  if (CAL._ref === ref && CAL._key === key) return CAL._items;
  const m = new Map(), put = (k, it) => { if (!m.has(k)) m.set(k, []); m.get(k).push(Object.assign({ k }, it)); };
  byType('event').forEach((r) => {
    const allDay = r.d3 === '종일';
    put(dk(r), { c: 'me', n: r.d1, t: r.d1, time: allDay ? '' : hm(r.start), sub: [r.d2, r.memo].filter(Boolean).join(' · '), r, at: allDay ? 0 : r.start });
  });
  if (birthKey()) {
    anniList().forEach((a) => put(a.k, { c: 'an', n: `🎉 ${a.n}`, t: `${babyName()} ${a.n}`, sub: '기념일', go: 'anni', at: -1 }));
    // 아직 안 한 접종은 시작일마다 묶어서 하나로(같은 날 여러 개면 'N개월 접종')
    const vd = doneMap('vax'), byDay = new Map();
    vaxList().forEach((it) => { if (it.pick) return; const s = schedInfo(it, vd); if (!s || !s.start || s.st === 'done') return; if (!byDay.has(s.start)) byDay.set(s.start, []); byDay.get(s.start).push(it); });
    byDay.forEach((list, k) => {
      const mo = list[0].from, same = list.every((x) => x.from === mo) && !list[0].after;
      put(k, { c: 'hl', n: same ? `${mo}개월 접종` : '접종', t: same ? `${mo}개월 접종 시작` : '접종 시작', sub: list.map((x) => `${x.n} ${x.dose}`).join(', '), go: 'vax', at: -1 });
    });
    const cd = doneMap('checkup');
    CHECKS.forEach((it) => { const s = schedInfo(it, cd); if (s && s.start && s.st !== 'done') put(s.start, { c: 'hl', n: it.n.replace(' 검진', '검진'), t: `영유아 ${it.n} 시작`, sub: `권장 ${s.win}`, go: 'check', at: -1 }); });
  }
  m.forEach((l) => l.sort((a, b) => a.at - b.at));
  CAL._ref = ref; CAL._key = key; CAL._items = m;
  return m;
}
/* 날짜 칸의 작은 점: 열(주의 기준 이상)·약·병원·하루 메모가 있던 날 */
function calMarks(from, to) {
  const m = new Map(), add = (k, c) => { const s = m.get(k) || new Set(); s.add(c); m.set(k, s); }, warn = Number(set('tempWarn'));
  live().forEach((r) => {
    const k = dk(r); if (k < from || k > to) return;
    if (r.type === 'temp' && Number(r.value) >= warn) add(k, 'var(--temp)');
    else if (r.type === 'med') add(k, 'var(--med)');
    else if (r.type === 'hospital') add(k, 'var(--bath)');
  });
  Object.keys(S.memos).forEach((k) => { if (k >= from && k <= to && S.memos[k] && S.memos[k].text) add(k, 'var(--accent)'); });
  return m;
}
function viewCal() {
  const today = dkey(Date.now());
  if (!CAL.m) CAL.m = today.slice(0, 7);
  if (!CAL.sel) CAL.sel = today;
  const [y, mo] = CAL.m.split('-').map(Number), first = `${CAL.m}-01`;
  const lead = new Date(y, mo - 1, 1).getDay(), days = new Date(y, mo, 0).getDate();
  const n = Math.ceil((lead + days) / 7) * 7, start = addDays(first, -lead), end = addDays(start, n - 1);
  const items = calItems(), marks = calMarks(start, end);
  let cells = '';
  for (let i = 0; i < n; i++) {
    const k = addDays(start, i), w = i % 7, out = k.slice(0, 7) !== CAL.m, list = items.get(k) || [];
    const cls = ['cd', w === 0 ? 'sun' : '', w === 6 ? 'sat' : '', out ? 'out' : '', k === today ? 'today' : '', k === CAL.sel ? 'sel' : ''].join(' ');
    const ev = list.slice(0, 2).map((x) => `<span class="ev ${x.c}">${esc(x.n)}</span>`).join('') + (list.length > 2 ? `<span class="more">+${list.length - 2}</span>` : '');
    const mk = marks.get(k);
    cells += `<button class="${cls}" data-act="calSel" data-k="${k}">${mk ? `<span class="mk">${[...mk].map((c) => `<i style="background:${c}"></i>`).join('')}</span>` : ''}<span class="n">${Number(k.slice(8))}</span>${ev}</button>`;
  }
  const a = babyAge(CAL.sel), sl = items.get(CAL.sel) || [];
  const row = (x) => {
    const bar = { me: '#6B8DE0', an: '#E77FA6', hl: '#5BB98A' }[x.c];
    const done = x.c === 'me' && (x.r.d2 === '검진' || x.r.d2 === '접종') && x.k === today ? `<span class="go" data-act="calDone" data-k="${x.r.d2 === '검진' ? 'check' : 'vax'}">다녀왔어요</span>` : '';
    const act = x.r ? `data-act="calEdit" data-id="${esc(x.r.id)}"` : `data-act="calGo" data-k="${x.go}"`;
    return `<div class="it" ${act}><span class="bar" style="background:${bar}"></span><span class="t">${x.c === 'me' ? (x.time || '종일') : '자동'}</span>
      <span class="tt"><b>${esc(x.t)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>${done}</div>`;
  };
  // 다가오는 일정: 오늘부터 우리 일정·기념일·접종/검진 시작 5개
  const up = [...items.keys()].filter((k) => k >= today).sort().flatMap((k) => items.get(k)).slice(0, 5);
  const upRow = (x) => {
    const dd = dDay(x.k), bar = { me: '#6B8DE0', an: '#E77FA6', hl: '#5BB98A' }[x.c];
    const act = x.r ? `data-act="calEdit" data-id="${esc(x.r.id)}"` : `data-act="calSel" data-k="${x.k}"`;
    return `<div class="it" ${act}><span class="bar" style="background:${bar}"></span><span class="t">${shortDate(x.k)}</span>
      <span class="tt"><b>${esc(x.t)}</b><small>${dd === 0 ? '오늘' : `D-${dd}`}${x.time ? ` · ${x.time}` : ''}${x.c !== 'me' ? ' · 자동 표시' : ''}</small></span></div>`;
  };
  return `<div class="calv">
    <div class="cal-top"><h2>${y}년 ${mo}월</h2>${CAL.m !== today.slice(0, 7) ? '<button class="today" data-act="calToday">오늘</button>' : ''}
      <button class="nav" data-act="calMonth" data-d="-1" aria-label="이전 달">‹</button><button class="nav" data-act="calMonth" data-d="1" aria-label="다음 달">›</button></div>
    <div class="calc"><div class="wk"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>
      <div class="grid">${cells}</div>
      <div class="lg"><span><b style="background:#C9D8FB"></b>우리 일정</span><span><b style="background:#F9C3D7"></b>기념일</span><span><b style="background:#BFE6D2"></b>접종·검진</span><span><b class="dot"></b>열·약·메모</span></div></div>
    <div class="card dl"><div class="h">${dayLabel(CAL.sel)}<small>${a ? `${a.n}일째` : ''}</small></div>
      ${sl.length ? sl.map(row).join('') : '<div class="empty">일정이 없어요</div>'}
      <div class="dl-b"><button class="chip add" data-act="calAdd">＋ 이 날 일정 추가</button>${CAL.sel <= today ? '<button class="chip" data-act="calDay">하루 기록 보기 ›</button>' : ''}</div></div>
    ${up.length ? `<div class="card dl"><div class="h">다가오는 일정</div>${up.map(upRow).join('')}</div>` : ''}
  </div><button class="fab" data-act="calAdd" aria-label="일정 추가">＋</button>`;
}
function calSheet(rec, dayKey) {
  const r0 = rec ? { ...rec } : null;
  let cat = rec ? rec.d2 : '병원', allDay = rec ? rec.d3 === '종일' : false;
  const t = rec && rec.d3 !== '종일' ? hm(rec.start) : '10:00';
  openSheet(`<h3>${ART.icons.cal}${rec ? '일정 수정' : '일정 추가'}</h3>${rec && rec.by ? `<div class="lbl" style="margin:-4px 0 10px">등록한 사람 · ${esc(rec.by)}</div>` : ''}
    <div class="field"><label>제목</label><input id="ct" maxlength="40" placeholder="예: 소아과 진료" value="${esc(rec ? rec.d1 : '')}"></div>
    <div class="f2"><div class="field"><label>날짜</label><input type="date" id="cdt" value="${rec ? dk(rec) : dayKey}"></div>
      <div class="field"><label>시간</label><input type="time" id="ctm" value="${t}" ${allDay ? 'disabled' : ''}></div></div>
    <div class="sb2"><span>종일<small>시간 없이 날짜만</small></span><button class="switch ${allDay ? 'on' : ''}" id="call" aria-label="종일"></button></div>
    <div class="sec" style="margin:10px 0 6px">분류</div>
    <div class="chips" id="ccat">${EV_CATS.map((c) => `<button class="chip ${c === cat ? 'on' : ''}" data-c="${c}">${c}</button>`).join('')}</div>
    <div class="field" style="margin-top:12px"><label>메모 (선택)</label><input id="cm" maxlength="80" placeholder="예: 접종 수첩 챙기기" value="${esc(rec ? rec.memo : '')}"></div>
    <button class="primary" id="save">${rec ? '저장' : '추가'}</button>${rec ? '<button class="ghost danger" id="del">삭제</button>' : '<button class="ghost" id="cancel">닫기</button>'}`, (el) => {
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c) { cat = b.dataset.c; el.querySelectorAll('#ccat .chip').forEach((x) => x.classList.toggle('on', x === b)); return; }
      if (b.id === 'call') { allDay = !allDay; b.classList.toggle('on', allDay); $('#ctm').disabled = allDay; return; }
      if (b.id === 'cancel') { closeSheet(); return; }
      if (b.id === 'del') { if (await ask('이 일정을 삭제할까요?', '삭제')) { removeRec(rec.id); note('일정을 삭제했어요'); } else calSheet(S.recs[rec.id] || rec); return; }
      if (b.id !== 'save') return;
      const title = $('#ct').value.trim(), day = $('#cdt').value, tm = $('#ctm').value, memo = $('#cm').value.trim();   // 창을 닫기 전에 읽기
      if (!title) { note('제목을 입력해주세요'); return; }
      if (!allDay && !tm) { note('시간을 입력하거나 종일을 켜주세요'); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { note('날짜를 입력해주세요'); return; }
      const fields = { start: at(day, allDay ? '00:00' : tm), d1: title, d2: cat, d3: allDay ? '종일' : '', memo };
      closeSheet();
      if (rec) { updateRec(rec.id, fields, r0); note('일정을 고쳤어요'); }
      else { addRec(Object.assign({ type: 'event' }, fields)); note('일정을 추가했어요'); }
      CAL.sel = day; CAL.m = day.slice(0, 7); render();
    });
  });
}
/* 서버가 옛 버전(6 미만)이면 일정을 받지 못함: 저장하지 않고 안내(이 폰에만 남는 일 방지) */
function calServerOk() {
  if (S.auth && S.auth.url !== 'demo' && S.api && S.api < 6) { note('일정을 저장하려면 서버 코드를 새 버전(6)으로 배포해주세요'); return false; }
  return true;
}
/* 홈 알림용: 오늘·내일 우리 일정 */
function calSoon() {
  const today = dkey(Date.now()), tmr = addDays(today, 1);
  // 오늘 일정은 종일이거나 시작 1시간 뒤까지만
  return byType('event').filter((r) => (dk(r) === today && (r.d3 === '종일' || r.start >= Date.now() - HOUR)) || dk(r) === tmr).sort((a, b) => a.start - b.start)
    .map((r) => ({ k: dk(r), when: dk(r) === today ? '오늘' : '내일', time: r.d3 === '종일' ? '' : hm(r.start), t: r.d1 }));
}
/* app.js가 ACTIONS에 합친다(이 파일은 app.js보다 먼저 읽힘) */
const CAL_ACTIONS = ({
  calSel(el) { CAL.sel = el.dataset.k; if (CAL.sel.slice(0, 7) !== CAL.m) CAL.m = CAL.sel.slice(0, 7); render(); },
  calMonth(el) { const [y, m] = CAL.m.split('-').map(Number), d = new Date(y, m - 1 + Number(el.dataset.d), 1); CAL.m = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; CAL.sel = CAL.m === dkey(Date.now()).slice(0, 7) ? dkey(Date.now()) : `${CAL.m}-01`; render(); },
  calToday() { CAL.m = null; CAL.sel = null; render(); },
  calAdd() { if (!calServerOk()) return; calSheet(null, CAL.sel || dkey(Date.now())); },
  calEdit(el) { const r = S.recs[el.dataset.id]; if (r) calSheet(r); },
  calGo(el) { S.tab = 'growth'; GR.sub = el.dataset.k === 'anni' ? 'anni' : 'health'; if (el.dataset.k !== 'anni') GR.health = el.dataset.k; render(); window.scrollTo(0, 0); },
  calDone(el) { S.tab = 'growth'; GR.sub = 'health'; GR.health = el.dataset.k; render(); window.scrollTo(0, 0); },
  calDay() { S.tab = 'day'; S.day = CAL.sel; render(); window.scrollTo(0, 0); },
});
