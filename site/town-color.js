// 町の色：町が定めた花・木（物差しの Q11 の、確かめた答え）から、ページの差し色を作る。
// 町の公式の色ではないので、そう書く。市章（町のマーク）は使わない。町の公式サイトの配色もまねない。
// 色は、文字が読めるように明るさを自動で合わせる（昼の画面は白い文字が読める濃さ、夜の画面は暗い背景で読める明るさ）
const SYMBOL_COLORS = {
  ツツジ: "#c8377e", サツキ: "#c8377e", サクラ: "#d4567f", 桜: "#d4567f", ウメ: "#c2185b", 梅: "#c2185b",
  ヤブツバキ: "#b3262e", ツバキ: "#b3262e", 椿: "#b3262e", ユリ: "#d0751c", 百合: "#d0751c", チューリップ: "#d0342c",
  コスモス: "#c4458c", アジサイ: "#4b5fb3", あじさい: "#4b5fb3", キク: "#c99a00", 菊: "#c99a00", フジ: "#7b5aa6", 藤: "#7b5aa6",
  ハナミズキ: "#d0607a", ナノハナ: "#c9a800", 菜の花: "#c9a800", ヒマワリ: "#d49a00", スイセン: "#c9a400", ラベンダー: "#7b5aa6",
  シャクナゲ: "#c24a80", ハマナス: "#c2185b", サルビア: "#c62828", ブーゲンビレア: "#b8327e", ブーゲンビリア: "#b8327e",
  ストレチア: "#d9661f", ストレリチア: "#d9661f", ハイビスカス: "#c62828", リンドウ: "#4b4fb3", ナデシコ: "#d4567f", カキツバタ: "#5b4fb3",
  ケヤキ: "#4f7a3a", けやき: "#4f7a3a", クロマツ: "#2f6b4f", 黒松: "#2f6b4f", マツ: "#2f6b4f", 松: "#2f6b4f", スギ: "#3f6b3a",
  イチョウ: "#c9a400", クスノキ: "#3f7a45", フクギ: "#3d7a3a", ナンキンハゼ: "#b8462e", なんきんはぜ: "#b8462e", フェニックス: "#3f7a45",
};

// 町の花を先に選ぶ：答えの文を「。」「／」「、」で区切り、「花」とある所から探す。無ければ文の全体から（木など）。
// その中で、いちばん先に出てくる名前を使う（「町の花：ユリ・ヤブツバキ」ならユリ）
function townSymbol(text) {
  const first = (part) => {
    let best = null;
    for (const name of Object.keys(SYMBOL_COLORS)) {
      const i = part.indexOf(name);
      if (i >= 0 && (!best || i < best.i || (i === best.i && name.length > best.name.length))) best = { name, i };
    }
    return best;
  };
  const flower = text.split(/[。／、；\n]/).filter((p) => p.includes("花")).map(first).find(Boolean);
  const best = flower ?? first(text);
  return best && { name: best.name, color: SYMBOL_COLORS[best.name] };
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const lum = (c) => {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// 白（昼）や暗い背景（夜）に対して、4.5 倍のコントラストになるまで暗く（明るく）する
function fit(base, against, toward) {
  let c = hex(base);
  for (let k = 0; k < 40 && contrast(c, hex(against)) < 4.5; k++) c = c.map((v, i) => v + (toward[i] - v) * 0.08);
  return toHex(c);
}

function applyTownColor(answer) {
  const sym = answer && answer.value !== "見つからなかった" ? townSymbol(answer.value) : null;
  if (!sym) return null;
  const day = fit(sym.color, "#ffffff", [0, 0, 0]);
  const night = fit(sym.color, "#26282a", [255, 255, 255]);
  const style = document.createElement("style");
  style.textContent = `
    :root { --accent: ${day}; --accent-text: #ffffff; }
    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --accent: ${night}; --accent-text: #15120f; } }
    :root[data-theme="dark"] { --accent: ${night}; --accent-text: #15120f; }`;
  document.head.append(style);
  return sym;
}
