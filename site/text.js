// 長い答えの文を、読みやすく行に分ける（町のページ・確かめる一覧で使う）。
// 「。」「．」「；」「／」と、かっこで閉じた項目の「）、」のあと、①②… や (1)（1）の前で改行する。
// 文の中身は変えない（区切りに改行を入れるだけ）
function prettyText(s, esc) {
  const t = String(s ?? "")
    .replace(/([。．；;])\s*(?=\S)/g, "$1\n")
    .replace(/\s*／\s*/g, "\n")
    .replace(/([)）]、)\s*/g, "$1\n")
    .replace(/\s*(?=[①-⑳])/g, "\n")
    .replace(/\s*(?=[（(][0-9０-９]{1,2}[)）])/g, "\n")
    .replace(/(^|\n)\n+/g, "$1")
    .trim();
  return t.split("\n").map((line) => esc(line.trim())).filter(Boolean).join("<br>");
}
