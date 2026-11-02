// CSV の1行を列に分ける（"…" で囲んだ列の中のカンマは区切りにしない。役所の CSV の住所に「822-117,896」のようなものがある）
export function cells(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// CSV の全体を行と列に分ける（"…" の中の改行も、列の中の文字として扱う）
export function rows(text) {
  const out = [];
  let row = [], cur = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c !== "")) out.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c !== "")) out.push(row);
  return out;
}
