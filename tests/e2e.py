"""자동 테스트: 데모 모드에서 실제 휴대폰처럼 눌러보며 핵심 기능과 반응 속도를 확인한다.
실행: (저장소 폴더에서) python3 -m http.server 8765 &  →  python3 tests/e2e.py
"""
import asyncio, sys, json, base64
from playwright.async_api import async_playwright

import os
BASE = os.environ.get('E2E_BASE', 'http://localhost:8765/index.html')
FAILS = []
def check(name, ok, detail=''):
    print(('  ✓ ' if ok else '  ✗ ') + name + ('' if ok else f'  → {detail}'))
    if not ok: FAILS.append(name)

async def login(pg, pin='1111'):
    for n in pin: await pg.click(f'[data-n="{n}"]')
    await pg.wait_for_selector('.hero', timeout=10000)
    await pg.wait_for_function('S.serverTime > 0', timeout=10000)
    # 데모 기록 중 '방금 15분 안' 기록은 빼 둔다(테스트를 도는 시각에 따라 중복 확인 창이 떠서 결과가 달라지지 않게)
    await pg.evaluate("(()=>{ const n=Date.now(); Object.values(S.recs).forEach(r=>{ if (!r.deleted && String(r.id).startsWith('demo') && Math.abs(n-r.start) < 15*60000) r.deleted = true; }); dirty(); render(true); })()")

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
        await pg.reload(); await pg.wait_for_selector('.hero')
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
        await pg.click('.psum')   # 계획 대비는 기록 카드 안 요약 한 줄 → 누르면 펼침
        if await pg.query_selector('[data-act="dayMore"][data-k="planAll"]'): await pg.click('[data-act="dayMore"][data-k="planAll"]')
        cmp = await pg.inner_text('.cmp-list')
        check('계획 대비 목록 표시(더 보기로 전부)', '낮잠1' in cmp and '밤잠 시작' in cmp)
        await pg.click('.psum')
        n_items = await pg.locator('.card.list button.item[data-act="edit"]').count()
        n_day = await pg.evaluate("Number($('.card.list .h').firstChild.textContent.match(/(\\d+)건/)[1])")
        check('기록 전체는 최근 5개까지 + 앞의 기록 더 보기', n_items == min(5, n_day) and (n_day <= 5 or await pg.query_selector('[data-act="dayMore"][data-k="dayAll"]') is not None), (n_items, n_day))
        await settle(pg)

        print('[반응 속도] (45일치 기록 + 휴대폰 저사양 수준으로 CPU 6배 느리게)')
        await pg.evaluate("""()=>{ const day=86400000, now=Date.now(); for(let d=4; d<45; d++){ const b=new Date(now-d*day); b.setHours(0,0,0,0); const t=b.getTime();
          [[7.4,150],[10.4,170],[13.4,170],[16.5,150],[19.4,200],[5.6,105]].forEach(([h,v],i)=>{ S.recs['p'+d+'f'+i]={id:'p'+d+'f'+i,type:'feed',start:t+h*3600000,value:v,by:'재현',deleted:false}; });
          [[8.8,9.7,'낮'],[11.6,13.1,'낮'],[14.9,15.5,'낮'],[17.2,17.8,'낮'],[20.6,29.3,'밤']].forEach(([a,z,k],i)=>{ S.recs['p'+d+'s'+i]={id:'p'+d+'s'+i,type:'sleep',start:t+a*3600000,end:t+z*3600000,kind:k,by:'아내',deleted:false}; });
          for(let i=0;i<7;i++) S.recs['p'+d+'d'+i]={id:'p'+d+'d'+i,type:'diaper',start:t+(7+i*2)*3600000,d1:'소변',by:'장모님',deleted:false}; }
          dirty(); render(); }""")
        print('[패턴 탭]')
        await pg.click('#tabs [data-tab="pattern"]'); await pg.wait_for_timeout(200)
        check('패턴 탭 첫 화면은 주간 그래프', await pg.query_selector('svg[aria-label="주간 패턴"]') is not None)
        check('주간 그래프 시간 눈금 3시간마다', await pg.locator('svg[aria-label="주간 패턴"] text').filter(has_text='15').count() >= 1)
        await pg.click('[data-act="patSub"][data-k="cmp"]')
        check('7일 비교표 7줄 + 평균', await pg.locator('.ttable .trow').count() == 7 and await pg.locator('.ttable .tavg').count() == 1)
        avg_txt = await pg.inner_text('.ttable .tavg')
        check('평균에서 오늘(진행 중) 제외', '6일' in avg_txt, avg_txt)
        await pg.click('[data-act="patSub"][data-k="week"]')
        k0 = await pg.evaluate('patKeys()[6]')
        await pg.click('[data-act="patNav"][data-d="-1"]')
        check('‹ 누르면 7일 전으로', await pg.evaluate('patKeys()[6]') == await pg.evaluate(f"addDays('{k0}', -7)"))
        await pg.click('[data-act="patMode"][data-m="week"]')
        check('주별은 월요일 시작', await pg.evaluate("wd(patKeys()[0])") == '월')
        fut = await pg.evaluate("patKeys().filter(k=>k>dkey(Date.now())).length")
        n_tap = await pg.locator('g[data-act="patDay"]').count()
        await pg.click('[data-act="patSub"][data-k="cmp"]')
        n_row = await pg.locator('.ttable button.trow').count()
        await pg.click('[data-act="patSub"][data-k="week"]')
        check(f'아직 안 온 날({fut}일)은 차트·표 모두 누를 수 없음', n_tap == 7 - fut and n_row == 7 - fut, (fut, n_tap, n_row))
        await pg.click('[data-act="patMode"][data-m="recent"]')
        feed_marks = lambda: pg.locator('svg[aria-label="주간 패턴"] rect[fill="#F2B544"]').count()
        n_on = await feed_marks()
        await pg.click('[data-act="patToggle"][data-k="feed"]')
        n_off = await feed_marks()
        check('수유 끄면 차트에서 수유 표시가 사라짐', n_on > 0 and n_off == 0, (n_on, n_off))
        await pg.click('[data-act="patToggle"][data-k="feed"]')
        await pg.click('[data-act="patToggle"][data-k="pee"]')
        check('항목 켜기·끄기는 기기에 저장', (await pg.evaluate("JSON.parse(localStorage.patToggles)")).get('pee') is True)
        await pg.click('[data-act="patToggle"][data-k="pee"]')
        await pg.click('[data-act="patSub"][data-k="cmp"]')
        row_key = await pg.evaluate('patKeys()[4]')
        await pg.click(f'.ttable button.trow[data-d="{row_key}"]')
        check('표의 날짜 줄 누르면 그날 하루 탭', await pg.evaluate('S.tab') == 'day' and await pg.evaluate('S.day') == row_key)
        await pg.click('#tabs [data-tab="pattern"]')
        check('하단 탭으로 돌아오면 다시 주간 그래프', await pg.evaluate('S.pat.sub') == 'week')
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
        await pg.click('#tabs [data-tab="pattern"]'); await pg.click('[data-act="patSub"][data-k="trend"]')
        for t in ['sleep', 'rhythm', 'feed']:
            await pg.click(f'[data-act="patTrend"][data-t="{t}"]')
        check('추이 그래프 전환', await pg.query_selector('svg[aria-label="추이 그래프"]') is not None)
        await pg.click('[data-act="patSub"][data-k="goal"]')
        check('목표 vs 실제 표시', '수유 간격' in await pg.inner_text('body'))

        print('[성장 탭]')
        await pg.click('#tabs [data-tab="growth"]'); await pg.wait_for_timeout(150)
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
        await pg.click('[data-act="grSub"][data-k="health"]')
        await pg.click('[data-act="grVax"][data-k="HepB1"]'); await pg.fill('#vd', await pg.evaluate("set('birthDate')")); await pg.click('#save')
        check('접종 체크 → 완료 표시', await pg.evaluate("schedInfo(vaxList().find(x=>x.k==='HepB1'), doneMap('vax')).st") == 'done')
        await pg.click('[data-act="grVax"][data-k="DTaP2"]'); await pg.fill('#vd', await pg.evaluate("addDays(dkey(Date.now()),1)")); await pg.click('#save')
        check('미래 날짜 접종은 저장 안 됨', await pg.query_selector('#vd') is not None)
        await pg.evaluate('closeSheet()')
        await pg.click('[data-act="grMore"][data-k="vaxAll"]')
        await pg.focus('select[data-set="rvType"]'); await pg.select_option('select[data-set="rvType"]', '로타릭스'); await pg.wait_for_timeout(200)
        check('로타릭스 고르면 화면에서 바로 로타 3차가 사라짐', await pg.locator('[data-act="grVax"][data-k="RV3"]').count() == 0 and await pg.locator('[data-act="grVax"][data-k="RV2"]').count() == 1)
        hep = await pg.evaluate("""()=>{ const it=vaxList().find(x=>x.k==='HepA2'); const d=new Map([['HepA1',{start:at(addMonths(set('birthDate'),12),'12:00')}]]); d.get('HepA1')._dk=undefined;
            const s=schedInfo(it, new Map([['HepA1', Object.assign({id:'x',type:'vax'}, d.get('HepA1'))]])); return [s.start, addMonths(addMonths(set('birthDate'),12),6)]; }""")
        check('A형간염 2차는 1차 6개월 뒤부터', hep[0] == hep[1], hep)
        await pg.evaluate("addRec({type:'vax',start:at(set('birthDate'),'12:00'),d1:'HepB1',by:'아내'})")
        await pg.click('[data-act="grVax"][data-k="HepB1"]')
        has_dup = await pg.query_selector('#dedup') is not None
        if has_dup: await pg.click('#dedup')
        check('두 기기에서 같은 접종 기록 → 중복 정리', has_dup and await pg.evaluate("dupsOf('vax','HepB1').length") == 1)
        await pg.select_option('select[data-set="rvType"]', ''); await pg.wait_for_timeout(150)
        await pg.click('[data-act="grHealth"][data-k="check"]')
        await pg.click('[data-act="grCheck"][data-k="C1"]'); await pg.fill('#kd', await pg.evaluate("addDays(set('birthDate'),20)"))
        await pg.fill('#kw', '4.2'); await pg.fill('#kc', '53.5'); await pg.click('#save')
        check('검진에 키·몸무게 넣으면 성장 기록도 생김', await pg.evaluate("doneMap('checkup').has('C1') && byType('growth').some(r=>Number(r.value)===4.2 && r.d1==='53.5')"))
        await pg.click('[data-act="grHealth"][data-k="hosp"]'); await pg.click('button.chip[data-act="grHosp"]')
        await pg.click('.sheet [data-r="감기"]'); await pg.fill('#hn', '<b>소아과</b>'); await pg.click('#save')
        check('병원 기록 + 입력값 안전 표시(태그가 실행되지 않음)', await pg.locator('#app b:text("소아과")').count() == 0 and '<b>소아과</b>' in await pg.inner_text('#app'))
        await pg.click('[data-act="grSub"][data-k="dev"]')
        await pg.click('[data-act="grDev"][data-k="ms"]'); await pg.click('button[data-act="grMs"]:not([data-id])')
        await pg.click('.sheet [data-m="뒤집기"]'); await pg.click('#save')
        check('발달 기록', await pg.evaluate("byType('milestone').some(r=>r.d1==='뒤집기')"))
        await pg.click('[data-act="grMsQuick"][data-m="옹알이"]')
        await pg.evaluate("ACTIONS.grMsQuick({dataset:{m:'옹알이'}})")
        check('다음에 기대돼요: 누르면 오늘 날짜로 한 번만 기록', await pg.evaluate("byType('milestone').filter(r=>r.d1==='옹알이' && dk(r)===dkey(Date.now())).length") == 1)
        await pg.evaluate("addRec({type:'food',start:Date.now()-86400000,d1:'쌀미음, 애호박',value:10,d2:'g',d3:'발진'})")
        await pg.click('[data-act="grDev"][data-k="food"]')
        ft = await pg.inner_text('.ttable')
        check('이유식 재료별 표 + 반응 표시', '애호박' in ft and '쌀미음' in ft and '발진' in ft, ft)
        await pg.click('[data-act="grSub"][data-k="anni"]')
        await pg.click('.card [data-act="grAnni"].chip'); await pg.fill('#an', '첫 외출'); await pg.fill('#ad', await pg.evaluate("addDays(dkey(Date.now()),-5)")); await pg.click('#save')
        await pg.wait_for_timeout(100)
        check('지난 날짜 기념일도 목록에 보이고 다시 열 수 있음', await pg.locator('button.item[data-act="grAnni"]:has-text("첫 외출")').count() == 1)
        await pg.click('[data-act="grReport"]'); await pg.wait_for_timeout(150)
        check('월간 리포트 열림', '리포트' in await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-m="-1"]'); await pg.wait_for_timeout(150)
        check('지난달 리포트에서 한 달 더 이전으로 이동', await pg.evaluate("GR.month") == await pg.evaluate("prevMonth(prevMonth(dkey(Date.now()).slice(0,7)))"))
        await pg.click('.sheet #close')
        await pg.click('[data-act="grReport"]'); await pg.evaluate("GR.month=prevMonth(prevMonth(dkey(Date.now()).slice(0,7)))")
        await pg.evaluate("closeSheet(); GR.month=null; growthSheet(null)")
        await pg.evaluate("loadMonth(prevMonth(prevMonth(dkey(Date.now()).slice(0,7))))"); await pg.wait_for_timeout(900)
        check('리포트를 닫고 연 다른 창은 리포트로 바뀌지 않음', await pg.query_selector('#gw') is not None)
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
        await pg.click('#tabs [data-tab="growth"]'); await pg.click('[data-act="grSub"][data-k="anni"]'); await pg.wait_for_timeout(200)
        ms = await tap_ms(pg, '[data-act="grReport"]')
        check(f'월간 리포트 열기 {ms:.0f}ms (기준 200ms)', ms < 200, f'{ms:.0f}ms')
        ms = await tap_ms(pg, '.sheet [data-m="-1"]')
        check(f'리포트 지난달 이동 {ms:.0f}ms (기준 200ms)', ms < 200, f'{ms:.0f}ms')
        await pg.evaluate('closeSheet()')
        await pg.click('#tabs [data-tab="home"]'); await pg.click('.gear'); await pg.wait_for_timeout(300)
        ms = await tap_ms(pg, '[data-act="look"][data-v="jua"]')
        check(f'글씨체 누르면 바로 표시 {ms:.0f}ms (기준 200ms)', ms < 200, f'{ms:.0f}ms')
        await pg.wait_for_timeout(400)
        ms = await pg.evaluate("""()=>new Promise(res=>{const t0=performance.now(); document.querySelector('[data-act="look"][data-v="gaegu"]').click();
          const chk=()=>{ if(getComputedStyle(document.body).fontFamily.includes('Gaegu')) requestAnimationFrame(()=>requestAnimationFrame(()=>res(performance.now()-t0))); else setTimeout(chk,5); }; chk(); })""")
        check(f'글씨체가 화면 전체에 적용되기까지 {ms:.0f}ms (기준 500ms, 저사양 6배 느림)', ms < 500, f'{ms:.0f}ms')
        await pg.wait_for_timeout(400)
        ms = await tap_ms(pg, '[data-act="look"][data-v="dark"]')
        check(f'테마 바꾸기 {ms:.0f}ms (기준 200ms)', ms < 200, f'{ms:.0f}ms')
        await pg.click('[data-act="look"][data-v="pretendard"]'); await pg.click('[data-act="look"][data-v="lavender"]')
        await pg.click('#tabs [data-tab="home"]'); await pg.wait_for_timeout(200)
        # 뒤에서 다시 그리기가 일어나는 순간에 누른 버튼도 동작하는지
        await pg.evaluate("setTimeout(()=>bgRender(), 30)")
        await pg.click('[data-act="feed"]'); await pg.wait_for_timeout(500)
        check('뒤에서 화면 갱신 중 누른 버튼도 동작', await pg.query_selector('.sheet') is not None)
        await pg.evaluate('closeSheet()')
        await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})

        leaked = await pg.evaluate("JSON.parse(localStorage.demoDB).recs.filter(r=>'_dk' in r||'_dks' in r||'_local' in r||'_nk' in r).length")
        check('서버로 보내는 기록에 내부 표시값 없음', leaked == 0, leaked)
        await pg.click('[data-act="tab"][data-tab="home"]'); await pg.click('.gear[data-tab="settings"]')
        check('설정에 서버 버전 표시', '버전 6 최신' in await pg.inner_text('#app'))

        print('[디자인]')
        await pg.click('[data-act="look"][data-v="dark"]'); await pg.click('[data-act="look"][data-v="gaegu"]')
        await pg.reload(); await pg.wait_for_selector('.hero')
        check('테마·글씨체는 이 휴대폰에 저장(새로고침해도 유지)', await pg.evaluate("document.documentElement.dataset.theme") == 'dark' and 'Gaegu' in await pg.evaluate("getComputedStyle(document.body).fontFamily"))
        check('테마는 서버로 안 보냄', 'dark' not in await pg.evaluate("JSON.stringify(JSON.parse(localStorage.demoDB).settings)"))
        await pg.evaluate("LOOK.set('theme','lavender'); LOOK.set('font','pretendard'); render()")
        gid = await pg.evaluate("(()=>{ const n=Date.now(); const r=addRec({type:'feed',start:n-60000,value:120,by:'장모님'}); S.memos[dkey(n)]={text:'병원 다녀옴',by:'아내'}; render(); return r.id; })()")
        home = await pg.inner_text('#app')
        await pg.click('#tabs [data-tab="day"]'); day = await pg.inner_text('#app')
        await pg.click(f'#app [data-act="edit"][data-id="{gid}"]'); sheet = await pg.inner_text('.sheet'); await pg.evaluate('closeSheet()')
        check('누가 기록했는지 홈·하루 목록엔 안 보임', not any(n in x for n in ['장모님', '아내', '재현'] for x in [home, day]))
        check('기록을 열면 수정 창에 기록한 사람 표시', '기록한 사람 · 장모님' in sheet, sheet[:80])
        check('오늘 하루 메모는 홈 알림으로', '병원 다녀옴' in home)
        await pg.click('#tabs [data-tab="home"]'); await pg.wait_for_timeout(200)
        n_al = await pg.evaluate("document.querySelectorAll('.alert').length")
        check('알림 여러 개면 원형 시계가 줄어 한 화면 유지(110px 이상)', n_al < 2 or (await pg.evaluate("$('.ccard .clk').offsetHeight") >= 108 and await pg.evaluate("document.documentElement.scrollHeight <= innerHeight + 1 || $('.ccard .clk').offsetHeight <= 112")))
        await pg.set_viewport_size({'width': 384, 'height': 790}); await pg.evaluate("delete S.memos[dkey(Date.now())]; render()")
        one = await pg.evaluate("[document.documentElement.scrollHeight, innerHeight, $('.ccard .clk').offsetHeight, !!$('.plan'), document.querySelectorAll('.alert').length, [...document.querySelectorAll('.home > *')].map(e=>e.className.split(' ')[0]+':'+e.offsetHeight).join(' '), $('.hero').innerText.replace(/\\n/g,'|')]")
        check('384×790 남은 일정+알림 1개: 스크롤 없이 시계 130px 이상', one[0] <= one[1] + 1 and one[2] >= 130, one)
        await pg.set_viewport_size({'width': 390, 'height': 844}); await pg.evaluate("S.memos[dkey(Date.now())]={text:'병원 다녀옴',by:'아내'}; render()")
        lay = await pg.evaluate("""(()=>{const c=$('.ccard').getBoundingClientRect(), k=$('.ccard .clk').getBoundingClientRect(), l=$('.ccard .leg').getBoundingClientRect();
          const sp=$('.ccard .leg span').getBoundingClientRect(), b=$('.ccard .leg b').getBoundingClientRect();
          return {left:k.left-c.left, right:c.right-l.right, gap:b.left-sp.right}})()""")
        check('원형 시계 옆 설명: 오른쪽 여백 24px 이상, 항목명·값 사이 60px 이하', lay['right'] >= 24 and lay['gap'] <= 60, lay)
        await pg.evaluate("delete S.memos[dkey(Date.now())]; render()")
        fit = await pg.evaluate("[document.documentElement.scrollHeight, innerHeight, document.querySelectorAll('.alert').length]")
        check('홈이 한 화면에 들어옴(390×844, 알림 1개)', fit[0] <= fit[1] + 1 and fit[2] == 1, fit)
        await pg.set_viewport_size({'width': 390, 'height': 700}); await pg.evaluate('render()')
        small = await pg.evaluate("$('.ccard .clk').offsetHeight")
        await pg.set_viewport_size({'width': 390, 'height': 900}); await pg.evaluate('render()')
        big = await pg.evaluate("$('.ccard .clk').offsetHeight")
        check('화면이 길면 원형 시계가 커지고 짧으면 작아짐', big > small, (small, big))
        await pg.set_viewport_size({'width': 390, 'height': 844}); await pg.evaluate('render()')

        print('[사진 위치 맞추기]')
        png = await pg.evaluate("""(()=>{const c=document.createElement('canvas'); c.width=1600; c.height=1000; const g=c.getContext('2d');
          g.fillStyle='#78aade'; g.fillRect(0,0,1600,1000); g.fillStyle='#e62828'; g.beginPath(); g.arc(1200,350,100,0,7); g.fill(); return c.toDataURL('image/png').split(',')[1];})()""")
        pic = {'name': 'baby.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(png)}
        await pg.click('.gear')
        async with pg.expect_file_chooser() as fc: await pg.click('[data-act="photo"][data-slot="hero"]')
        await (await fc.value).set_files(pic); await pg.wait_for_selector('.crop-ov')
        fr = await pg.evaluate("(()=>{const r=document.querySelector('.crop-frame').getBoundingClientRect(); return [r.x,r.y,r.width,r.height]})()")
        check('상태 카드 사진 틀은 4:5', abs(fr[2] / fr[3] - 0.8) < 0.01, fr)
        cx, cy = fr[0] + fr[2] / 2, fr[1] + fr[3] / 2
        await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(cx - 120, cy, steps=6); await pg.mouse.up()
        await pg.click('.crop-bt .ok'); await pg.wait_for_timeout(300)
        dims = await pg.evaluate("new Promise(r=>{const i=new Image(); i.onload=()=>r([i.width,i.height]); i.src=LOOK.photo('hero');})")
        check('상태 카드 사진 320×400으로 저장, 위치 맞추기 화면 닫힘', dims == [320, 400] and await pg.evaluate("!document.querySelector('.crop-ov')"), dims)
        red = await pg.evaluate("""new Promise(r=>{const i=new Image(); i.onload=()=>{const c=document.createElement('canvas'); c.width=320; c.height=400; const g=c.getContext('2d'); g.drawImage(i,0,0);
          const d=g.getImageData(0,0,320,400).data; let n=0,sx=0; for(let y=0;y<400;y+=2) for(let x=0;x<320;x+=2){const k=(y*320+x)*4; if(d[k]>180&&d[k+1]<90){n++; sx+=x;}} r(n?sx/n/320:-1);}; i.src=LOOK.photo('hero');})""")
        check('끌어서 옮긴 위치대로 잘림(빨간 점이 오른쪽 끝 → 안쪽으로)', 0.55 < red < 0.95, red)
        old = await pg.evaluate("LOOK.photo('hero')")
        async with pg.expect_file_chooser() as fc: await pg.click('[data-act="photo"][data-slot="avatar"]')
        await (await fc.value).set_files(pic); await pg.wait_for_selector('.crop-ov')
        fr2 = await pg.evaluate("(()=>{const r=document.querySelector('.crop-frame').getBoundingClientRect(); return r.width/r.height})()")
        await pg.click('.crop-bt [data-c="0"]'); await pg.wait_for_timeout(200)
        check('프로필은 정사각형 틀, 취소하면 사진 안 바뀜', abs(fr2 - 1) < 0.01 and not await pg.evaluate("LOOK.photo('avatar')") and await pg.evaluate("LOOK.photo('hero')") == old)
        async with pg.expect_file_chooser() as fc: await pg.click('[data-act="photo"][data-slot="avatar"]')
        await (await fc.value).set_files(pic); await pg.wait_for_selector('.crop-ov')
        await pg.go_back(); await pg.wait_for_timeout(300)
        check('위치 맞추기에서 뒤로가기 = 취소(앱은 그대로 설정 화면)', await pg.evaluate("!document.querySelector('.crop-ov') && S.tab==='settings' && !LOOK.photo('avatar')"))
        await pg.evaluate("LOOK.clearPhoto('hero'); S.tab='home'; render()")

        print('[기록 지우기]')
        check('관리자 표시: 맨 위 사람만', await pg.evaluate("S.users[0].admin === true && S.users.slice(1).every(u=>!u.admin)"))
        not_admin = await pg.evaluate("DEMO.call('resetRecords',{scope:'all',pin:'2222',confirm:'지우기'},'2222').then(()=>'ok',e=>e.message)")
        check('관리자가 아니면 서버가 거절', '관리자' in not_admin, not_admin)
        await pg.evaluate("addRec({type:'growth',start:at(set('birthDate'),'12:00'),value:3.4,d1:''})"); await settle(pg)
        await pg.click('.gear'); await pg.click('[data-act="setReset"]')
        await pg.click('.sheet [data-s="daily"]'); await pg.fill('#rp', '0000'); await pg.fill('#rc', '지우기'); await pg.click('#go')
        check('PIN이 틀리면 안 지워짐', await pg.evaluate("JSON.parse(localStorage.demoDB).recs.some(r=>r.type==='feed')"))
        await pg.fill('#rp', await pg.evaluate('S.auth.pin')); await pg.click('#go')
        await pg.wait_for_function("!document.querySelector('.sheet')", timeout=5000); await pg.wait_for_timeout(1500)
        db = await pg.evaluate("JSON.parse(localStorage.demoDB)")
        G = {'growth', 'vax', 'checkup', 'hospital', 'milestone', 'anniv'}
        check('① 매일 기록만 지움: 서버에 성장 기록만 남음', len(db['recs']) > 0 and all(r['type'] in G for r in db['recs']) and not db['memos'])
        check('이 휴대폰 화면도 비워지고 성장 기록은 남음', await pg.evaluate("!live().some(r=>r.type==='feed'||r.type==='sleep') && live().some(r=>r.type==='growth') && !Object.keys(S.memos).length"))
        await pg.evaluate("(()=>{ const t=LS.get(resetKey(),0); S.queue.push({op:'add',id:'old1',rec:{id:'old1',type:'feed',start:t-60000,value:90},at:t-1000}); S.queue.push({op:'add',id:'new1',rec:{id:'new1',type:'feed',start:Date.now(),value:95},at:Date.now()}); })()")
        await settle(pg)
        ids = await pg.evaluate("JSON.parse(localStorage.demoDB).recs.map(r=>r.id)")
        check('지우기 전에 만든 늦은 기록은 버리고, 뒤에 만든 건 저장', 'old1' not in ids and 'new1' in ids, ids)
        # 검토에서 나온 경우들
        w0 = await pg.evaluate("S.wipeN")
        await pg.evaluate("seenReset(1, 'daily')"); await pg.wait_for_timeout(300)
        check('옛 reset 값이 늦게 와도 무시(두 번 지우지 않음)', await pg.evaluate("S.wipeN") == w0 and await pg.evaluate("LS.get(resetKey(),0)") > 1)
        gid = await pg.evaluate("byType('growth')[0].id")
        await pg.evaluate("(id)=>{ const t=LS.get(resetKey(),0); S.queue.push({op:'update',id,rec:{value:6.5},at:t-5000}); }", gid)
        await pg.evaluate("(id)=>updateRec(id,{value:7.1})", gid); await settle(pg)
        check('지우기 전 수정에 합쳐진 뒤의 수정도 남긴 성장 기록에 반영', await pg.evaluate("(id)=>JSON.parse(localStorage.demoDB).recs.find(r=>r.id===id).value", gid) == 7.1)
        await pg.evaluate("""(()=>{ const t=LS.get(resetKey(),0);
            S.queue.push({op:'add',id:'oldv1',rec:{id:'oldv1',type:'feed',start:t-60000,value:80,created:t-60000}});
            S.queue.push({op:'add',id:'oldv2',rec:{id:'oldv2',type:'feed',start:Date.now(),value:85,created:Date.now()}}); })()""")
        await settle(pg)
        ids = await pg.evaluate("JSON.parse(localStorage.demoDB).recs.map(r=>r.id)")
        check('옛 버전 대기 기록(at 없음): 만든 시각으로 판단', 'oldv1' not in ids and 'oldv2' in ids, ids)
        await pg.evaluate("""(()=>{ const o=DEMO.call; DEMO.call=async(a,d,p)=>{ if(a==='range'){ const r=await o(a,d,p); r.data.recs=[{id:'ghost',type:'feed',start:Date.now()-40*86400000,value:1,deleted:false}]; S.wipeN=(S.wipeN||0)+1; return r; } return o(a,d,p); }; window._r2=()=>{DEMO.call=o}; })()""")
        await pg.evaluate("S.loadedFrom=Date.now()-10*86400000; ensureRange(addDays(dkey(Date.now()),-20))"); await pg.wait_for_timeout(800)
        check('지우기 도중 도착한 옛 range 응답은 반영 안 함', not await pg.evaluate("!!S.recs.ghost"))
        await pg.evaluate("_r2()")
        r = await pg.evaluate("DEMO.call('saveUsers',{users:[{name:'아내',pin:'',active:true,oldName:'아내'},{name:'장모님',pin:'',active:true,oldName:'장모님'}]},'2222').then(j=>j.data.users.map(u=>u.name+(u.admin?'*':'')).join(','),e=>e.message)")
        check('관리자가 아닌 사람은 맨 위 관리자를 빼거나 바꿀 수 없음', r.startswith('재현*'), r)
        await pg.click('.gear'); await pg.click('[data-act="setReset"]')
        await pg.click('.sheet [data-s="all"]'); await pg.fill('#rp', await pg.evaluate('S.auth.pin')); await pg.fill('#rc', '지우기'); await pg.click('#go')
        await pg.wait_for_function("!document.querySelector('.sheet')", timeout=5000); await pg.wait_for_timeout(1500)
        check('② 전부 지움: 서버·화면 모두 비고 설정은 그대로', await pg.evaluate("JSON.parse(localStorage.demoDB).recs.length === 0 && live().length === 0 && set('feedPresets') === '105,135,150,170,200'"))
        pin_now = await pg.evaluate('S.auth.pin')
        await pg.evaluate("S.memos['2026-01-01']={text:'옛 메모',by:''}; writeCache(); logout()")
        await login(pg, pin_now); await pg.wait_for_timeout(800)
        check('다시 로그인해도 지워진 하루 메모가 되살아나지 않음', not await pg.evaluate("!!S.memos['2026-01-01']"))
        check('화면 오류 없음', not errs, errs)

        print('[4차 피드백 반영]')
        ctx2 = await b.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul', accept_downloads=True)
        p2 = await ctx2.new_page(); e2 = []
        p2.on('pageerror', lambda e: e2.append(str(e)))
        await p2.goto(BASE.replace('index.html', 'tests/'))          # 앱 밖 페이지 하나(뒤로가기 끝 확인용)
        await p2.goto(BASE + '#s=demo'); await login(p2, '2222')
        # 뒤로가기
        await p2.click('[data-act="feed"]'); await p2.wait_for_selector('#dim'); await p2.go_back(); await p2.wait_for_timeout(300)
        check('뒤로가기: 열린 창만 닫히고 앱은 그대로', not await p2.query_selector('#dim') and bool(await p2.query_selector('.hero')))
        await p2.click('#tabs [data-tab="pattern"]'); await p2.go_back(); await p2.wait_for_timeout(300)
        check('뒤로가기: 다른 탭에서는 홈으로', await p2.evaluate('S.tab') == 'home')
        await p2.click('#tabs [data-tab="day"]'); await p2.click('#app [data-act="edit"]'); await p2.wait_for_selector('#dim')
        await p2.go_back(); await p2.wait_for_timeout(300)
        check('뒤로가기: 탭 위 창은 창만 닫힘(탭 유지)', not await p2.query_selector('#dim') and await p2.evaluate('S.tab') == 'day')
        r = await p2.evaluate("(async()=>{ const pr = ask('테스트'); await new Promise(r=>setTimeout(r,80)); history.back(); return await Promise.race([pr, new Promise(r=>setTimeout(()=>r('hang'),1500))]); })()")
        check('뒤로가기로 확인 창을 닫으면 취소로 처리', r is False, r)
        # 버튼으로 창을 닫으면 남은 뒤로가기 칸을 꺼냄(폰 앱은 이전 페이지가 없어서, 남아 있으면 홈에서 두 번 눌러야 꺼짐)
        await p2.click('#tabs [data-tab="home"]'); await p2.wait_for_timeout(200)
        h0 = await p2.evaluate('history.length')
        await p2.click('[data-act="feed"]'); await p2.wait_for_selector('#dim'); await p2.click('.sheet .primary'); await p2.wait_for_timeout(400)
        check('버튼으로 창 닫은 뒤 홈: 남은 뒤로가기 칸 없음(한 번에 앱 종료)', await p2.evaluate("backArmed === 0 && !(history.state && history.state.bg)"), await p2.evaluate("[backArmed, history.state]"))
        await p2.evaluate('closeToast()')
        # 탭 + 창: 뒤로가기 처리 중에는 칸을 새로 쌓지 않음(크롬이 터치 없이 쌓은 칸은 건너뛸 수 있어서)
        await p2.click('#tabs [data-tab="day"]'); await p2.click('#app [data-act="edit"]'); await p2.wait_for_selector('#dim'); await p2.wait_for_timeout(100)
        a2 = await p2.evaluate('[backArmed, history.length]')
        await p2.go_back(); await p2.wait_for_timeout(300)
        a1 = await p2.evaluate('[backArmed, history.length, S.tab, !!document.getElementById("dim")]')
        await p2.go_back(); await p2.wait_for_timeout(300)
        a0 = await p2.evaluate('[backArmed, S.tab]')
        check('탭+창: 칸 2개 → 뒤로(창 닫힘, 칸 1개·새로 안 쌓음) → 뒤로(홈, 칸 0개)', a2[0] == 2 and a1[0] == 1 and a1[1] == a2[1] and a1[2] == 'day' and not a1[3] and a0 == [0, 'home'], [a2, a1, a0])
        # 분유 양 범위
        fid = await p2.evaluate("live().filter(r=>r.type==='feed').pop().id")
        await p2.evaluate(f"editSheet('{fid}')"); await p2.fill('#ev', '99999'); await p2.click('#save'); await p2.wait_for_timeout(200)
        v1 = await p2.evaluate(f"S.recs['{fid}'].value")
        await p2.fill('#ev', '400'); await p2.click('#save'); await p2.wait_for_timeout(200)
        check('수정 창 분유 양 5~400ml만 저장', str(v1) != '99999' and await p2.evaluate(f"S.recs['{fid}'].value") == 400, v1)
        # 지금 할 일 한 줄
        tl = await p2.evaluate("""(()=>{ const n=Date.now(), M=60000;
          return [todoLine({next:'낮잠2',pred:n+60*M,feedInfo:{pred:n+10*M}}), todoLine({next:'낮잠2',pred:n-5*M,feedInfo:{pred:n-1*M}}),
                  todoLine({next:'밤잠',pred:n+90*M,feedInfo:{pred:n+120*M}}), todoLine({next:'낮잠3',pred:n+8*M,feedInfo:{pred:n+12*M}})]; })()""")
        check('한 줄 안내: 15분 안이면 "곧 분유 시간이에요"', '곧 분유 시간이에요' in tl[0], tl[0])
        check('한 줄 안내: 둘 다 지나면 "낮잠·분유 시간이 지났어요"', '낮잠·분유 시간이 지났어요' in tl[1], tl[1])
        check('한 줄 안내: 여유 있으면 "다음은 밤잠 · 시각쯤"', '다음은 밤잠 ·' in tl[2], tl[2])
        check('한 줄 안내: 둘 다 곧이면 함께', '곧 낮잠·분유 시간이에요' in tl[3], tl[3])
        # 다음 수유 이름(가까운 일정표 수유)
        fl = await p2.evaluate("""(()=>{ const k=dkey(Date.now()), P=planFor(k);
          return ['16:50','17:46','19:00','22:40'].map(t=>feedLabelFor(P,k,at(k,t)).label); })()""")
        check('다음 수유 이름은 시각 기준(17:46→수유4, 19:00→막수, 22:40→수유)', fl == ['수유4', '수유4', '막수', '수유'], fl)
        # 토막잠
        cn = await p2.evaluate("[countsAsNap({start:0,end:10*60000}), countsAsNap({start:0,end:25*60000}), countsAsNap({start:0,end:null})]")
        check('20분 미만 낮잠은 몇 번째 낮잠 셀 때 뺌', cn == [False, True, True], cn)
        st = await p2.evaluate("""(()=>{ const k=dkey(Date.now()), P=planFor(k), now=Date.now();
          const save = S.recs; S.recs = {}; dirty();
          const add = (o, i) => { S.recs['t'+i] = Object.assign({id:'t'+i,value:null,d1:'',d2:'',d3:'',memo:'',by:'',created:now,updated:now,deleted:false}, o); };
          // 아침 기상 + 낮잠을 일정표보다 2번 더(모두 25분), 마지막 낮잠 직후
          add({type:'sleep',kind:'밤',start:now-12*3600000,end:now-11*3600000}, 0);
          const n = P.naps.length + 2; for (let i=0;i<n;i++) add({type:'sleep',kind:'낮',start:now-(11-i)*3600000+600000,end:now-(11-i)*3600000+600000+25*60000}, i+1);
          dirty(); const s = statusInfo(); S.recs = save; dirty(); return [s.mode, s.next, Math.round(s.target), P.raw.bed]; })()""")
        check('일정보다 낮잠이 많아도 무리한 깨시 목표 안 냄(추가 낮잠 또는 밤잠)', st[0] != 'awake' or st[1] in ('추가 낮잠', '밤잠') and st[2] < 4 * 60, st)
        # 오늘 남은 일정: 실제 기록에서 이어서 계산(11/6 실제 사례: 7시 기상, 전체가 늦어져 16:08 낮잠3 깸, 16:55 수유, 지금 17:28)
        fc = await p2.evaluate("""(()=>{ const realNow = Date.now, k = dkey(realNow()), T = (h,m) => at(k, `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
          const save = S.recs; S.recs = {}; let i = 0;
          const add = (o) => { const id='fc'+(i++); S.recs[id] = Object.assign({id,value:null,d1:'',d2:'',d3:'',memo:'',by:'',created:0,updated:0,deleted:false,end:null,kind:''}, o); };
          add({type:'sleep',kind:'밤',start:T(0,0)-4*3600000,end:T(7,0)});
          add({type:'feed',start:T(8,10),value:150}); add({type:'sleep',kind:'낮',start:T(9,40),end:T(10,40)});
          add({type:'feed',start:T(11,20),value:150}); add({type:'sleep',kind:'낮',start:T(12,20),end:T(13,50)});
          add({type:'feed',start:T(14,0),value:150}); add({type:'sleep',kind:'낮',start:T(15,25),end:T(16,8)});
          add({type:'feed',start:T(16,55),value:170});
          dirty(); Date.now = () => T(17,28);
          let r; try { const st = statusInfo(); const it = planItems(st); r = { next: st.next, pred: hm(st.pred), items: it.map(o => `${hm(o.t)} ${o.n}`), bed: hm(dayForecast(st).bed) }; }
          finally { Date.now = realNow; S.recs = save; dirty(); }
          return r; })()""")
        it = fc['items']; names = [x.split(' ', 1)[1] for x in it]
        bi = names.index('밤잠') if '밤잠' in names else -1
        check('남은 일정: 밤잠 뒤에 수유·낮잠 없음, 막수는 밤잠 바로 앞', bi == len(names) - 1 and names[bi - 1] == '막수', it)
        check('남은 일정: 낮잠4는 실제 깬 시각+깨시(17:53), 밤잠은 깨시대로 밀되 일정표+30분(20:10) 안', it[0].startswith('17:53 낮잠4') and fc['bed'] == '20:10', fc)
        check('남은 일정: 목욕·막수가 밤잠을 따라 움직임(19:30 목욕, 19:50 막수)', '19:30 목욕' in it and '19:50 막수' in it, it)
        # 독립 검토에서 나온 경계 상황들(Date.now 고정)
        ed = await p2.evaluate("""(()=>{ const realNow = Date.now, k = dkey(realNow()), T = (h,m) => at(k, `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
          const save = S.recs, savePF = planFor, out = {};
          const run = (recs, now, pf) => { S.recs = {}; recs.forEach((o,i) => { S.recs['e'+i] = Object.assign({id:'e'+i,value:null,d1:'',d2:'',d3:'',memo:'',by:'',created:0,updated:0,deleted:false,end:null,kind:''}, o); });
            dirty(); Date.now = () => now; if (pf) planFor = pf;
            try { const st = statusInfo(); return { st, items: planItems(st).map(o => `${hm(o.t)} ${o.n}`), todo: st.mode === 'awake' ? todoLine(st).replace(/<[^>]+>/g,'') : '' }; }
            finally { Date.now = realNow; planFor = savePF; } };
          const night = {type:'sleep',kind:'밤',start:T(0,0)-4*3600000,end:T(7,0)};
          try {
            // A: 낮잠3 예정(14:45)이 지났는데 아직 안 잠, 16:45 → 낮잠4는 지금부터 계산(16:45+40분+깨시)
            let r = run([night,{type:'sleep',kind:'낮',start:T(8,45),end:T(9,45)},{type:'sleep',kind:'낮',start:T(11,30),end:T(13,0)},{type:'feed',start:T(15,0),value:150}], T(16,45));
            out.A = r.items;
            // B: 낮잠1을 08:45부터 11:40까지 자는 중 → 낮잠2가 사라지지 않고 지금 기준으로
            r = run([night,{type:'sleep',kind:'낮',start:T(8,45)}], T(11,40)); out.B = r.items;
            // C: 낮잠을 늦게까지 자서 다음 낮잠이 목욕 전에 못 끝남 → 상태 카드도 밤잠
            r = run([night,{type:'sleep',kind:'낮',start:T(8,45),end:T(9,45)},{type:'sleep',kind:'낮',start:T(16,0),end:T(18,0)},{type:'feed',start:T(17,0),value:150}], T(18,10));
            out.C = [r.st.next, r.items, r.todo];
            // D: 막수로 합쳐진 수유 → 한 줄 안내도 막수 기준(18:55, 마지막 수유 16:00)
            r = run([night,{type:'sleep',kind:'낮',start:T(16,40),end:T(17,50)},{type:'feed',start:T(16,0),value:150}], T(18,55)); out.D = [r.items, r.todo];
            // H: 막수(19:25) 뒤 19:50에 한 번 더 먹임, 아직 안 잠 → 지난 시각 막수가 다시 뜨지 않음
            r = run([night,{type:'sleep',kind:'낮',start:T(17,10),end:T(17,50)},{type:'bath',start:T(19,0)},{type:'feed',start:T(19,25),value:200},{type:'feed',start:T(19,50),value:100}], T(19,51)); out.H = [r.items, r.todo];
            // E: 밤잠 기록을 빠뜨린 다음 날 아침(어제 17:50 낮잠이 마지막) → 일정표 시각
            r = run([{type:'sleep',kind:'낮',start:T(17,10)-86400000,end:T(17,50)-86400000}], T(7,30)); out.E = r.items;
            // F: 수유 간격 −30으로 저장돼도 멈추지 않음
            const P0 = savePF(k); const bad = planInfo(Object.assign({}, P0.raw, {feedInterval: -30}), 'x');
            const t0 = realNow(); r = run([night,{type:'feed',start:T(16,0),value:150}], T(16,30), () => bad); out.F = [realNow() - t0 < 2000, r.items.length];
            // G: 일정표에 밤잠 뒤 꿈수(22:30)가 있어도 밤잠 뒤 수유 없음
            const dream = planInfo(Object.assign({}, P0.raw, {feeds: [['07:20','수유1'],['13:20','수유3'],['16:20','수유4'],['22:30','꿈수']]}), 'y');
            r = run([night,{type:'sleep',kind:'낮',start:T(14,45),end:T(15,25)},{type:'feed',start:T(16,20),value:150}], T(16,30), () => dream); out.G = r.items;
          } finally { S.recs = save; dirty(); }
          return out; })()""")
        A = ed['A']; check('경계A: 지난 낮잠3을 아직 안 잤으면 낮잠4는 지금부터 계산', A[0].endswith('낮잠3') and any('낮잠4' in x and x[:5] >= '17:25' for x in A) or not any('낮잠4' in x for x in A), A)
        check('경계B: 낮잠1이 길어져도 낮잠2가 사라지지 않음', any('낮잠2' in x for x in ed['B']), ed['B'])
        C = ed['C']; check('경계C: 목욕 전에 못 끝날 낮잠은 빼고 상태 카드도 밤잠', C[0] == '밤잠' and not any('낮잠' in x for x in C[1]), C)
        D = ed['D']; check('경계D: 한 줄 안내와 남은 일정이 같은 수유 예측(막수로 합침)', not any(x.endswith(' 수유') for x in D[0]) and ('분유 시간이 지났어요' not in D[1]), D)
        check('경계H: 막수 뒤 추가 수유해도 지난 막수·"분유 시간 지났어요"가 다시 안 뜸', not any('막수' in x for x in ed['H'][0]) and '분유' not in ed['H'][1], ed['H'])
        check('경계E: 밤잠 기록이 빠진 아침엔 일정표 시각으로 낮잠 표시', any('08:45 낮잠1' == x for x in ed['E']), ed['E'])
        check('경계F: 수유 간격이 이상한 값이어도 멈추지 않음', ed['F'][0] and ed['F'][1] < 30, ed['F'])
        G = ed['G']; bi = [x.split(' ',1)[1] for x in G].index('밤잠'); check('경계G: 밤잠 뒤 일정표 수유(꿈수)는 남은 일정에 없음', bi == len(G) - 1, G)
        # 홈 '약' 빠른 기록(1차부터 있던 오류: 창을 닫은 뒤 양 칸을 읽어 저장 실패)
        await p2.click('#tabs [data-tab="home"]'); m0 = await p2.evaluate("live().filter(r=>r.type==='med').length")
        await p2.click('[data-act="med"]'); await p2.fill('#mn', '해열제'); await p2.fill('#ma', '2.5ml'); await p2.click('#save'); await confirm_if_asked(p2)
        mr = await p2.evaluate("(()=>{ const l=live().filter(r=>r.type==='med'); return [l.length, l.length ? l[l.length-1].d1 : '', l.length ? l[l.length-1].d2 : '']; })()")
        check('홈 약 기록 저장(이름·양)', mr == [m0 + 1, '해열제', '2.5ml'], mr)
        await p2.evaluate('closeToast()')
        # 저장 안내
        await p2.click('#tabs [data-tab="home"]'); await p2.click('[data-act="feed"]'); await p2.click('.sheet .primary'); await p2.wait_for_selector('#toast')
        tt = await p2.inner_text('#toast')
        check('저장 안내: "저장됐어요" + 기록 내용·시각', '저장됐어요' in tt and '분유' in tt and 'ml' in tt, tt)
        await p2.wait_for_timeout(5300)
        check('저장 안내 5초 뒤 닫히고 마지막 기록 칸에 "방금 저장"', not await p2.query_selector('#toast') and bool(await p2.query_selector('.card.last.just')) and '방금 저장' in await p2.inner_text('.card.last'))
        # 하루 요약 공유(공유 창 없는 환경 → 이미지 저장)
        await p2.click('#tabs [data-tab="day"]')
        async with p2.expect_download(timeout=8000) as dl:
            await p2.click('[data-act="shareDay"]')
        d = await dl.value
        check('하루 요약 이미지 만들기(공유 창 없으면 저장)', d.suggested_filename.endswith('.png'), d.suggested_filename)
        # 병원용 리포트
        await p2.click('#tabs [data-tab="growth"]'); await p2.click('[data-act="grSub"][data-k="health"]'); await p2.click('[data-act="grHospRep"]')
        await p2.wait_for_selector('.sheet.hosp')
        n7 = await p2.evaluate("document.querySelectorAll('.sheet.hosp .htbl tbody tr').length")
        ok = await p2.evaluate("""(()=>{ const k=addDays(dkey(Date.now()),-1), s=daySummary(k), tr=[...document.querySelectorAll('.sheet.hosp .htbl tbody tr')].pop();
          return tr.children[1].textContent.trim() === `${s.feedN}회 / ${s.feedMl}ml` || (!hasData(k)); })()""")
        await p2.click('.sheet.hosp [data-hn="14"]')
        n14 = await p2.evaluate("document.querySelectorAll('.sheet.hosp .htbl tbody tr').length")
        check('병원용 리포트: 7일·14일 표, 어제 값이 하루 합계와 같음', n7 == 7 and n14 == 14 and ok, [n7, n14, ok])
        await p2.go_back(); await p2.wait_for_timeout(300)
        check('병원용 리포트도 뒤로가기로 닫힘', not await p2.query_selector('#dim') and await p2.evaluate('S.tab') == 'growth')
        await p2.click('#tabs [data-tab="home"]'); await p2.wait_for_timeout(300); await p2.go_back(); await p2.wait_for_timeout(500)
        check('홈에서 뒤로가기는 앱 종료(이전 페이지로)', '/tests/' in p2.url, p2.url)
        check('화면 오류 없음(4차)', not e2, e2)

        print('[5차: 출시 심사 반영]')
        ctx5 = await b.new_context(viewport={'width': 390, 'height': 844}); p5 = await ctx5.new_page(); e5 = []
        p5.on('pageerror', lambda e: e5.append(str(e)))
        await p5.goto(BASE + '#s=demo'); await login(p5)
        ev = lambda js: p5.evaluate(js)
        # 바뀐 칸만 보내기
        fid = await ev("addRec({type:'feed',start:Date.now()-40*MIN,value:120}).id")
        await settle(p5)
        await p5.evaluate(f"editSheet('{fid}')")
        await ev(f"S.recs['{fid}'] = Object.assign({{}}, S.recs['{fid}'], {{memo:'아내가 쓴 메모'}})")   # 창을 연 사이 다른 가족이 메모를 고쳐 동기화됨
        await p5.fill('#ev', '140'); await p5.click('#save'); await p5.wait_for_timeout(200)
        q = await ev(f"JSON.stringify(S.queue.filter(o=>o.id==='{fid}').map(o=>o.rec))")
        check('수정 창은 바꾼 칸(양)만 보냄 → 다른 가족이 고친 메모 유지', '140' in q and 'memo' not in q and 'start' not in q and await ev(f"S.recs['{fid}'].memo") == '아내가 쓴 메모', q)
        await settle(p5)
        await p5.click('#tabs [data-tab="day"]'); await p5.fill('#daymemo', '테스트 메모'); await p5.evaluate("$('#daymemo').blur()"); await p5.wait_for_timeout(200)
        check('하루 메모는 마지막으로 본 내용(base)을 함께 보냄', await ev("S.queue.some(o=>o.op==='memo' && 'base' in o)"))
        await settle(p5); await p5.click('#tabs [data-tab="home"]')
        # 주의 카드
        await ev("addRec({type:'temp',start:Date.now()-20*MIN,value:38.4})")
        t = await ev("[...document.querySelectorAll('.caution.bad')].map(e=>e.innerText).join('|')")
        check('고열 기록 → 홈 상태 카드 아래 빨간 주의 카드', '38.4' in t, t)
        await ev("addRec({type:'temp',start:Date.now()-5*MIN,value:36.9})")
        check('다시 재서 정상이면 주의 카드 사라짐', '℃' not in await ev("[...document.querySelectorAll('.caution')].map(e=>e.innerText).join('|')"))
        await ev("addRec({type:'diaper',start:Date.now()-2*HOUR,d1:'대변',d2:'흰색·회색'})")
        check('흰색·회색 변 → 소아과 상담 주의 카드', '소아과' in await ev("$('.caution.bad') ? $('.caution.bad').innerText : ''"))
        # 중복 기록
        # 데모 기록과 앞 테스트 기록이 시각상 우연히 겹친 쌍은 미리 '둘 다 맞아요' 처리(시각 의존 방지)
        await ev("LS.set('dupOk', dupPairs().map(x=>x[2])); render()")
        await ev("addRec({type:'feed',start:Date.now()-2*MIN,value:150,by:'아내'}); addRec({type:'feed',start:Date.now()-MIN,value:150,by:'재현'})")
        check('다른 가족이 3분 안에 같은 분유 → 중복 안내', await ev("!!$('.caution.dup')"))
        n0 = await ev("live().filter(r=>r.type==='feed').length")
        await p5.click('.caution.dup [data-act="dupDel"]'); await p5.wait_for_timeout(150)
        check('"하나 지우기" → 늦게 만든 기록 하나만 지움', await ev("live().filter(r=>r.type==='feed').length") == n0 - 1 and not await ev("!!$('.caution.dup')"))
        await ev("addRec({type:'diaper',start:Date.now()-MIN,d1:'소변',by:'아내'}); addRec({type:'diaper',start:Date.now(),d1:'소변',by:'장모님'})")
        await p5.click('.caution.dup [data-act="dupOk"]'); await p5.wait_for_timeout(150)
        check('"둘 다 맞아요" → 안내 사라지고 다시 안 뜸', not await ev("!!$('.caution.dup')"))
        # 체온 빠른 입력
        await p5.click('[data-act="temp"]'); await p5.click('.chips.tq [data-v="38.5"]')
        check('체온: 38.5 칩 한 번에 입력', '38.5' in await p5.inner_text('#tv')); await ev('closeSheet()')
        # 상태 카드 구분·단위·잊은 깸
        await ev("addRec({type:'sleep',start:Date.now()-200*MIN,kind:'낮'}); render()")
        hc = await ev("$('.hero').className + '|' + $('.hero').innerText")
        check('낮잠 중 상태 카드는 별도 색(m-nap)', 'm-nap' in hc, hc[:60])
        check('시간 단위 표시(3시간 20분)', '3시간' in hc and '분' in hc, hc)
        check('너무 오래 자는 중 → "깬 기록 잊으셨나요" + 깬 시각 입력 버튼', '잊으셨나요' in hc and await ev("!!$('.hero .fixb[data-act=\"edit\"]')"))
        await ev("S.recs[openSleep().id].deleted = true; dirty(); render()")
        # 새벽 깸 → 아침 기상
        r5 = await ev("""(()=>{ const real=Date.now, k=dkey(real()), t=at(k,'05:10'); Date.now=()=>t;
          try { Object.values(S.recs).forEach(r=>{ if(r.type==='sleep' && r.start>at(addDays(k,-1),'12:00')) r.deleted=true; }); dirty();
            const r=addRec({type:'sleep',start:at(addDays(k,-1),'19:30'),end:at(k,'05:05'),kind:'밤'});
            const m1=statusInfo().mode; render(); const btn=!!$('.hero [data-act="morningWake"]');
            updateRec(r.id,{d1:'기상'}); const m2=statusInfo().mode; r.deleted=true; dirty();
            Date.now=()=>at(k,'09:00'); const nn=statusCard(statusInfo()).includes('어젯밤 잠 기록이 없어요');
            return [m1,btn,m2,nn]; } finally { Date.now=real; dirty(); render(); } })()""")
        check('새벽 5시 깸은 밤중깸 + "아침 기상이에요" 버튼', r5[0] == 'nightwake' and r5[1], r5)
        check('"아침 기상이에요" → 깸 상태로 오늘 일정 계산', r5[2] == 'awake', r5)
        check('어젯밤 잠 기록이 없으면 "밤잠 넣기" 안내', r5[3], r5)
        # 저장 실패·잠금
        lf = await ev("""(()=>{ const o=Storage.prototype.setItem; Storage.prototype.setItem=()=>{throw new Error('full')};
          LS.set('x',1); render(); const t=document.body.innerText.includes('이 휴대폰에 저장이 안 되고'); Storage.prototype.setItem=o; LS.set('x',1); render();
          return [t, document.body.innerText.includes('이 휴대폰에 저장이 안 되고')]; })()""")
        check('휴대폰 저장 실패 → 빨간 안내, 다시 되면 사라짐', lf == [True, False], lf)
        check('서버 잠금(locked)은 로그아웃 사유가 아님', await ev("!isAuthErr({code:'locked', pinUsed:S.auth.pin})"))
        check('화면 오류 없음(5차)', not e5, e5)

        print('[6차: 일정 탭]')
        await p5.click('#tabs [data-tab="cal"]'); await p5.wait_for_timeout(200)
        check('하단에 일정 탭(홈·하루·일정·패턴·성장)', await ev("[...document.querySelectorAll('#tabs button')].map(b=>b.innerText.trim()).join(',')") == '홈,하루,일정,패턴,성장')
        today = await ev("dkey(Date.now())")
        check('오늘 칸 표시 · 이번 달 제목', await ev(f"!!$('.cd.today[data-k=\"{today}\"]')") and await ev("$('.cal-top h2').innerText") == f"{int(today[:4])}년 {int(today[5:7])}월")
        b100 = await ev("addDays(birthKey(), 99)"); b200 = await ev("addDays(birthKey(), 199)")
        await ev(f"CAL.m='{b100[:7]}'; CAL.sel='{b100}'; render()")
        check('100일이 달력에 자동 표시', '100일' in await ev(f"$('.cd[data-k=\"{b100}\"]').innerText"))
        # 일정 추가(미래 날짜) → 달력·다가오는 일정·홈 알림
        tmr = await ev("addDays(dkey(Date.now()),1)")
        await ev(f"CAL.m='{tmr[:7]}'; CAL.sel='{tmr}'; render()")
        await p5.click('.fab'); await p5.fill('#ct', '소아과 진료'); await p5.fill('#ctm', '10:30')
        await p5.click('#ccat [data-c="검진"]'); await p5.click('#save'); await p5.wait_for_timeout(200)
        er = await ev("JSON.stringify(live().filter(r=>r.type==='event').map(r=>[r.d1,r.d2,hm(r.start),dk(r)]))")
        check('일정 추가: 제목·분류·시간·날짜 저장', f'["소아과 진료","검진","10:30","{tmr}"]' in er, er)
        check('달력 칸·다가오는 일정에 보임', '소아과' in await ev(f"$('.cd[data-k=\"{tmr}\"]').innerText") and '소아과 진료' in await p5.inner_text('.calv'))
        await p5.click('#tabs [data-tab="home"]'); await p5.wait_for_timeout(200)
        check('홈 알림: 내일 일정', '내일 10:30 소아과 진료' in await p5.inner_text('#app'))
        check('일정은 홈 마지막 기록·하루 목록에 안 섞임', '소아과' not in await ev("$('.card.last') ? $('.card.last').innerText : ''"))
        await p5.click('.alert[data-k^="cal:"]'); await p5.wait_for_timeout(200)
        check('홈 알림 누르면 그 날짜의 일정 탭', await ev("S.tab") == 'cal' and await ev("CAL.sel") == tmr)
        # 수정·종일·삭제
        await p5.click('.dl .it[data-act="calEdit"]'); await p5.click('#call'); await p5.fill('#ct', '소아과 검진'); await p5.click('#save'); await p5.wait_for_timeout(200)
        e1 = await ev("JSON.stringify(live().filter(r=>r.type==='event').map(r=>[r.d1,r.d3,hm(r.start)]))")
        check('일정 수정(종일로)', '["소아과 검진","종일","00:00"]' in e1, e1)
        check('종일 일정은 시간 대신 "종일"', '종일' in await p5.inner_text('.dl'))
        await p5.click('.dl .it[data-act="calEdit"]'); await p5.click('#del'); await confirm_if_asked(p5); await p5.wait_for_timeout(200)
        check('일정 삭제', await ev("live().filter(r=>r.type==='event').length") == 0)
        # 달 넘기기·오늘
        await p5.click('[data-act="calMonth"][data-d="1"]'); await p5.click('[data-act="calMonth"][data-d="1"]')
        check('다음 달로 넘기면 "오늘" 버튼', await ev("!!$('[data-act=\"calToday\"]')"))
        await p5.click('[data-act="calToday"]')
        check('"오늘" 누르면 이번 달', await ev("CAL.m") == today[:7])
        await p5.go_back(); await p5.wait_for_timeout(300)
        check('일정 탭에서 뒤로가기 → 홈', await ev("S.tab") == 'home')
        await ev("S.tab='cal'; render()")
        tl = await ev("performance.now()"); await ev("render()"); tl = await ev(f"performance.now()-{tl}")
        check(f'일정 탭 그리기 50ms 이내({tl:.0f}ms)', tl < 50)
        check('화면 오류 없음(6차)', not e5, e5)

        print('[7차: 하루 탭 — 새벽 깸·기상, 시간순, 계획 대비(깨시·수유텀 ±15분)]')
        w7 = await ev("""(()=>{ const k=addDays(dkey(Date.now()),-30), y=addDays(k,-1), P=planFor(k), T=(m)=>at(k,hmM(m));
          Object.values(S.recs).forEach(r=>{ if(r.start>at(y,'12:00') && r.start<at(addDays(k,1),'00:00')) r.deleted=true; }); dirty();
          const ids=[];
          ids.push(addRec({type:'sleep',start:at(y,'19:40'),end:at(k,'05:00'),kind:'밤'}).id);
          ids.push(addRec({type:'feed',start:at(k,'05:10'),value:120,d1:'분유'}).id);
          ids.push(addRec({type:'sleep',start:at(k,'05:20'),end:at(k,'07:00'),kind:'밤'}).id);
          const f1=T(P.feeds[0].t+5); ids.push(addRec({type:'feed',start:f1,value:150,d1:'분유'}).id);
          const n1=at(k,'07:00')+(P.ww[0]+10)*MIN; ids.push(addRec({type:'sleep',start:n1,end:n1+60*MIN,kind:'낮'}).id);
          const f2=f1+(P.feeds[1].t-P.feeds[0].t+20)*MIN; const f2id=addRec({type:'feed',start:f2,value:160,d1:'분유'}).id; ids.push(f2id);
          S.tab='day'; S.day=k; S.dayAll=true; S.planOpen=false; render();
          const items=[...document.querySelectorAll('.card.list button.item')].map(b=>[b.querySelector('.t').textContent, b.querySelector('.what span').textContent, (b.querySelector('.pdiff')||{}).textContent||'']);
          const cards=[...document.querySelectorAll('#app .card .h')].map(e=>e.firstChild.textContent.trim());
          const sum=$('.psum').innerText;
          const ty=(S.day=y, render(), $('.card.list').innerText);
          ids.forEach(id=>removeRec(id)); S.dayAll=false; S.day=dkey(Date.now()); render();
          return {items, cards, sum, ty, nap:hm(n1), f2:hm(f2)}; })()""")
        names = [x[1] for x in w7['items']]; times = [x[0] for x in w7['items']]
        check('새벽: 05:00 새벽 깸 → 05:10 새벽 수유 → 05:20 밤잠 → 07:00 기상', names[:4] == ['새벽 깸', '새벽 수유', '밤잠', '기상'] and times[:4] == ['05:00', '05:10', '05:20', '07:00'], w7['items'][:5])
        check('기록 목록은 아침부터 시간순', times == sorted(times), times)
        check('전날 목록에는 잠든 시각(19:40)으로 그대로', '19:40' in w7['ty'] and '새벽 깸' not in w7['ty'])
        check('계획 대비는 따로 카드 없이 기록 카드 안 요약 한 줄', not any(c.startswith('계획 대비') for c in w7['cards']) and '계획대로' in w7['sum'], (w7['cards'], w7['sum']))
        nap = [x for x in w7['items'] if x[0] == w7['nap']]
        check('깨시 +10분은 계획대로(표시 없음)', nap and nap[0][2] == '', nap)
        f2 = [x for x in w7['items'] if x[0] == w7['f2']]
        check('수유텀 +20분은 "수유텀 … 20분 길게" 표시', f2 and '수유텀' in f2[0][2] and '20분 길게' in f2[0][2], f2)
        w8 = await ev("""(()=>{ const k=addDays(dkey(Date.now()),-31), y=addDays(k,-1), P=planFor(k), T=(m)=>at(k,hmM(m)), ids=[], A=(o)=>ids.push(addRec(o).id);
          Object.values(S.recs).forEach(r=>{ if(r.start>at(y,'12:00') && r.start<at(addDays(k,1),'00:00')) r.deleted=true; }); dirty();
          const out={};
          // ① 05:00 깸 → 05:20 다시 잠(아직 자는 중): 05:00은 새벽 깸, 기상 비교는 아직
          A({type:'sleep',start:at(y,'19:40'),end:at(k,'05:00'),kind:'밤'}); const op=addRec({type:'sleep',start:at(k,'05:20'),kind:'밤'}); ids.push(op.id);
          S.tab='day'; S.day=k; render(); out.open=[...document.querySelectorAll('.card.list .item .what > span:first-child')].map(e=>e.textContent);
          out.wake=compareRows(k).find(o=>o.n==='기상').d;
          updateRec(op.id,{end:at(k,'06:30')});
          // ② 06:45 아침 첫 수유(기상 06:30 뒤)는 수유1, 05:10은 새벽 수유
          A({type:'feed',start:at(k,'05:10'),value:100}); A({type:'feed',start:at(k,'06:45'),value:150});
          // ③ 토막잠(10분) 뒤 낮잠: 깨시는 기상부터
          const n1=at(k,'06:30')+(P.ww[0]-5)*MIN; A({type:'sleep',start:n1,end:n1+10*MIN,kind:'낮'});
          const n2=at(k,'06:30')+(P.ww[0]+20)*MIN; A({type:'sleep',start:n2,end:n2+60*MIN,kind:'낮'});
          // ④ 수유2 뒤 1시간 만에 40ml → 추가 수유, 그다음은 수유3
          const f2=at(k,'06:45')+(P.feeds[1].t-P.feeds[0].t)*MIN; A({type:'feed',start:f2,value:160}); A({type:'feed',start:f2+60*MIN,value:40});
          const f3=f2+(P.feeds[2].t-P.feeds[1].t)*MIN; A({type:'feed',start:f3,value:160});
          const rows=compareRows(k); S.dayAll=true; render();
          out.f1=rows.find(o=>o.n===P.feeds[0].l); out.f3=rows.find(o=>o.n===P.feeds[2].l); out.extra=rows.filter(o=>o.n==='추가 수유').map(o=>o.a);
          out.nap1=rows.find(o=>o.n==='낮잠1'); out.dawn=[...document.querySelectorAll('.card.list .item .what > span:first-child')].map(e=>e.textContent);
          out.r=[hm(at(k,'06:45')), hm(f3), hm(f2+60*MIN)];
          ids.forEach(id=>removeRec(id)); S.dayAll=false; S.day=dkey(Date.now()); render();
          return JSON.parse(JSON.stringify({open:out.open, wake:out.wake, f1:[out.f1.a,out.f1.off], f3:[out.f3.a,out.f3.off], extra:out.extra, nap1:[out.nap1.a,out.nap1.off,out.nap1.d], dawn:out.dawn, r:out.r})); })()""")
        check('다시 잠들어 자는 중이면 앞서 깬 건 "새벽 깸"(기상 아님)', '새벽 깸' in w8['open'] and '기상' not in w8['open'] and w8['wake'] is None, w8['open'])
        check('기상 뒤 아침 수유는 수유1(새벽 수유 아님)', w8['r'][0] in w8['f1'][0] and '새벽 수유' in w8['dawn'], (w8['f1'], w8['dawn']))
        check('토막잠(-5분에 재움) 뒤 다시 잔 낮잠: 깨시는 처음 재운 시각까지(-5분 → 계획대로)', not w8['nap1'][1] and abs(w8['nap1'][2] + 5) < 1, w8['nap1'])
        check('중간에 조금 먹은 수유는 추가 수유, 다음은 제 순번(수유3 계획대로)', any(w8['r'][2] in x for x in w8['extra']) and w8['r'][1] in w8['f3'][0] and not w8['f3'][1], (w8['extra'], w8['f3']))
        check('화면 오류 없음(7차)', not e5, e5)
        await b.close()
    print('\n결과:', '모두 통과' if not FAILS else f'{len(FAILS)}건 실패: ' + ', '.join(FAILS))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
