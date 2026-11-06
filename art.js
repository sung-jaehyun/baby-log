// 캐릭터와 아이콘 그림 (색·모양은 여기서만 고치면 앱 전체에 반영)
const ART = (() => {
  const face = (y, eyes, mouth) => `
    <circle cx="31" cy="${y + 2}" r="6" fill="#F5D3BD"/><circle cx="89" cy="${y + 2}" r="6" fill="#F5D3BD"/>
    <circle cx="60" cy="${y}" r="30" fill="#FBE3D0"/>
    <path d="M56 ${y - 29} q6 -9 11 -1" stroke="#6B5444" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${eyes}
    <circle cx="42" cy="${y + 8}" r="5" fill="#F4C0D1"/><circle cx="78" cy="${y + 8}" r="5" fill="#F4C0D1"/>
    ${mouth}`;
  const openEyes = (y) => `<circle cx="48" cy="${y}" r="3.4" fill="#6B5444"/><circle cx="72" cy="${y}" r="3.4" fill="#6B5444"/>
    <circle cx="49" cy="${y - 1}" r="1.1" fill="#fff"/><circle cx="73" cy="${y - 1}" r="1.1" fill="#fff"/>`;
  const wrap = (inner) => `<svg viewBox="0 0 120 120" aria-hidden="true">${inner}</svg>`;

  const chars = {
    sleep: wrap(`
      <path d="M92 18 a12 12 0 1 0 10 18 a9 9 0 1 1 -10 -18z" fill="#FAC775"/>
      <circle cx="24" cy="22" r="1.8" fill="#FAC775"/><circle cx="36" cy="12" r="1.2" fill="#FAC775"/>
      ${face(60, `<path d="M43 58 q5 5 10 0 M67 58 q5 5 10 0" stroke="#6B5444" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
        `<ellipse cx="60" cy="72" rx="3" ry="2.2" fill="#C2836A"/>`)}
      <rect x="22" y="80" width="76" height="34" rx="16" fill="#AFA9EC"/>
      <circle cx="40" cy="96" r="3" fill="#CECBF6"/><circle cx="60" cy="102" r="3" fill="#CECBF6"/><circle cx="80" cy="94" r="3" fill="#CECBF6"/>
      <text x="88" y="50" font-size="11" fill="#CECBF6" font-weight="500" class="zz">z</text><text x="96" y="42" font-size="9" fill="#CECBF6" class="zz">z</text>`),
    feed: wrap(`
      ${face(56, openEyes(52), '')}
      <g transform="rotate(-35 78 86)"><rect x="70" y="72" width="18" height="34" rx="6" fill="#FFFFFF" opacity="0.92"/>
      <rect x="70" y="86" width="18" height="20" rx="6" fill="#FAEEDA"/><rect x="68" y="68" width="22" height="7" rx="3" fill="#FAC775"/>
      <path d="M74 68 q5 -12 10 0z" fill="#EF9F27"/></g>
      <rect x="34" y="88" width="34" height="24" rx="12" fill="#FAC775"/>`),
    awake: wrap(`
      ${face(54, openEyes(50), `<path d="M51 63 q9 9 18 0z" fill="#D85A30"/>`)}
      <rect x="36" y="86" width="48" height="28" rx="14" fill="#9FE1CB"/>
      <line x1="96" y1="96" x2="96" y2="80" stroke="#FAC775" stroke-width="3" stroke-linecap="round"/>
      <circle cx="96" cy="74" r="8" fill="#ED93B1"/><circle cx="96" cy="74" r="3" fill="#FBEAF0"/>`),
    bath: wrap(`
      ${face(52, `<path d="M44 50 q4 -4 8 0 M68 50 q4 -4 8 0" stroke="#6B5444" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
        `<path d="M54 62 q6 6 12 0" stroke="#C2836A" stroke-width="2.5" fill="none" stroke-linecap="round"/>`)}
      <circle cx="40" cy="26" r="7" fill="#E6F1FB" opacity="0.85"/><circle cx="84" cy="20" r="5" fill="#E6F1FB" opacity="0.85"/>
      <rect x="14" y="76" width="92" height="38" rx="14" fill="#5DCAA5"/><rect x="10" y="72" width="100" height="10" rx="5" fill="#9FE1CB"/>
      <circle cx="32" cy="74" r="8" fill="#E1F5EE"/><circle cx="48" cy="72" r="7" fill="#E1F5EE"/><circle cx="76" cy="73" r="8" fill="#E1F5EE"/>
      <ellipse cx="92" cy="70" rx="8" ry="6" fill="#FAC775"/><circle cx="96" cy="63" r="5" fill="#FAC775"/><path d="M100 63 l5 1 -5 2z" fill="#EF9F27"/>`),
  };

  const ic = (inner) => `<svg viewBox="0 0 48 48" aria-hidden="true">${inner}</svg>`;
  const icons = {
    feed: ic(`<rect x="16" y="16" width="16" height="26" rx="6" fill="#fff" stroke="#EF9F27" stroke-width="1.8"/><rect x="16" y="28" width="16" height="14" rx="6" fill="#FAEEDA"/>
      <rect x="14" y="12" width="20" height="6" rx="3" fill="#EF9F27"/><path d="M19 12 q5 -10 10 0z" fill="#BA7517"/>
      <line x1="20" y1="22" x2="24" y2="22" stroke="#FAC775" stroke-width="2"/><line x1="20" y1="26" x2="24" y2="26" stroke="#FAC775" stroke-width="2"/>`),
    sleep: ic(`<path d="M30 8 a16 16 0 1 0 12 26 a12 12 0 1 1 -12 -26z" fill="#3C3489"/><circle cx="12" cy="12" r="2" fill="#fff"/><circle cx="20" cy="6" r="1.4" fill="#fff"/>`),
    wake: ic(`<circle cx="24" cy="24" r="9" fill="#EF9F27"/><g stroke="#EF9F27" stroke-width="3" stroke-linecap="round">
      <line x1="24" y1="5" x2="24" y2="10"/><line x1="24" y1="38" x2="24" y2="43"/><line x1="5" y1="24" x2="10" y2="24"/><line x1="38" y1="24" x2="43" y2="24"/>
      <line x1="10" y1="10" x2="14" y2="14"/><line x1="34" y1="34" x2="38" y2="38"/><line x1="10" y1="38" x2="14" y2="34"/><line x1="34" y1="14" x2="38" y2="10"/></g>`),
    diaper: ic(`<path d="M8 14 h32 v8 q0 18 -16 18 q-16 0 -16 -18z" fill="#fff" stroke="#F0997B" stroke-width="1.8"/><rect x="8" y="14" width="32" height="6" rx="2" fill="#F0997B"/>
      <circle cx="24" cy="30" r="3" fill="#F5C4B3"/>`),
    bath: ic(`<rect x="6" y="22" width="36" height="16" rx="7" fill="#fff" stroke="#3FB08A" stroke-width="1.8"/><rect x="4" y="19" width="40" height="5" rx="2.5" fill="#0F6E56"/>
      <circle cx="15" cy="16" r="4" fill="#fff" stroke="#3FB08A" stroke-width="1.8"/><circle cx="24" cy="12" r="3" fill="#fff" stroke="#3FB08A" stroke-width="1.8"/><circle cx="32" cy="16" r="4" fill="#fff" stroke="#3FB08A" stroke-width="1.8"/>`),
    temp: ic(`<rect x="20" y="6" width="8" height="26" rx="4" fill="#fff" stroke="#E24B4A" stroke-width="1.8"/><circle cx="24" cy="36" r="7" fill="#E24B4A"/><rect x="22.5" y="16" width="3" height="18" fill="#E24B4A"/>`),
    med: ic(`<g transform="rotate(-40 24 24)"><rect x="10" y="17" width="28" height="14" rx="7" fill="#fff" stroke="#E27BA0" stroke-width="1.8"/><path d="M24 17 h7 a7 7 0 0 1 0 14 h-7z" fill="#ED93B1"/></g>`),
    walk: ic(`<rect x="10" y="20" width="26" height="12" rx="6" fill="#9FE1CB"/><path d="M10 20 q2 -12 16 -12 v12z" fill="#5DCAA5"/>
      <circle cx="15" cy="37" r="4" fill="#fff" stroke="#3FB08A" stroke-width="1.8"/><circle cx="31" cy="37" r="4" fill="#fff" stroke="#3FB08A" stroke-width="1.8"/><line x1="36" y1="22" x2="42" y2="12" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`),
    memo: ic(`<rect x="10" y="8" width="28" height="32" rx="5" fill="#fff" stroke="#9A92E0" stroke-width="1.8"/><g stroke="#AFA9EC" stroke-width="2.5" stroke-linecap="round">
      <line x1="16" y1="18" x2="32" y2="18"/><line x1="16" y1="24" x2="32" y2="24"/><line x1="16" y1="30" x2="26" y2="30"/></g>`),
    food: ic(`<path d="M6 22 h36 q0 16 -18 16 q-18 0 -18 -16z" fill="#fff" stroke="#EF9F27" stroke-width="1.8"/><ellipse cx="24" cy="22" rx="18" ry="4" fill="#FAC775"/>
      <line x1="30" y1="20" x2="40" y2="6" stroke="#D3D1C7" stroke-width="3" stroke-linecap="round"/>`),
    gear: ic(`<circle cx="24" cy="24" r="7" fill="none" stroke="currentColor" stroke-width="3"/><g stroke="currentColor" stroke-width="4" stroke-linecap="round">
      <line x1="24" y1="6" x2="24" y2="11"/><line x1="24" y1="37" x2="24" y2="42"/><line x1="6" y1="24" x2="11" y2="24"/><line x1="37" y1="24" x2="42" y2="24"/>
      <line x1="11" y1="11" x2="15" y2="15"/><line x1="33" y1="33" x2="37" y2="37"/><line x1="11" y1="37" x2="15" y2="33"/><line x1="33" y1="15" x2="37" y2="11"/></g>`),
    cal: ic(`<rect x="8" y="11" width="32" height="29" rx="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M8 20 H40 M17 7 V14 M31 7 V14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><rect x="15" y="26" width="6" height="5" rx="1.5" fill="currentColor"/>`),
    home: ic(`<path d="M8 22 L24 9 L40 22 V40 H8z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><rect x="20" y="28" width="8" height="12" fill="currentColor"/>`),
    day: ic(`<circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 14 V24 L31 29" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`),
    pattern: ic(`<g fill="currentColor"><rect x="8" y="20" width="6" height="20" rx="2"/><rect x="17" y="12" width="6" height="28" rx="2"/>
      <rect x="26" y="24" width="6" height="16" rx="2"/><rect x="35" y="8" width="6" height="32" rx="2"/></g>`),
    growth: ic(`<path d="M24 40 V20" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M24 24 q-12 0 -12 -12 q12 0 12 12z M24 20 q10 0 12 -10 q-12 0 -12 10z" fill="currentColor"/>`),
  };
  return { chars, icons };
})();
