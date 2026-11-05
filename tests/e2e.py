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

        # 깸 취소하면 낮/밤 구분도 원래대로
        await pg.evaluate("""()=>{ const n=Date.now(); addRec({type:'sleep',start:n-3*3600000,kind:'밤'}); }""")
        await pg.evaluate("""()=>{ const s=sleeps().filter(r=>!r.end)[0]; s.start=Date.now()-30*60000; s.kind='밤'; dirty(); render(); }""")
        await pg.click('[data-act="sleep"]'); await pg.click('#toast [data-t="undo"]')
        st = await pg.evaluate("(()=>{const s=sleeps().filter(r=>!r.end)[0]; return s ? s.kind : null})()")
        check('깸 취소 → 다시 자는 중, 구분 원래대로', st == '밤', st)
        await pg.click('[data-act="sleep"]'); await settle(pg)

        print('[두 기기]')
        pg2 = await ctx.new_page()
        # 두 번째 휴대폰 흉내: 데모 서버(demoDB)만 같이 쓰고, 나머지 저장공간은 따로
        await pg2.add_init_script("""(()=>{ const P='p2:'; const g=Storage.prototype.getItem, s=Storage.prototype.setItem, r=Storage.prototype.removeItem;
          const k=(x)=> x==='demoDB' ? x : P+x;
          Storage.prototype.getItem=function(x){return g.call(this,k(x))}; Storage.prototype.setItem=function(x,v){return s.call(this,k(x),v)};
          Storage.prototype.removeItem=function(x){return r.call(this,k(x))}; })();""")
        await pg2.goto(BASE + '#s=demo')
        await login(pg2, '2222')
        await pg.click('[data-act="quick"][data-type="bath"]'); await settle(pg)
        await pg2.evaluate('sync()'); await pg2.wait_for_timeout(700)
        await pg2.click('[data-act="quick"][data-type="bath"]'); await pg2.wait_for_timeout(200)
        asked = await pg2.query_selector('.sheet [data-r="1"]') is not None
        check('다른 기기 기록이 동기화되고, 10분 안 중복이면 확인 창', asked)
        if asked: await pg2.click('.sheet [data-r="0"]')
        # 늦게 도착한 옛 동기화 응답이 방금 누른 '깸'을 되돌리지 않는지
        await pg.click('[data-act="sleep"]')
        await pg.evaluate("updateRec(openSleep().id, {start: Date.now()-30*60000})")   # 잠든 지 1분 안 깸은 막으므로 30분 전으로
        await settle(pg)
        await pg.evaluate("""()=>{ const o=DEMO.call; DEMO.call=async(a,d,p)=>{ if(a==='sync'||a==='load'){ const r=await o(a,d,p); await new Promise(z=>setTimeout(z,1500)); return r; } return o(a,d,p); }; window._restore=()=>{DEMO.call=o}; }""")
        await pg.evaluate("S.rev=0; lastSync=0; sync()")
        await pg.wait_for_timeout(200)
        open_id = await pg.evaluate("openSleep().id")
        await pg.click('[data-act="sleep"]'); await pg.evaluate('flush()')
        await pg.wait_for_timeout(2500)
        check('동기화 중 누른 깸이 되돌아가지 않음', await pg.evaluate("(id)=>!!S.recs[id].end", open_id))
        await pg.evaluate('_restore()')
        await pg2.close()

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
        n_sleep = await pg.evaluate("sleeps().length")
        note_txt = await pg.evaluate("($('#note')||{}).textContent||''")
        check('기존 잠과 겹치는 잠은 막음(안내 + 추가 안 됨)', await pg.query_selector('.sheet') is not None and '겹쳐요' in note_txt
              and await pg.evaluate("sleeps().length") == n_sleep, note_txt)
        await pg.click('#cancel')
        cmp = await pg.inner_text('.cmp')
        check('계획 대비 표 표시', '낮잠1' in cmp and '밤잠 시작' in cmp)
        await settle(pg)

        print('[반응 속도] (45일치 기록 + 휴대폰 저사양 수준으로 CPU 6배 느리게)')
        await pg.evaluate("""()=>{ const day=86400000, now=Date.now(); for(let d=4; d<45; d++){ const b=new Date(now-d*day); b.setHours(0,0,0,0); const t=b.getTime();
          [[7.4,150],[10.4,170],[13.4,170],[16.5,150],[19.4,200],[5.6,105]].forEach(([h,v],i)=>{ S.recs['p'+d+'f'+i]={id:'p'+d+'f'+i,type:'feed',start:t+h*3600000,value:v,by:'재현',deleted:false}; });
          [[8.8,9.7,'낮'],[11.6,13.1,'낮'],[14.9,15.5,'낮'],[17.2,17.8,'낮'],[20.6,29.3,'밤']].forEach(([a,z,k],i)=>{ S.recs['p'+d+'s'+i]={id:'p'+d+'s'+i,type:'sleep',start:t+a*3600000,end:t+z*3600000,kind:k,by:'아내',deleted:false}; });
          for(let i=0;i<7;i++) S.recs['p'+d+'d'+i]={id:'p'+d+'d'+i,type:'diaper',start:t+(7+i*2)*3600000,d1:'소변',by:'장모님',deleted:false}; }
          dirty(); render(); }""")
        print('[패턴 탭]')
        await pg.click('[data-act="tab"][data-tab="pattern"]'); await pg.wait_for_timeout(200)
        check('7일 비교표 7줄 + 평균', await pg.locator('.ttable .trow').count() == 7 and await pg.locator('.ttable .tavg').count() == 1)
        avg_txt = await pg.inner_text('.ttable .tavg')
        check('평균에서 오늘(진행 중) 제외', '6일' in avg_txt, avg_txt)
        k0 = await pg.evaluate('patKeys()[6]')
        await pg.click('[data-act="patNav"][data-d="-1"]')
        check('‹ 누르면 7일 전으로', await pg.evaluate('patKeys()[6]') == await pg.evaluate(f"addDays('{k0}', -7)"))
        await pg.click('[data-act="patMode"][data-m="week"]')
        check('주별은 월요일 시작', await pg.evaluate("wd(patKeys()[0])") == '월')
        fut = await pg.evaluate("patKeys().filter(k=>k>dkey(Date.now())).length")
        n_tap = await pg.locator('g[data-act="patDay"]').count()
        n_row = await pg.locator('.ttable button.trow').count()
        check(f'아직 안 온 날({fut}일)은 차트·표 모두 누를 수 없음', n_tap == 7 - fut and n_row == 7 - fut, (fut, n_tap, n_row))
        await pg.click('[data-act="patMode"][data-m="recent"]')
        feed_marks = lambda: pg.locator('svg[aria-label="주간 패턴"] rect[fill="#FAC775"]').count()
        n_on = await feed_marks()
        await pg.click('[data-act="patToggle"][data-k="feed"]')
        n_off = await feed_marks()
        check('수유 끄면 차트에서 수유 표시가 사라짐', n_on > 0 and n_off == 0, (n_on, n_off))
        await pg.click('[data-act="patToggle"][data-k="feed"]')
        await pg.click('[data-act="patToggle"][data-k="pee"]')
        check('항목 켜기·끄기는 기기에 저장', (await pg.evaluate("JSON.parse(localStorage.patToggles)")).get('pee') is True)
        await pg.click('[data-act="patToggle"][data-k="pee"]')
        row_key = await pg.evaluate('patKeys()[4]')
        await pg.click(f'.ttable button.trow[data-d="{row_key}"]')
        check('표의 날짜 줄 누르면 그날 하루 탭', await pg.evaluate('S.tab') == 'day' and await pg.evaluate('S.day') == row_key)
        await pg.click('[data-act="tab"][data-tab="pattern"]')
        # 진행 중인 밤(열린 잠)은 평균·추이에서 빠짐
        op = await pg.evaluate("""()=>{ const y=addDays(dkey(Date.now()),-1); S.recs['openN']={id:'openN',type:'sleep',start:at(y,'20:00'),end:null,kind:'밤',by:'재현',deleted:false}; dirty();
            const ns=nightStats(y); const td=trendData(dkey(Date.now())); const v=td[td.length-1].nightTot; delete S.recs.openN; dirty(); return [ns.open, v]; }""")
        check('진행 중인 밤은 추이에서 제외', op[0] is True and op[1] is None, op)
        # 겹친 잠은 한 번만 센다
        ov = await pg.evaluate("""()=>{ const k=addDays(dkey(Date.now()),-60); const a=at(k,'20:00'); const before=nightStats(k).tot;
            S.recs['ovA']={id:'ovA',type:'sleep',start:a,end:a+3600000,kind:'밤',by:'재현',deleted:false};
            S.recs['ovB']={id:'ovB',type:'sleep',start:a+1800000,end:a+5400000,kind:'밤',by:'아내',deleted:false}; dirty();
            const t=nightStats(k).tot; delete S.recs.ovA; delete S.recs.ovB; dirty(); return [before,t]; }""")
        check('겹친 잠 두 개는 합친 시간만(90분)', ov[0] == 0 and round(ov[1]) == 90, ov)
        first_key = await pg.evaluate('patKeys()[2]')
        await pg.click(f'g[data-act="patDay"][data-d="{first_key}"]')
        check('주간 차트 날짜 누르면 그날 하루 탭', await pg.evaluate('S.tab') == 'day' and await pg.evaluate('S.day') == first_key)
        await pg.click('[data-act="tab"][data-tab="pattern"]')
        for t in ['sleep', 'rhythm', 'feed']:
            await pg.click(f'[data-act="patTrend"][data-t="{t}"]')
        check('추이 그래프 전환', await pg.query_selector('svg[aria-label="추이 그래프"]') is not None)
        check('목표 vs 실제 표시', '수유 간격' in await pg.inner_text('body'))

        print('[성장 탭]')
        await pg.click('[data-act="tab"][data-tab="growth"]'); await pg.wait_for_timeout(150)
        pc = await pg.evaluate("[percentile('w',3,6.3762), percentile('w',3,5.0), valueAtZ('w',12,-1.881), percentile('w',36,14)]")
        check('백분위 계산이 WHO 표와 일치(3개월 중앙값=50, −2SD≈2, 12개월 3%≈7.8kg, 36개월↑ 없음)',
              abs(pc[0]-50) < 0.1 and 1.5 < pc[1] < 3 and abs(pc[2]-7.8) < 0.1 and pc[3] is None, pc)
        await pg.click('[data-act="grGrowth"]')
        await pg.fill('#gw', '50'); await pg.click('#save')
        check('몸무게 범위 밖(50kg)은 저장 안 됨', await pg.query_selector('#gw') is not None)
        await pg.fill('#gd', await pg.evaluate("set('birthDate')")); await pg.fill('#gw', '3.3'); await pg.fill('#gh', '50.2'); await pg.click('#save')
        await pg.wait_for_timeout(100)
        check('출생 기록 저장 → 키·몸무게 카드에 표시', '3.3' in await pg.inner_text('.gstat') and '백분위' in await pg.inner_text('.gstat'))
        check('성장 기록은 홈 최근 기록에 안 나옴', not await pg.evaluate("live().filter(r=>!GROWTH_ONLY.has(r.type)).slice(-3).some(r=>r.type==='growth')") and
              await pg.evaluate("live().some(r=>r.type==='growth')"))
        await pg.evaluate("writeCache()")
        check('오래된 성장 기록도 휴대폰 저장본에 보관', await pg.evaluate("JSON.parse(localStorage.cache).recs.some(r=>r.type==='growth' && r.start < Date.now()-60*86400000)"))
        await pg.click('[data-act="grVax"][data-k="HepB1"]'); await pg.fill('#vd', await pg.evaluate("set('birthDate')")); await pg.click('#save')
        check('접종 체크 → 완료 표시', await pg.evaluate("schedInfo(vaxList().find(x=>x.k==='HepB1'), doneMap('vax')).st") == 'done')
        await pg.click('[data-act="grVax"][data-k="DTaP2"]'); await pg.fill('#vd', await pg.evaluate("addDays(dkey(Date.now()),1)")); await pg.click('#save')
        check('미래 날짜 접종은 저장 안 됨', await pg.query_selector('#vd') is not None)
        await pg.evaluate('closeSheet()')
        await pg.select_option('select[data-set="rvType"]', '로타릭스'); await pg.wait_for_timeout(150)
        check('로타릭스 고르면 로타 3차 숨김', not await pg.evaluate("vaxList().some(x=>x.k==='RV3')"))
        await pg.select_option('select[data-set="rvType"]', ''); await pg.wait_for_timeout(150)
        await pg.click('[data-act="grHealth"][data-k="check"]')
        await pg.click('[data-act="grCheck"][data-k="C1"]'); await pg.fill('#kd', await pg.evaluate("addDays(set('birthDate'),20)"))
        await pg.fill('#kw', '4.2'); await pg.fill('#kc', '53.5'); await pg.click('#save')
        check('검진에 키·몸무게 넣으면 성장 기록도 생김', await pg.evaluate("doneMap('checkup').has('C1') && byType('growth').some(r=>Number(r.value)===4.2 && r.d1==='53.5')"))
        await pg.click('[data-act="grHealth"][data-k="hosp"]'); await pg.click('button.chip[data-act="grHosp"]')
        await pg.click('.sheet [data-r="감기"]'); await pg.fill('#hn', '<b>소아과</b>'); await pg.click('#save')
        check('병원 기록 + 입력값 안전 표시', '<b>소아과</b>' in await pg.inner_text('.card:nth-of-type(4)') or '&lt;b&gt;' in await pg.inner_html('#app'))
        await pg.click('[data-act="grDev"][data-k="ms"]'); await pg.click('button.chip[data-act="grMs"]')
        await pg.click('.sheet [data-m="뒤집기"]'); await pg.click('#save')
        check('발달 기록', await pg.evaluate("byType('milestone').some(r=>r.d1==='뒤집기')"))
        await pg.evaluate("addRec({type:'food',start:Date.now()-86400000,d1:'쌀미음, 애호박',value:10,d2:'g',d3:'발진'})")
        await pg.click('[data-act="grDev"][data-k="food"]')
        ft = await pg.inner_text('.ttable')
        check('이유식 재료별 표 + 반응 표시', '애호박' in ft and '쌀미음' in ft and '발진' in ft, ft)
        await pg.click('[data-act="grReport"]'); await pg.wait_for_timeout(150)
        check('월간 리포트 열림', '리포트' in await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-m="-1"]'); await pg.wait_for_timeout(150)
        check('지난달로 이동', await pg.evaluate("GR.month") == await pg.evaluate("prevMonth(dkey(Date.now()).slice(0,7))"))
        await pg.evaluate('closeSheet()')
        await settle(pg)
        srv = await pg.evaluate("JSON.parse(localStorage.demoDB).recs.filter(r=>['growth','vax','checkup','hospital','milestone'].includes(r.type)).length")
        check('성장 기록이 서버에 저장됨', srv >= 6, srv)

        cdp = await ctx.new_cdp_session(pg)
        await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 6})
        await pg.click('[data-act="tab"][data-tab="home"]'); await pg.wait_for_timeout(300)
        for label, sel, limit in [('하루 탭', '[data-tab="day"]', 200), ('패턴 탭', '[data-act="tab"][data-tab="pattern"]', 200),
                                  ('패턴 ‹ 이동', '[data-act="patNav"][data-d="-1"]', 200), ('성장 탭', '[data-act="tab"][data-tab="growth"]', 200),
                                  ('홈 탭', '[data-act="tab"][data-tab="home"]', 200), ('분유 창', '[data-act="feed"]', 200)]:
            ms = await tap_ms(pg, sel)
            check(f'{label} {ms:.0f}ms (기준 {limit}ms)', ms < limit, f'{ms:.0f}ms')
            if await pg.query_selector('#dim'): await pg.evaluate('closeSheet()')
            await pg.wait_for_timeout(200)
        # 뒤에서 다시 그리기가 일어나는 순간에 누른 버튼도 동작하는지
        await pg.evaluate("setTimeout(()=>bgRender(), 30)")
        await pg.click('[data-act="feed"]'); await pg.wait_for_timeout(500)
        check('뒤에서 화면 갱신 중 누른 버튼도 동작', await pg.query_selector('.sheet') is not None)
        await pg.evaluate('closeSheet()')
        await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})

        leaked = await pg.evaluate("JSON.parse(localStorage.demoDB).recs.filter(r=>'_dk' in r||'_dks' in r||'_local' in r||'_nk' in r).length")
        check('서버로 보내는 기록에 내부 표시값 없음', leaked == 0, leaked)
        check('화면 오류 없음', not errs, errs)
        await b.close()
    print('\n결과:', '모두 통과' if not FAILS else f'{len(FAILS)}건 실패: ' + ', '.join(FAILS))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
