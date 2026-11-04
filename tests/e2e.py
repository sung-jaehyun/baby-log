"""자동 테스트: 데모 모드에서 실제 휴대폰처럼 눌러보며 핵심 기능과 반응 속도를 확인한다.
실행: (저장소 폴더에서) python3 -m http.server 8765 &  →  python3 tests/e2e.py
"""
import asyncio, sys, json
from playwright.async_api import async_playwright

BASE = 'http://localhost:8765/index.html'
FAILS = []
def check(name, ok, detail=''):
    print(('  ✓ ' if ok else '  ✗ ') + name + ('' if ok else f'  → {detail}'))
    if not ok: FAILS.append(name)

async def login(pg, pin='1111'):
    for n in pin: await pg.click(f'[data-n="{n}"]')
    await pg.wait_for_selector('.status', timeout=10000)
    await pg.wait_for_function('S.serverTime > 0', timeout=10000)

async def confirm_if_asked(pg):
    await pg.wait_for_timeout(150)
    if await pg.query_selector('.sheet [data-r="1"]'): await pg.click('.sheet [data-r="1"]')

async def settle(pg):
    await pg.evaluate('flush()')
    await pg.wait_for_function('S.queue.length === 0', timeout=10000)

async def tap_ms(pg, sel):
    return await pg.evaluate("""(sel)=>new Promise(res=>{const t0=performance.now(); document.querySelector(sel).click();
      requestAnimationFrame(()=>requestAnimationFrame(()=>res(performance.now()-t0)));})""", sel)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul')
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '#s=demo')
        await login(pg)

        print('[기록]')
        n0 = await pg.evaluate('live().filter(r=>r.type==="feed").length')
        await pg.click('[data-act="feed"]'); await pg.click('.sheet [data-p="135"]'); await pg.click('.sheet [data-d="5"]'); await pg.click('#save')
        await confirm_if_asked(pg)
        await pg.wait_for_selector('#toast')
        last = await pg.evaluate('lastOf("feed")')
        check('분유 140ml 즉시 반영', last['value'] == 140 and await pg.evaluate('live().filter(r=>r.type==="feed").length') == n0 + 1)
        t_before = last['start']
        await pg.click('#toast [data-t="-5"]')
        last = await pg.evaluate('lastOf("feed")')
        check('토스트 −5분 보정', abs((t_before - last['start']) - 300000) < 1000)
        await settle(pg)
        srv = await pg.evaluate('JSON.parse(localStorage.demoDB).recs.find(r=>r.id===lastOf("feed").id)')
        check('서버에 1건만, 보정값 반영', srv is not None and srv['start'] == last['start'] and srv['value'] == 140)
        cnt = await pg.evaluate('JSON.parse(localStorage.demoDB).recs.filter(r=>r.id===lastOf("feed").id).length')
        check('같은 기록 중복 저장 없음', cnt == 1, cnt)

        print('[잠]')
        await pg.evaluate("""()=>{const n=Date.now(); addRec({type:'sleep',start:n-20*60000,kind:'낮',by:'아내'}); addRec({type:'sleep',start:n-15*60000,kind:'낮',by:'재현'});}""")
        await pg.click('[data-act="sleep"]'); await pg.wait_for_timeout(100)
        check('동시에 열린 잠 2개 → 깸 한 번에 하나로 합침', await pg.evaluate('sleeps().filter(r=>!r.end).length') == 0)
        await settle(pg)
        k = await pg.evaluate("""()=>{ const d=new Date(); d.setDate(d.getDate()-1); d.setHours(18,50,0,0); const s=d.getTime(); return sleepKind(s, s+11*3600000); }""")
        check('18:50 잠들어 아침까지 → 밤잠으로 판단', k == '밤', k)
        k2 = await pg.evaluate("""()=>{ const d=new Date(); d.setHours(17,10,0,0); const s=d.getTime(); return sleepKind(s, s+40*60000); }""")
        check('17:10~17:50 → 낮잠', k2 == '낮', k2)

        print('[오프라인·오류]')
        await pg.evaluate("""()=>{ window._real=DEMO.call; DEMO.call=async()=>{throw new Error('offline')}; }""")
        await pg.click('[data-act="quick"][data-type="walk"]')
        await pg.evaluate('flush()'); await pg.wait_for_timeout(200)
        check('인터넷 끊김: 기록은 화면에 있고 대기열에 남음', await pg.evaluate('S.queue.length') >= 1 and await pg.evaluate('!!lastOf("walk")'))
        await pg.reload(); await pg.wait_for_selector('.status')
        check('새로고침해도 대기열 유지', await pg.evaluate('S.queue.length') >= 1)
        await settle(pg)
        check('연결되면 자동 업로드', await pg.evaluate('JSON.parse(localStorage.demoDB).recs.some(r=>r.type==="walk")'))
        # 다른 기기에서 내 PIN이 바뀐 상황
        await pg.evaluate("""()=>{ const d=JSON.parse(localStorage.demoDB); d.users[0].pin='4821'; localStorage.demoDB=JSON.stringify(d); }""")
        bath_id = await pg.evaluate("""()=> addRec({type:'bath', start:Date.now()}).id""")
        await pg.evaluate('flush()'); await pg.wait_for_timeout(700)
        q = await pg.evaluate('S.queue.length')
        check('PIN이 바뀌면 로그인 화면으로, 대기 기록은 유지', await pg.query_selector('.login') is not None and q >= 1, q)
        await login(pg, '4821'); await settle(pg)
        check('새 PIN으로 로그인 후 대기 기록 업로드', await pg.evaluate('(id)=>JSON.parse(localStorage.demoDB).recs.some(r=>r.id===id)', bath_id))

        print('[하루 탭]')
        await pg.click('[data-act="tab"][data-tab="day"]')
        await pg.fill('#daymemo', '처음 뒤집기 시도')
        await pg.evaluate('render()')
        check('메모 입력 중 화면 갱신해도 글 유지', await pg.input_value('#daymemo') == '처음 뒤집기 시도')
        await pg.wait_for_timeout(1000); await settle(pg)
        check('메모 자동 저장', '처음 뒤집기' in await pg.evaluate('JSON.stringify(JSON.parse(localStorage.demoDB).memos)'))
        await pg.click('[data-act="day"][data-d="-1"]')
        await pg.click('[data-act="addPast"]'); await pg.click('.sheet [data-t="feed"]')
        await pg.fill('#es', await pg.evaluate("toLocalInput(at(S.day,'09:10'))")); await pg.fill('#ev', '160'); await pg.click('#save')
        ok = await pg.evaluate("live().some(r=>r.type==='feed'&&r.value===160&&hm(r.start)==='09:10'&&dkey(r.start)===S.day)")
        check('지난 날짜에 기록 추가', ok)
        await pg.click('[data-act="addPast"]'); await pg.click('.sheet [data-t="sleep"]')
        await pg.fill('#es', await pg.evaluate("toLocalInput(at(S.day,'09:00'))")); await pg.fill('#ee', await pg.evaluate("toLocalInput(at(S.day,'09:30'))")); await pg.click('#save')
        check('기존 잠과 겹치는 잠은 막음', await pg.query_selector('.sheet') is not None)
        await pg.click('#cancel')
        cmp = await pg.inner_text('.cmp')
        check('계획 대비 표 표시', '낮잠1' in cmp and '밤잠 시작' in cmp)
        await settle(pg)

        print('[반응 속도] (휴대폰 저사양 수준으로 CPU 6배 느리게)')
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 6})
        await pg.click('[data-act="tab"][data-tab="home"]'); await pg.wait_for_timeout(300)
        for label, sel, limit in [('하루 탭', '[data-tab="day"]', 200), ('홈 탭', '[data-act="tab"][data-tab="home"]', 200),
                                  ('분유 창', '[data-act="feed"]', 200)]:
            ms = await tap_ms(pg, sel)
            check(f'{label} {ms:.0f}ms (기준 {limit}ms)', ms < limit, f'{ms:.0f}ms')
            if await pg.query_selector('#dim'): await pg.evaluate('closeSheet()')
            await pg.wait_for_timeout(200)
        await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})

        check('화면 오류 없음', not errs, errs)
        await b.close()
    print('\n결과:', '모두 통과' if not FAILS else f'{len(FAILS)}건 실패: ' + ', '.join(FAILS))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
