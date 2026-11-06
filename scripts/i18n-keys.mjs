// 町のページの決まった文字の見出し語（ほかの言葉に訳す文字）を集める。
// scripts/i18n.mjs（訳す）と scripts/check.mjs（訳の抜けを点検する）が同じ集め方を使う（別々に書くと、片方だけ拾い漏れる）
// 見出し語：site/data/i18n/keys-page.json（ページから集めた決まった文字）と、site/*.js の T("…") などの文字
import fs from "node:fs";

export function collectKeys() {
  const keys = new Set(JSON.parse(fs.readFileSync("site/data/i18n/keys-page.json", "utf8")));
  // 町のページの欄の見出し（town.html の h2・h3）も、ページから集め直さなくても拾う（11/6、新しい欄の見出しが keys-page に無く、ほかの言葉で日本語のまま出た）
  for (const m of fs.readFileSync("site/town.html", "utf8").matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)) {
    const t = m[1].replace(/<[^>]+>/g, "").trim();
    if (/[ぁ-んァ-ン一-龥]/.test(t) && !t.includes("/")) keys.add(t);
  }
  for (const f of fs.readdirSync("site").filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(`site/${f}`, "utf8");
    for (const m of src.matchAll(/T\("([^"]+)"\)/g)) keys.add(m[1]);
    // 数などの入る文（TN("…{m}…", { m })。i18n.js）も
    for (const m of src.matchAll(/TN\("([^"]+)",/g)) keys.add(m[1]);
    // 表から T(変数) で出す文も（拾えていなかったので、ほかの言葉の画面に日本語のまま出ていた）：
    // 町・字の中の位置の言い方（types.js の tn("…")）・型の名前と誰か（add("…", "…")）・この町ならでは（features.js の title/desc/later）・
    // 町のデータの見出し（TOWN_ROWS）・ページの中の行き先の名前（["…", "sec-…"]）
    for (const m of src.matchAll(/\btn\("([^"]+)",/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\badd\("([^"]+)", "([^"]+)",/g)) { keys.add(m[1]); keys.add(m[2]); }
    for (const m of src.matchAll(/\b(?:title|desc|later): "([^"]*[ぁ-んァ-ヶ一-龠][^"]*)"/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\["\w+", "([^"]+)", "(?:population|households)"\]/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\["([^"]+)", "(?:sec|news|hinan|shelter)-[a-z-]+"\]/g)) keys.add(m[1]);
  }
  for (const k of ["日本語", "（AI による訳）", "足しました", "新しくしました", "確かめ直しました"]) keys.add(k);
  // 天気コードの決まった言い方（気象庁の一覧。site/data/jma-telops.json。today.js が T(日本語) で出す）
  if (fs.existsSync("site/data/jma-telops.json")) for (const t of Object.values(JSON.parse(fs.readFileSync("site/data/jma-telops.json", "utf8")).telops)) keys.add(t.ja);
  // 物差しの問いの見出し（新しくなったこと・見立てのボタンなどで T(見出し) と出す）
  for (const q of JSON.parse(fs.readFileSync("site/data/yardstick.json", "utf8")).questions) if (q.short) keys.add(q.short);
  // 訳のある町（site/data/translations/{コード}.json がある町）のデータの注意書き・明るい話題（町のページが T(d.note) などで出す）
  const trTowns = fs.readdirSync("site/data/translations").filter((f) => /^\d{5}\.json$/.test(f)).map((f) => f.slice(0, 5));
  for (const dir of ["flood-pop", "slope", "quake-pop", "climate", "lore", "accidents", "bus", "shop-access", "gomi-days", "plan", "local-sites"]) {
    for (const code of trTowns) {
      const f = `site/data/${dir}/${code}.json`;
      if (!fs.existsSync(f)) continue;
      const d = JSON.parse(fs.readFileSync(f, "utf8"));
      if (d.note) keys.add(d.note);
      for (const b of d.bright ?? []) keys.add(b);
    }
  }
  return [...keys];
}
