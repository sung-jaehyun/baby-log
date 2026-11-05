// 데모 모드: 서버 주소에 'demo'를 넣으면 휴대폰 안에서만 동작 (PIN 1111/2222/3333)
const DEMO = (() => {
  const KEY = 'demoDB';
  const PLAN_4 = { wake: '07:00', bed: '19:40', bath: '19:00', feedInterval: 180,
    feeds: [['07:20', '수유1'], ['10:20', '수유2'], ['13:20', '수유3'], ['16:20', '수유4'], ['19:20', '막수']],
    naps: [['08:45', '09:45', ''], ['11:30', '13:00', ''], ['14:45', '15:25', ''], ['17:10', '17:50', '']] };
  const PLAN_3 = { wake: '07:00', bed: '19:40', bath: '19:00', feedInterval: 180,
    feeds: [['07:20', '수유1'], ['11:00', '수유2'], ['14:20', '수유3'], ['17:30', '수유4(절반)'], ['19:20', '막수']],
    naps: [['08:45', '10:00', '60'], ['12:00', '14:00', '120'], ['16:30', '17:10', '']] };

  function seed() {
    const now = Date.now();
    const day = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.getTime(); };
    const t = (n, h, m) => day(n) + (h * 60 + m) * 60000;
    const who = ['재현', '아내', '장모님'];
    const recs = [];
    let i = 0;
    const add = (o) => { if (o.start > now) return; if (o.end && o.end > now) o.end = null; recs.push(Object.assign({ id: 'demo' + (i++), end: null, value: null, d1: '', d2: '', d3: '', kind: '', memo: '', by: who[i % 3], created: o.start, updated: o.start, deleted: false }, o)); };
    for (let n = -3; n <= 0; n++) {
      const j = (n + 4) * 3;
      add({ type: 'sleep', kind: '밤', start: t(n - 1, 20, 30 + j), end: t(n, 5, 20 + j) });
      add({ type: 'feed', value: 105, start: t(n, 5, 35 + j) });
      add({ type: 'sleep', kind: '밤', start: t(n, 5, 55 + j), end: t(n, 6, 50 + j) });
      add({ type: 'diaper', d1: '소변', start: t(n, 6, 55) });
      add({ type: 'feed', value: 150, start: t(n, 7, 25) });
      add({ type: 'sleep', kind: '낮', start: t(n, 8, 50 + j), end: t(n, 9, 40 + j) });
      add({ type: 'feed', value: 170, start: t(n, 10, 25) });
      add({ type: 'diaper', d1: n === -1 ? '대변' : '소변', d2: n === -1 ? '노랑' : '', d3: n === -1 ? '보통' : '', start: t(n, 10, 40) });
      add({ type: 'sleep', kind: '낮', start: t(n, 11, 35), end: t(n, 13, 5 + j) });
      add({ type: 'feed', value: 170, start: t(n, 13, 25) });
      add({ type: 'sleep', kind: '낮', start: t(n, 14, 55), end: t(n, 15, 30) });
      add({ type: 'feed', value: 150, start: t(n, 16, 30) });
      add({ type: 'sleep', kind: '낮', start: t(n, 17, 15), end: t(n, 17, 45) });
      add({ type: 'bath', start: t(n, 19, 5) });
      add({ type: 'feed', value: 200, start: t(n, 19, 25) });
    }
    return {
      users: [{ name: '재현', pin: '1111', active: true }, { name: '아내', pin: '2222', active: true }, { name: '장모님', pin: '3333', active: true }],
      settings: { babyName: '은우', birthDate: '2026-07-30', feedPresets: '105,135,150,170,200', nightStart: '19:00', nightEnd: '07:00', tempWarn: '37.5', tempHigh: '38.0', showFood: 'false', nightMode: 'start' },
      plans: { '낮잠 4회': PLAN_4, '낮잠 3회': PLAN_3 },
      apply: [{ from: '2026-10-01', name: '낮잠 4회', plan: PLAN_4 }],
      recs, memos: {}, log: [],
    };
  }
  const db = () => { let d; try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) {} if (!d) { d = seed(); save(d); } return d; };
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function call(action, data, pin) {
    await wait(400);
    const d = db();
    const u = d.users.find((x) => x.active && x.pin === String(pin));
    if (!u) { const e = new Error('PIN이 맞지 않아요.'); e.server = true; e.code = 'pin'; throw e; }
    const now = Date.now();
    d.rev = d.rev || 1;
    const pub = () => d.users.map((x, i) => ({ name: x.name, active: x.active, admin: i === 0 }));
    let out = {};
    switch (action) {
      case 'login': out = { weakPin: ['1111', '2222', '3333'].includes(String(pin)) && false }; break;
      case 'load': out = { settings: d.settings, plans: d.plans, apply: d.apply, users: pub(), recs: d.recs, memos: d.memos }; break;
      case 'sync': out = data.rev === d.rev ? { same: true } : { settings: d.settings, plans: d.plans, apply: d.apply, users: pub(), recs: d.recs.filter((r) => r.updated > data.since), memos: d.memos }; break;
      case 'range': out = { recs: d.recs.filter((r) => r.start >= data.from && r.start < data.to) }; break;
      case 'batch': {
        out = { results: data.ops.map((op) => {
          if (d.resetAt && (op.op === 'add' || op.op === 'memo')) {
            const ts = Number(op.at || (op.rec && op.rec.created) || 0), skew = data.now ? now - Number(data.now) : 0;
            const keep = op.op === 'add' && d.resetScope !== 'all' && op.rec && ['growth', 'vax', 'checkup', 'hospital', 'milestone', 'anniv'].includes(op.rec.type);
            if ((ts && ts + skew <= d.resetAt && !keep) || (!ts && op.op === 'add')) return { ok: false, code: 'reset' };
          }
          if (op.op === 'add') {
            const ex = d.recs.find((x) => x.id === op.rec.id); if (ex) return { ok: true, rec: ex };
            const r = Object.assign({}, op.rec, { created: now, updated: now, deleted: false }); d.recs.push(r); return { ok: true, rec: r };
          }
          if (op.op === 'memo') { d.memos[op.id] = { text: op.text, by: u.name }; return { ok: true }; }
          const r = d.recs.find((x) => x.id === op.id);
          if (!r) return { ok: false, code: 'notfound', err: '기록을 찾을 수 없어요.' };
          Object.assign(r, op.op === 'remove' ? { deleted: true } : op.rec, { updated: now }); return { ok: true, rec: r };
        }) };
        d.rev++; break;
      }
      case 'changeMyPin': u.pin = String(data.pin); d.rev++; break;
      case 'setSettings': Object.assign(d.settings, data.values); out = { settings: d.settings }; break;
      case 'savePlan': d.plans[data.name] = data.plan; out = { plans: d.plans }; break;
      case 'applyPlan': d.apply.push({ from: data.from, name: data.name, plan: d.plans[data.name] }); out = { apply: d.apply }; break;
      case 'saveMemo': d.memos[data.date] = { text: data.text, by: u.name }; out = { memos: d.memos }; break;
      case 'saveUsers': {
        // 맨 위 사람(관리자)은 관리자 본인만 바꿀 수 있음(서버와 같게)
        const adm = d.users[0], list = data.users.filter((x) => x.name);
        const mine = list.find((x) => (x.oldName || x.name) === adm.name);
        const rest = list.filter((x) => x !== mine);
        data.users = [u.name === adm.name && mine ? Object.assign({}, mine, { active: true }) : { name: adm.name, pin: '', oldName: adm.name, active: true }, ...rest];
      }
      d.users = data.users.map((x) => ({ name: x.name, pin: x.pin || (d.users.find((y) => y.name === (x.oldName || x.name)) || {}).pin || '', active: x.active })); out = { users: pub() }; break;
      case 'getLog': out = { log: [] }; break;
      case 'resetRecords': {
        if (u.name !== d.users[0].name) { const e = new Error('기록 지우기는 관리자(사용자 목록 맨 위)만 할 수 있어요.'); e.server = true; e.code = 'error'; throw e; }
        if (data.confirm !== '지우기' || String(data.pin) !== String(pin)) { const e = new Error('확인 글자나 PIN이 맞지 않아요.'); e.server = true; e.code = 'error'; throw e; }
        const G = ['growth', 'vax', 'checkup', 'hospital', 'milestone', 'anniv'];
        d.backup = { recs: d.recs, memos: d.memos };
        d.recs = data.scope === 'all' ? [] : d.recs.filter((r) => G.includes(r.type));
        d.memos = {}; d.resetAt = now; d.resetScope = data.scope === 'all' ? 'all' : 'daily'; d.rev++;
        out = { backup: '기록_백업_demo', kept: d.recs.length }; break;
      }
      default: { const e = new Error('알 수 없는 요청'); e.server = true; throw e; }
    }
    if (['setSettings', 'savePlan', 'applyPlan', 'saveUsers'].includes(action)) d.rev++;
    save(d);
    return { ok: true, api: 4, user: u.name, now, rev: d.rev, reset: d.resetAt || 0, resetScope: d.resetScope || '', data: JSON.parse(JSON.stringify(out)) };
  }
  return { call };
})();
