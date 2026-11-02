// 長い答えの文を、読みやすく行に分ける（町のページ・確かめる一覧・くらしのメモで使う）。
// 「。」「．」「；」「／」と、かっこで閉じた項目の「）、」のあと、①②… や (1)（1）の前で改行する。
// かぎかっこ・かっこの中（「まちの情報／オープンデータ」など）では区切らない。文の中身は変えない（区切りに改行を入れるだけ）
function prettyText(s, esc) {
  const text = String(s ?? "");
  const open = "「『（(【", close = "」』）)】";
  let out = "", depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1] ?? "";
    // ①② や（1）(1) の前で改行（かっこの外のとき）
    if (depth === 0 && out && (/[①-⑳]/.test(ch) || (/[（(]/.test(ch) && /^[0-9０-９]{1,2}[)）]/.test(text.slice(i + 1, i + 4))))) out = out.trimEnd() + "\n";
    if (open.includes(ch)) depth++;
    if (close.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && ch === "／") { out = out.trimEnd() + "\n"; continue; }
    out += ch;
    if (depth === 0 && /[。．；;]/.test(ch) && next && !/\s/.test(next)) out += "\n";
    // 英語・ポルトガル語・スペイン語の文の終わり（「. 」のあとが大文字・数字・かっこ）
    if (depth === 0 && /[.!?]/.test(ch) && next === " " && /[A-ZÀ-Ý0-9(（①-⑳¿¡]/.test(text[i + 2] ?? "")) { out += "\n"; i++; }
    // かっこで閉じた項目が「、」で続くとき（第二小(…)、第六小(…)）
    if (depth === 0 && ch === "、" && /[)）]/.test(text[i - 1] ?? "")) out += "\n";
  }
  return out.split("\n").map((line) => esc(line.trim())).filter(Boolean).join("<br>");
}
