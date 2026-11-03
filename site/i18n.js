// 町のページの言葉の切り替え（?lang=pt・es・en・easy）。辞書は site/data/i18n/{言葉}.json（日本語の文字そのものを見出し語に）。
// 辞書は Claude が訳し、別の Claude が日本語に訳し戻して確かめたもの（scripts/i18n.mjs）。辞書に無い文字は日本語のまま出す
let LANG = null;
let DICT = {};
const T = (ja) => (LANG && DICT[ja]) || ja;
async function setLang(lang) {
  if (!lang || lang === "ja") return false;
  const d = await fetch(`data/i18n/${lang}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!d) return false;
  LANG = lang;
  DICT = d.dict;
  document.documentElement.lang = lang === "easy" ? "ja" : lang;
  document.body.classList.add("lang-other");
  return true;
}
// ページに書いてある決まった文字を置きかえる（見出し・注意書き・ボタン・入力欄の例）。印（svg）は残す
const I18N_SEL = ".med-controls button, .town-head .unofficial, .block > h2, .block > p.note, .about-site li, .hinan-cautions li, .med-warn, .memo-link, .town-foot a, .all-head h2, #tr-block h2";
function translateDom(root = document, sel = I18N_SEL) {
  if (!LANG) return;
  for (const el of root.querySelectorAll(sel)) {
    const svg = el.querySelector(":scope > svg.ic");
    const key = svg ? el.textContent.trim() : el.innerHTML.trim();
    if (!DICT[key]) continue;
    el.innerHTML = (svg ? svg.outerHTML : "") + DICT[key];
  }
  for (const el of root.querySelectorAll("[placeholder]")) if (DICT[el.placeholder]) el.placeholder = DICT[el.placeholder];
  for (const el of root.querySelectorAll("[aria-label]")) if (DICT[el.getAttribute("aria-label")]) el.setAttribute("aria-label", DICT[el.getAttribute("aria-label")]);
}
// 辞書を作るときに使う：ページの決まった文字を集める（ブラウザで collectI18n() を呼ぶ）
function collectI18n(sel = I18N_SEL) {
  const keys = new Set();
  for (const el of document.querySelectorAll(sel)) keys.add(el.querySelector(":scope > svg.ic") ? el.textContent.trim() : el.innerHTML.trim());
  for (const el of document.querySelectorAll("[placeholder]")) keys.add(el.placeholder);
  return [...keys].filter((k) => k && /[ぁ-んァ-ヶ一-龠]/.test(k));
}
