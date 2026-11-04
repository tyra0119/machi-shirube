// まちしるべの印（線で描いた小さな絵。24×24 の枠に、まちしるべで描いたもの）。絵文字は端末で見え方が変わるので使わない。
// 色は文字の色（currentColor）に従う。icon("gomi") のように名前で呼ぶ
const ICON_PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.5 4.25 4.25 0 0 0 7 18z"/>',
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v7a2 2 0 0 1-4 0"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  trash: '<path d="M4 7h16M10 3h4a1 1 0 0 1 1 1v3H9V4a1 1 0 0 1 1-1zM6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6"/>',
  medical: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  hospital: '<path d="M4 21V8l8-5 8 5v13M2 21h20"/><path d="M12 8v6M9 11h6M10 21v-3h4v3"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  child: '<circle cx="12" cy="5" r="2.5"/><path d="M12 8v7M8 11h8M9.5 21l2.5-6 2.5 6"/>',
  heart: '<path d="M12 20s-7-4.4-9-9a4.6 4.6 0 0 1 9-2 4.6 4.6 0 0 1 9 2c-2 4.6-9 9-9 9z"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M7 21v-3M17 21v-3"/><circle cx="8" cy="14.5" r="1"/><circle cx="16" cy="14.5" r="1"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  yen: '<circle cx="12" cy="12" r="9"/><path d="M8.5 7l3.5 5 3.5-5M12 12v6M9 13h6M9 16h6"/>',
  tree: '<path d="M12 21v-6M12 3l6 8h-3l4 5H5l4-5H6z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  shop: '<path d="M3 9l2-5h14l2 5zM3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v9h14v-9M10 21v-5h4v5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.01"/>',
  quake: '<path d="M2 12h3l2-5 3 10 3-12 3 9 2-2h4"/>',
  shirt: '<path d="M8 3L3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z"/>',
  laundry: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M7.5 6.5h.01M10.5 6.5h.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  speaker: '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  school: '<path d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-5h4v5M12 9v.01"/>',
};
function icon(name, cls = "") {
  const p = ICON_PATHS[name];
  return p ? `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>` : "";
}

// カードのイラスト：場面ごとに、大きな絵と小さな絵を組み合わせ、薄い色の地に置く。色の濃さは style の --h（色相）で決める。
// 赤は警報と戻せない操作だけに使う決まりなので、色相に赤は使わない
const ILLUST = {
  today: { h: 45, main: "sun", sub: "cloud" },
  bousai: { h: 205, main: "shield", sub: "umbrella" },
  chizu: { h: 150, main: "map", sub: "umbrella" },
  gomi: { h: 140, main: "trash", sub: "calendar" },
  iryo: { h: 185, main: "hospital", sub: "heart" },
  komatta: { h: 40, main: "phone", sub: "doc" },
  kosodate: { h: 320, main: "child", sub: "school" },
  kaigo: { h: 275, main: "heart", sub: "child" },
  koutsuu: { h: 215, main: "bus", sub: "pin" },
  tetsuzuki: { h: 235, main: "doc", sub: "calendar" },
  foreign: { h: 165, main: "globe", sub: "book" },
  okane: { h: 50, main: "yen", sub: "doc" },
  shisetsu: { h: 110, main: "tree", sub: "book" },
  shiru: { h: 260, main: "book", sub: "pin" },
  keikaku: { h: 150, main: "map", sub: "calendar" },
  mitate: { h: 195, main: "eye", sub: "search" },
  source: { h: 30, main: "link", sub: "doc" },
  research: { h: 200, main: "search", sub: "book" },
};
function illust(page) {
  const x = ILLUST[page];
  if (!x) return "";
  const g = (name, tx, ty, s) => `<g transform="translate(${tx} ${ty}) scale(${s})" fill="none" stroke-width="${1.8 / s * 1.4}" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</g>`;
  return `<svg class="il" viewBox="0 0 80 64" aria-hidden="true" style="--h:${x.h}">
    <rect class="il-bg" x="0" y="0" width="80" height="64" rx="14"/>
    <circle class="il-dot" cx="66" cy="50" r="10"/><circle class="il-dot" cx="12" cy="12" r="5"/>
    <path class="il-ground" d="M10 54h44"/>
    <g class="il-fg">${g(x.main, 12, 10, 1.75)}</g>
    <circle class="il-badge" cx="60" cy="20" r="13"/>
    <g class="il-sub">${g(x.sub, 50.5, 10.5, 0.8)}</g>
  </svg>`;
}
