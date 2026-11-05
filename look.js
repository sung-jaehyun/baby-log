'use strict';
/* 꾸미기: 테마·글씨체·글씨 크기·사진. 이 휴대폰에만 저장한다(서버로 보내지 않음).
   앱 코드보다 먼저 실행돼서, 처음 화면부터 고른 모양으로 보이게 한다(깜빡임 없음). */
const LOOK = (() => {
  const FONT_V = 'f1';   // 글씨 목록 파일이 바뀌면 올림(휴대폰 보관본을 새로 받게)
  const themes = [
    { k: 'lavender', n: '라벤더', bg: '#F5F1F9', a: '#A98FD0', c: '#E3D8F2', bar: '#F5F1F9' },
    { k: 'peach', n: '피치', bg: '#FFF4EF', a: '#F2A285', c: '#FBDCCF', bar: '#FFF4EF' },
    { k: 'mint', n: '민트', bg: '#F0F8F5', a: '#6CC3A4', c: '#D3EEE3', bar: '#F0F8F5' },
    { k: 'sky', n: '스카이', bg: '#F0F6FC', a: '#7FB2E5', c: '#D6E7F7', bar: '#F0F6FC' },
    { k: 'lemon', n: '레몬', bg: '#FFFBEA', a: '#E8C14F', c: '#F7EBB8', bar: '#FFFBEA' },
    { k: 'dark', n: '다크', bg: '#1E1D2E', a: '#8D7FD8', c: '#34324C', bar: '#1E1D2E' },
  ];
  const fonts = [
    { k: 'pretendard', n: '프리텐다드', fam: "'BL Pretendard'", sample: 'font-weight:700' },
    { k: 'nanumgothic', n: '나눔고딕', fam: "'BL NanumGothic'", sample: 'font-weight:800' },
    { k: 'jua', n: '주아', fam: "'BL Jua'", sample: 'font-weight:400', noBold: true },
    { k: 'gaegu', n: '개구', fam: "'BL Gaegu'", sample: 'font-weight:700' },
    { k: 'poorstory', n: '푸어 스토리', fam: "'BL PoorStory'", sample: 'font-weight:400', noBold: true },
  ];
  const sizes = [{ k: 's', n: '작게', z: 0.92 }, { k: 'm', n: '보통', z: 1 }, { k: 'l', n: '크게', z: 1.1 }];
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  let cur = {};
  try { cur = JSON.parse(read('look', '{}')) || {}; } catch (e) { cur = {}; }
  const photos = {};
  const loaded = new Set();

  const theme = () => themes.find((t) => t.k === cur.theme) || themes[0];
  const font = () => fonts.find((f) => f.k === cur.font) || fonts[0];
  const size = () => sizes.find((s) => s.k === cur.size) || sizes[1];

  function loadFont(f) {
    if (loaded.has(f.k)) return;
    loaded.add(f.k);
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = `fonts/${f.k}.css?${FONT_V}`;
    document.head.appendChild(l);
  }
  function apply() {
    const root = document.documentElement, t = theme(), f = font();
    root.dataset.theme = t.k;
    loadFont(f);
    root.style.setProperty('--font', `${f.fam}, 'BL Pretendard', "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif`);
    root.classList.toggle('no-bold', !!f.noBold);
    root.style.zoom = size().z === 1 ? '' : String(size().z);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t.bar);
  }
  function set(k, v, later) { cur[k] = v; write('look', JSON.stringify(cur)); if (!later) apply(); }

  /* 사진: 고른 뒤 위치 맞추기 화면에서 칸 비율대로 잘라 줄여서 저장(약 20~35KB)
     프로필(avatar)은 동그란 정사각형, 상태 카드(hero)는 세로로 조금 긴 4:5 */
  const SHAPE = { avatar: { w: 240, h: 240, round: true }, hero: { w: 320, h: 400, round: false } };
  function photo(slot) {
    if (!(slot in photos)) photos[slot] = read(`photo:${slot}`, '');
    return photos[slot];
  }
  function loadImg(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { if (img.naturalWidth && img.naturalHeight) res({ img, url }); else { URL.revokeObjectURL(url); rej(new Error('bad')); } };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad')); };
      img.src = url;
    });
  }
  /* 위치 맞추기: 한 손가락으로 끌어 옮기고, 두 손가락이나 아래 막대로 확대. 결과는 원본 기준 자를 영역 또는 null(취소) */
  function cropUI(img, url, sh) {
    return new Promise((done) => {
      const ov = document.createElement('div');
      ov.className = 'crop-ov';
      // 글씨 크기 설정(zoom)을 이 화면에서는 풀어, 손가락 좌표와 화면 좌표를 같게 맞춤
      const rz = Number(document.documentElement.style.zoom) || 1;
      if (rz !== 1) ov.style.zoom = String(1 / rz);
      ov.innerHTML = `<div class="crop-top"><b>사진 위치 맞추기</b><small>끌어서 옮기고, 두 손가락이나 아래 막대로 크기를 맞춰요</small></div>
        <div class="crop-stage"><img alt="" draggable="false"><div class="crop-frame${sh.round ? ' crop-circle' : ''}"></div></div>
        <div class="crop-zoom"><span>－</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="확대"><span>＋</span></div>
        <div class="crop-bt"><button type="button" data-c="0">취소</button><button type="button" data-c="1" class="ok">완료</button></div>`;
      document.body.appendChild(ov);
      const stage = ov.querySelector('.crop-stage'), im = ov.querySelector('img'), fr = ov.querySelector('.crop-frame'), zr = ov.querySelector('input');
      im.src = url;
      const W = img.naturalWidth, H = img.naturalHeight, ar = sh.w / sh.h;
      let fw, fh, fl, ft, s0, s, ox, oy;
      const layout = () => {
        const sw = stage.clientWidth, shh = stage.clientHeight;
        fw = Math.min(sw * 0.82, shh * 0.86 * ar); fh = fw / ar;
        fl = (sw - fw) / 2; ft = (shh - fh) / 2;
        Object.assign(fr.style, { left: `${fl}px`, top: `${ft}px`, width: `${fw}px`, height: `${fh}px` });
      };
      const clamp = () => {
        s = Math.max(s0, Math.min(s0 * 4, s));
        ox = Math.min(0, Math.max(fw - W * s, ox)); oy = Math.min(0, Math.max(fh - H * s, oy));
      };
      const draw = () => {
        clamp();
        Object.assign(im.style, { width: `${W * s}px`, height: `${H * s}px`, transform: `translate(${fl + ox}px, ${ft + oy}px)` });
        zr.value = String(s / s0);
      };
      const zoomAt = (ns, px, py) => { ns = Math.max(s0, Math.min(s0 * 4, ns)); ox = px - (px - ox) * ns / s; oy = py - (py - oy) * ns / s; s = ns; draw(); };
      layout(); s0 = Math.max(fw / W, fh / H); s = s0; ox = (fw - W * s) / 2; oy = (fh - H * s) / 2; draw();
      const onResize = () => { const cx = (fw / 2 - ox) / s, cy = (fh / 2 - oy) / s, k = s / s0; layout(); s0 = Math.max(fw / W, fh / H); s = s0 * k; ox = fw / 2 - cx * s; oy = fh / 2 - cy * s; draw(); };
      window.addEventListener('resize', onResize);
      // 손가락: 1개 = 옮기기, 2개 = 확대·축소(두 손가락 가운데 기준)
      const pts = new Map(); let last = null;
      const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left - fl, e.clientY - r.top - ft]; };
      const gesture = () => {
        const v = [...pts.values()];
        if (v.length === 1) return { x: v[0][0], y: v[0][1], d: 0 };
        return { x: (v[0][0] + v[1][0]) / 2, y: (v[0][1] + v[1][1]) / 2, d: Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]) };
      };
      stage.addEventListener('pointerdown', (e) => { e.preventDefault(); try { stage.setPointerCapture(e.pointerId); } catch (x) {} pts.set(e.pointerId, rel(e)); last = gesture(); });
      stage.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, rel(e)); const g = gesture();
        if (last && pts.size >= 2 && last.d > 0 && g.d > 0) { ox += g.x - last.x; oy += g.y - last.y; zoomAt(s * g.d / last.d, g.x, g.y); }
        else if (last) { ox += g.x - last.x; oy += g.y - last.y; draw(); }
        last = g;
      });
      const up = (e) => { pts.delete(e.pointerId); last = pts.size ? gesture() : null; };
      stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
      stage.addEventListener('wheel', (e) => { e.preventDefault(); const [px, py] = rel(e); zoomAt(s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), px, py); }, { passive: false });
      zr.addEventListener('input', () => zoomAt(s0 * Number(zr.value), fw / 2, fh / 2));
      ov.querySelector('.crop-bt').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        window.removeEventListener('resize', onResize); ov.remove();
        done(b.dataset.c === '1' ? { sx: -ox / s, sy: -oy / s, sw: fw / s, sh: fh / s } : null);
      });
    });
  }
  /* 갤러리 열기 → 위치 맞추기 → 저장. 결과: 'ok' | 'cancel' | 'bad' | 'full' */
  function pickPhoto(slot) {
    const sh = SHAPE[slot] || SHAPE.avatar;
    return new Promise((res) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (!f) { res('cancel'); return; }
        let got;
        try { got = await loadImg(f); } catch (e) { res('bad'); return; }
        const box = await cropUI(got.img, got.url, sh);
        if (!box) { URL.revokeObjectURL(got.url); res('cancel'); return; }
        let data;
        try {
          const c = document.createElement('canvas'); c.width = sh.w; c.height = sh.h;
          const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
          g.drawImage(got.img, box.sx, box.sy, box.sw, box.sh, 0, 0, sh.w, sh.h);
          data = c.toDataURL('image/jpeg', 0.82);
        } catch (e) { res('bad'); return; } finally { URL.revokeObjectURL(got.url); }
        if (!write(`photo:${slot}`, data)) { res('full'); return; }
        photos[slot] = data; res('ok');
      });
      inp.click();
    });
  }
  function clearPhoto(slot) { write(`photo:${slot}`, null); photos[slot] = ''; }

  apply();
  return { themes, fonts, sizes, theme, font, size, set, apply, photo, pickPhoto, clearPhoto, loadFont };
})();
