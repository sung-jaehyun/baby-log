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

  /* 사진: 정사각형으로 잘라 줄여서 저장(약 20KB) */
  function photo(slot) {
    if (!(slot in photos)) photos[slot] = read(`photo:${slot}`, '');
    return photos[slot];
  }
  function shrink(file, px = 240) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const s = Math.min(img.naturalWidth, img.naturalHeight);
          const c = document.createElement('canvas'); c.width = px; c.height = px;
          c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, px, px);
          res(c.toDataURL('image/jpeg', 0.82));
        } catch (e) { rej(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad')); };
      img.src = url;
    });
  }
  /* 갤러리 열기 → 고르면 저장. 결과: 'ok' | 'cancel' | 'bad' | 'full' */
  function pickPhoto(slot) {
    return new Promise((res) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (!f) { res('cancel'); return; }
        let data;
        try { data = await shrink(f); } catch (e) { res('bad'); return; }
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
