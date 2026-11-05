// 点検（npm run check）：前に起きた不具合が戻っていないか、同じ種類のまちがいが無いかを、1回で調べる。AI は使わない（費用 0・数十秒）
// - コード：文法・古い iPhone（iOS 15.4〜16.3 の Safari）で動かない書き方
// - データ：全部の JSON・URL・電話・バスの時刻・避難場所・クイズ・お知らせ・祝日の表の期限・ごみの曜日が読めるか
// - 作り直し忘れ：町ごとの小さなファイル（build:muni）・言葉ごとの訳のファイル（split-tr）・訳の抜け（i18n）
// - 前の不具合の例：site/*.js の関数に、前に起きた不具合の入力を入れ、答えが合うか（例は下の CASES。不具合を直したら、ここに足す）
// 画面の点検（エラー・はみ出し・字の読みやすさ・日本語の残り）は、手元のサーバーの /check のページ（scripts/check-page.html）
// 動かし方: npm run check　（町を深く調べたあと・コミットの前・録る日の点検 preflight でも動く）
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { collectKeys } from "./i18n-keys.mjs";

const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const out = []; // [段, 結果（ok/ng/warn）, 何を, くわしく]
let section = "";
const ok = (what, detail = "") => out.push([section, "ok", what, detail]);
const ng = (what, detail = "") => out.push([section, "ng", what, detail]);
const warn = (what, detail = "") => out.push([section, "warn", what, detail]);
const check = (cond, what, detail = "") => (cond ? ok(what) : ng(what, detail));
const sample = (xs, n = 5) => `${xs.length} 件：${xs.slice(0, n).join(" / ")}${xs.length > n ? " …" : ""}`;

// ---------------------------------------------------------------- コード
section = "コード";
const siteJs = fs.readdirSync("site").filter((f) => f.endsWith(".js"));
{
  const bad = [];
  for (const f of [...siteJs.map((f) => `site/${f}`), ...fs.readdirSync("scripts").filter((f) => /\.m?js$/.test(f)).map((f) => `scripts/${f}`)]) {
    try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { bad.push(`${f}（${String(e.stderr).split("\n").find((l) => /Error/.test(l)) ?? ""}）`); }
  }
  check(!bad.length, "文法（site/*.js・scripts/*.mjs）", sample(bad));
}
{
  // 古い iPhone：正規表現の後ろ読み (?<!…) (?<=…) は iOS 16.4 より前の Safari で読めず、ファイル全体が止まる（11/5 に 6 か所あった）
  // ES2023 以降の書き方も使わない（iOS 15.4 の Safari までで動くもの。structuredClone・.at() は可）
  const NEW = /\b(?:Object\.groupBy|Map\.groupBy|toSorted|toReversed|toSpliced|withResolvers|fromAsync)\b|\bstatic\s*\{/;
  const lb = [], nw = [];
  for (const f of siteJs) {
    fs.readFileSync(`site/${f}`, "utf8").split("\n").forEach((line, i) => {
      const code = line.trim().startsWith("//") ? "" : line.replace(/\s\/\/\s.*$/, "");
      if (/\(\?<[!=]/.test(code)) lb.push(`${f}:${i + 1}`);
      if (NEW.test(code)) nw.push(`${f}:${i + 1}`);
    });
  }
  check(!lb.length, "正規表現の後ろ読み (?<!…) を使っていない（古い iPhone でページ全体が止まる）", sample(lb));
  check(!nw.length, "iOS 16 以降の新しい書き方を使っていない（Object.groupBy・toSorted など）", sample(nw));
}
{
  const bad = [];
  for (const h of fs.readdirSync("site").filter((f) => f.endsWith(".html"))) {
    for (const [, src] of fs.readFileSync(`site/${h}`, "utf8").matchAll(/<script[^>]*src="([^"]+)"/g)) {
      if (!/^https?:/.test(src) && !fs.existsSync(path.join("site", src.split("?")[0]))) bad.push(`${h} → ${src}`);
    }
  }
  check(!bad.length, "ページの読むファイルがある", sample(bad));
}

// ---------------------------------------------------------------- site/*.js の関数を読む
// 画面に触らないファイルはそのまま、town.js は点検する関数だけを取り出して、仮の入れ物（T・esc・icon など）の中で動かす
const ctx = vm.createContext({
  console, URL, Intl,
  T: (s) => s, TN: (s, v = {}) => s.replace(/\{(\w+)\}/g, (a, k) => v[k] ?? a), TT: (s) => s,
  esc: (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
  icon: () => "", LANG: null, ILLUST: {},
});
const missing = [];
for (const f of ["text.js", "medical.js", "types.js", "today.js", "features.js"]) {
  try { vm.runInContext(fs.readFileSync(`site/${f}`, "utf8"), ctx, { filename: f }); } catch (e) { missing.push(`${f}（${e.message}）`); }
}
const town = fs.readFileSync("site/town.js", "utf8");
const grabLine = (name) => town.split("\n").find((l) => l.startsWith(`const ${name} = `));
const grabFn = (name) => {
  const i = town.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let depth = 0;
  for (let j = town.indexOf("{", i); j < town.length; j++) {
    if (town[j] === "{") depth++;
    else if (town[j] === "}" && --depth === 0) return town.slice(i, j + 1);
  }
  return null;
};
const parts = [...["WD", "numbers", "TEL", "telsIn", "telText", "telHref", "telLinks", "URGENT", "URGENT_BEFORE", "urgentHits"].map((n) => [n, grabLine(n)]), ["onDay", grabFn("onDay")]];
for (const [n, src] of parts) {
  if (!src) { missing.push(`town.js の ${n}`); continue; }
  try { vm.runInContext(src, ctx, { filename: `town.js:${n}` }); } catch (e) { missing.push(`town.js の ${n}（${e.message}）`); }
}
const fn = (name) => { try { return vm.runInContext(name, ctx); } catch { return null; } };
section = "前の不具合の例";
check(!missing.length, "点検する関数を読めた（名前を変えたときは scripts/check.mjs も直す）", sample(missing));

// ---------------------------------------------------------------- 前の不具合の例
// [何の不具合だったか（いつ・どこ）, 確かめる式]。不具合を直したら、ここに 1 行足す
const D = (y, m, d) => new Date(y, m - 1, d);
const CASES = [
  // ごみを出す日（town.js onDay）
  ["「毎週月・木曜日」の「曜日」の「日」を日曜と数えない（11/5）", () => fn("onDay")("毎週月・木曜日", D(2026, 11, 8)) === false && fn("onDay")("毎週月・木曜日", D(2026, 11, 9)) === true],
  ["「日曜日」は日曜に当たる", () => fn("onDay")("毎週日曜日", D(2026, 11, 8)) === true],
  ["「第1・3水曜日」は第2水曜に当たらない", () => fn("onDay")("第1・3水曜日", D(2026, 11, 4)) === true && fn("onDay")("第1・3水曜日", D(2026, 11, 11)) === false],
  ["「第1〜4金曜日」は第5金曜に当たらない", () => fn("onDay")("第1〜4金曜日", D(2026, 10, 30)) === false && fn("onDay")("第1〜4金曜日", D(2026, 10, 23)) === true],
  ["季節で変わる曜日（4・5月／6〜9月／10〜3月）", () => fn("onDay")("4・5月 毎週月・木曜日／6〜9月 毎週月・水・金曜日／10〜3月 毎週月・木曜日", D(2026, 7, 15)) === true && fn("onDay")("4・5月 毎週月・木曜日／6〜9月 毎週月・水・金曜日／10〜3月 毎週月・木曜日", D(2026, 11, 11)) === false],
  ["「11月7日（土）は…収集なし」の例外の日", () => fn("onDay")("毎週土曜日（11月7日（土）は処理場の年次点検のため収集なし）", D(2026, 11, 7)) === false && fn("onDay")("毎週土曜日（11月7日（土）は処理場の年次点検のため収集なし）", D(2026, 11, 14)) === true],
  ["組ごとの日付が別の表（「町の表で」）は今日・明日に数えない", () => fn("onDay")("5週ごとの水曜日（組ごとの日付は町の表で）", D(2026, 11, 11)) === false],
  ["日付の並び（「1月 8・22日／2月 5・19日」）", () => fn("onDay")("1月 8・22日／2月 5・19日", D(2027, 1, 22)) === true && fn("onDay")("1月 8・22日／2月 5・19日", D(2027, 1, 23)) === false],
  // 病院（medical.js）
  ["休みの日の並びを「12/29〜1/3」にまとめる（「，」区切り・0 つき。11/5）", () => fn("shortDays")("01月01日，01月02日，01月03日，12月29日，12月30日，12月31日") === "12/29〜1/3"],
  ["休みの日の範囲（「8月13日～8月15日」）の日は、やっていない（11/5）", () => fn("hoursOn")({ other: "8月13日～8月15日", w: "1111111", h: { 金: [[900, 1200]] } }, D(2027, 8, 13), {}) === null],
  ["病院の URL：「www.…」「http//」「http:/」「htttps」「URL:」を直し、「ﾅｼ」「0」はリンクにしない（約 5,500 件。11/5）", () => {
    const s = fn("siteUrl");
    return s("www.example.com/") === "http://www.example.com/" && s("https//a.example.jp") === "https://a.example.jp/" && s("http:/b.example.jp") === "http://b.example.jp/"
      && s("htttps://www .c.example.com") === "https://www.c.example.com/" && s("URL:http://d.example.jp") === "http://d.example.jp/" && s("ﾅｼ") === null && s("0") === null && s("hpclinic.com") === "http://hpclinic.com/";
  }],
  // 電話（town.js）
  ["全角の数字や「ー」の混じった電話番号を、押すとかかる形に（13 件。11/5）", () => fn("telHref")("０８８０ー５５ー２３１８") === "0880552318" && fn("telText")("048‐423‐6646") === "048-423-6646"],
  ["答えの中の電話番号はリンクに、数の続きの番号はリンクにしない", () => /href="tel:0880432111"/.test(fn("telLinks")("電話 0880-43-2111")) && !/href/.test(fn("telLinks")("10880-43-2111"))],
  ["119・110 はリンクに、「2110円」はリンクにしない", () => fn("urgentHits")("119番へ").length === 1 && fn("urgentHits")("2110円").length === 0 && fn("urgentHits")("#7119へ").length === 1],
  ["時刻の中の数（8時30分）は太くしない", () => !/<b/.test(fn("numbers")("8時30分")) && /<b class="num">5人<\/b>/.test(fn("numbers")("5人"))],
  // 和暦（text.js）
  ["和暦の年月日をほかの言葉で西暦に、「2026年（令和8年）」はそのまま", () => /2026\/4\/1/.test(fn("seireki")("令和8年4月1日から", "en")) && fn("seireki")("2026年（令和8年）", "en") === "2026年（令和8年）"],
  // 今日（today.js）
  ["2つに分けて予報する市は、警報のデータの市まるごとの番号で読む（横浜市など 8 市。11/5）", () => {
    const w = { areaTypes: [{ areas: [] }, { areas: [{ code: "1410000", warnings: [{ code: "10", status: "発表" }] }] }] };
    return fn("warnings")({ class20: "1410011" }, w)?.list?.length === 1 && fn("warnings")({ class20: "9990011" }, w) === null;
  }],
  ["十勝地方・奄美地方の予報は、釧路・鹿児島の予報のファイルから読む（11/5）", () => fn("FORECAST_FILE")?.["014030"] === "014100" && fn("FORECAST_FILE")?.["460040"] === "460100"],
  ["日本の外の端末でも、町の時刻（日本時間）で決める（11/4）", () => { const j = fn("jpNow")(); const u = new Date(); return j.getHours() === (u.getUTCHours() + 9) % 24; }],
  // 位置の言い方（types.js）
  ["「上から ○%」と言わない", () => !/上から/.test(fn("placeWords")(5, 1741, "1.8%") + fn("placeWords")(100, 1741, "1.8%") + fn("placeWords")(1700, 1741, "1.8%"))],
  // この町ならでは（features.js）
  ["予報の値が空の日は「0」ではなく「–」（11/5）", () => fn("rnd")(null) === "–" && fn("rnd")(2.4) === 2],
];
for (const [what, f] of CASES) { let r = false, e = ""; try { r = f(); } catch (x) { e = x.message; } check(r === true, what, e || "答えがちがう"); }

// ---------------------------------------------------------------- データ
section = "データ";
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".json") ? [path.join(d, e.name)] : []));
const files = walk("site/data");
{
  const bad = [];
  const urls = [];
  for (const f of files) {
    let s;
    try { s = fs.readFileSync(f, "utf8"); JSON.parse(s); } catch (e) { bad.push(`${f}（${e.message.slice(0, 40)}）`); continue; }
    if (/[\\/]iryo[\\/]/.test(f)) continue; // 病院の URL は国のデータのままで、出すときに直す（下で数える）
    for (const m of s.matchAll(/"(?:url|href|link)":\s*"([^"]*)"/g)) { let good = false; try { good = /^https?:$/.test(new URL(m[1]).protocol); } catch {} if (!good) urls.push(`${path.basename(path.dirname(f))}/${path.basename(f)} ${m[1].slice(0, 40)}`); }
  }
  check(!bad.length, `JSON がみな読める（${files.length} 個）`, sample(bad));
  check(!urls.length, "URL の形（url・href・link）", sample(urls));
}
const codeFiles = (dir) => (fs.existsSync(`site/data/${dir}`) ? fs.readdirSync(`site/data/${dir}`).filter((f) => /^\d{5}\.json$/.test(f)) : []);
{
  const siteUrl = fn("siteUrl");
  let n = 0, none = 0;
  for (const f of codeFiles("iryo")) for (const x of read(`site/data/iryo/${f}`).list) if (x.u) { n++; if (!siteUrl(x.u)) none++; }
  check(none < n * 0.01, `病院のホームページ：リンクにできない URL が 1% 未満（${none} / ${n}）`);
}
{
  const bad = [];
  for (const f of codeFiles("shelters")) {
    const d = read(`site/data/shelters/${f}`);
    if (!d.features?.length) { bad.push(`${f} 空`); continue; }
    for (const x of d.features) {
      const [lon, lat] = x.geometry?.coordinates ?? [];
      if (!(lon > 122 && lon < 154 && lat > 20 && lat < 46) || !Array.isArray(x.properties?.kinds) || !x.properties?.name) { bad.push(`${f} ${x.properties?.name}`); break; }
    }
  }
  check(!bad.length, `避難場所：座標が日本の中・種類と名前がある（${codeFiles("shelters").length} 町）`, sample(bad));
}
{
  const bad = [];
  for (const f of codeFiles("bus")) for (const s of read(`site/data/bus/${f}`).stops) for (const t of s.times ?? []) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.t)) bad.push(`${f} ${s.name} ${t.t}`);
  check(!bad.length, "バスの時刻が「07:05」の形（並べたときに「次の便」がくるわない）", sample(bad));
}
{
  const bad = [];
  for (const f of codeFiles("kaigo")) for (const x of read(`site/data/kaigo/${f}`).items) if (x.tel && !/^0\d{9,10}$/.test(fn("telHref")(x.tel))) bad.push(`${f} ${x.name} ${x.tel}`);
  check(!bad.length, "介護の事業所の電話が、押すとかかる形になる", sample(bad));
}
{
  const bad = [];
  for (const f of codeFiles("quiz")) for (const [i, q] of read(`site/data/quiz/${f}`).questions.entries()) if (!q.q || !q.a || !q.b || !q.c || !q.why || new Set([q.a, q.b, q.c]).size < 3) bad.push(`${f} ${i + 1}問目`);
  check(!bad.length, "クイズ：問い・3つの答え（みなちがう）・わけがある", sample(bad));
}
{
  const bad = [];
  for (const f of codeFiles("news")) {
    const d = read(`site/data/news/${f}`);
    for (const x of d.news?.items ?? []) if (!x.title || !/^https?:\/\//.test(x.url ?? "") || (x.date && !/^\d{4}-\d{2}-\d{2}/.test(x.date))) bad.push(`${f} ${x.title?.slice(0, 20)}`);
    if (d.koho && !/^https?:\/\//.test(d.koho.latest?.url ?? "")) bad.push(`${f} 広報紙`);
  }
  check(!bad.length, "町からのお知らせ：見出し・URL・日付の形", sample(bad));
  const old = codeFiles("news").filter((f) => (Date.now() - new Date(read(`site/data/news/${f}`).fetchedAt).getTime()) / 864e5 > 7);
  if (old.length) warn("町からのお知らせが 7 日より古い（npm run news で取り直す）", sample(old)); else ok("町からのお知らせが 7 日以内に取ったもの");
}
{
  const h = read("site/data/holidays.json").holidays;
  const last = Object.keys(h).sort().at(-1);
  const days = (new Date(last) - Date.now()) / 864e5;
  if (days < 90) warn(`祝日の表が ${last} までしかない（内閣府の「国民の祝日」から足す）`); else ok(`祝日の表が ${last} まである`);
}
{
  // ごみを出す日：曜日の決まりが、1年のうちどこかの日に当たる（読み取りの仕組みが壊れると、どの日も「収集なし」になる）
  const onDay = fn("onDay");
  const bad = [];
  for (const f of codeFiles("gomi-days")) {
    const g = read(`site/data/gomi-days/${f}`);
    for (const a of g.areas) for (const x of a.days) {
      if (!x.when || !x.kind) { bad.push(`${f} ${a.area} 空`); continue; }
      if (!/曜|月\s*\d|\d月\d/.test(x.when) || /町の表で|カレンダーで/.test(x.when)) continue;
      let hit = false;
      for (let i = 0; i < 366 && !hit; i++) hit = onDay(x.when, new Date(2026, 10, 1 + i));
      if (!hit) bad.push(`${f} ${a.area}「${x.when}」`);
    }
  }
  check(!bad.length, "ごみを出す日：どの曜日の決まりも、1年のどこかの日に当たる", sample(bad));
  // 避難やごみの日にかかわるデータは、作者の OK のあとで出す（ごみを出す日は status、避難施設の一覧は approved に記録）
  const gNot = codeFiles("gomi-days").filter((f) => !["ok", "auto"].includes(read(`site/data/gomi-days/${f}`).status));
  if (gNot.length) warn("ごみを出す日で、作者の OK がまだのもの（町のページには曜日を出さない。確かめる一覧で決める）", sample(gNot)); else ok("ごみを出す日は、どれも作者の OK のあと");
  const sNot = codeFiles("shelter-list").filter((f) => !read(`site/data/shelter-list/${f}`).approved);
  check(!sNot.length, "避難施設の一覧は、どれも作者の OK の記録（approved）がある（無ければ公開しない・local/ に戻す）", sample(sNot));
}

{
  // 住む人に出す AI の文に、やめた言い方（「上から ○%」。作者「分かりにくいからやめよう」）が無い。「上から ○番目」は △（「○番目に高い」がよい）
  const pct = [], nth = [];
  for (const dir of ["mitate", "hitokoto", "dekiru", "quiz", "answers", "changes"]) {
    for (const f of codeFiles(dir)) {
      const s = fs.readFileSync(`site/data/${dir}/${f}`, "utf8");
      for (const m of s.matchAll(/.{0,12}[上下]から\s*\d+(?:\.\d+)?\s*[%％].{0,6}/g)) pct.push(`${dir}/${f} ${m[0]}`);
      for (const m of s.matchAll(/.{0,12}[上下]から\s*\d+\s*番目.{0,4}/g)) nth.push(`${dir}/${f} ${m[0]}`);
    }
  }
  check(!pct.length, "住む人に出す文に「上から ○%」が無い", sample(pct, 3));
  // 作る側の言葉（Claude・モデルの名前・プロンプト）を住む人のページに出さない（「AI」と書く）。model・checker などの記録の項目は見ない
  const SKIP = new Set(["model", "checker", "ledgerId", "id", "qid", "createdAt", "fetchedAt", "at", "url", "status", "by"]);
  const builder = [];
  const walkV = (v, key, where) => {
    if (typeof v === "string") { if (!SKIP.has(key) && /Claude|Sonnet|Haiku|Opus|プロンプト/.test(v)) builder.push(`${where} ${key}: ${v.slice(0, 30)}`); }
    else if (Array.isArray(v)) v.forEach((x) => walkV(x, key, where));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walkV(x, k, where);
  };
  for (const dir of ["mitate", "hitokoto", "dekiru", "quiz", "answers", "changes", "plan", "gomi-days", "news", "sources", "shelter-list", "local-sites"]) for (const f of codeFiles(dir)) walkV(read(`site/data/${dir}/${f}`), "", `${dir}/${f}`);
  check(!builder.length, "住む人に出す文に、作る側の言葉（Claude・モデルの名前・プロンプト）が無い（「AI」と書く）", sample(builder, 3));
  if (nth.length) warn("住む人に出す文に「上から ○番目」がある（「○番目に高い」がよい。作り直すときに直る）", sample(nth, 3)); else ok("住む人に出す文に「上から ○番目」が無い");
}

// ---------------------------------------------------------------- 作り直し忘れ
section = "作り直し忘れ";
{
  // 町ごとの小さなファイルの「ある物の一覧」（build:muni）。古いと、町のページが新しいデータを読みに行かない
  const dirSets = new Map();
  const has = (dir, code) => { if (!dirSets.has(dir)) dirSets.set(dir, new Set(codeFiles(dir).map((f) => f.slice(0, 5)))); return dirSets.get(dir).has(code); };
  const bad = [], lang = [];
  for (const f of codeFiles("muni")) {
    const m = read(`site/data/muni/${f}`), code = f.slice(0, 5);
    if (m.files) {
      if (has("answers", code)) bad.push(`${code}（深く調べた町なのに一覧がある）`);
      else for (const d of m.files.dirs) if (has(d, code) !== m.files.have.includes(d)) { bad.push(`${code} ${d}`); break; }
    }
    if (!!m.langs !== fs.existsSync(`site/data/translations/${code}.json`)) lang.push(code);
  }
  check(!bad.length, "町ごとの小さなファイルの「ある物の一覧」が、いまのデータと合う（ちがえば npm run build:muni）", sample(bad));
  check(!lang.length, "町ごとの小さなファイルの「訳のある言葉」が、いまの訳と合う（ちがえば npm run build:muni）", sample(lang));
}
{
  // 言葉ごとの訳のファイル（split-tr）。古いと、ほかの言葉で見たときに前の訳が出る
  const bad = [];
  for (const f of fs.readdirSync("site/data/translations").filter((f) => /^\d{5}(-ai)?\.json$/.test(f))) {
    const t = read(`site/data/translations/${f}`);
    for (const l of Object.keys(t.langs ?? {})) {
      const p = `site/data/translations/${f.replace(/\.json$/, `.${l}.json`)}`;
      if (!fs.existsSync(p) || JSON.stringify(read(p).langs?.[l]) !== JSON.stringify(t.langs[l])) bad.push(path.basename(p));
    }
  }
  check(!bad.length, "言葉ごとの訳のファイルが、もとの訳と同じ（ちがえば npm run split-tr）", sample(bad));
  // 町のページは、訳の無い町（{コード}.json が無い）では AI の文の訳（{コード}-ai.json）も読まない
  const aiOnly = fs.readdirSync("site/data/translations").filter((f) => /^\d{5}-ai\.json$/.test(f) && !fs.existsSync(`site/data/translations/${f.slice(0, 5)}.json`));
  check(!aiOnly.length, "AI の文の訳がある町には、もとの訳もある（無いと町のページが AI の文の訳を読まない。npm run translate を先に）", sample(aiOnly));
}
{
  // 訳の抜け：見出し語のうち、辞書に無いもの（訳し戻しで通らなかった文は日本語のまま出る）
  const keys = collectKeys();
  for (const l of ["pt", "es", "en", "easy", "id", "ne", "vi", "tl"]) {
    const p = `site/data/i18n/${l}.json`;
    if (!fs.existsSync(p)) { ng(`辞書 ${l} が無い`); continue; }
    const d = read(p).dict;
    const miss = keys.filter((k) => !d[k]);
    if (miss.length > 5) ng(`訳の抜け（${l}）：${miss.length} 語（npm run i18n -- ${l}）`, sample(miss, 3));
    else if (miss.length) warn(`訳の抜け（${l}）：${miss.length} 語。訳し戻しで通らず日本語のまま出る`, sample(miss, 3));
    else ok(`訳の抜け（${l}）：0 語`);
  }
}

// ---------------------------------------------------------------- 結果
const mark = { ok: "○", ng: "×", warn: "△" };
let last = "";
for (const [sec, r, what, detail] of out) {
  if (sec !== last) { console.log(`\n■ ${sec}`); last = sec; }
  if (r === "ok" && !process.argv.includes("--all")) continue;
  console.log(`${mark[r]} ${what}${detail && r !== "ok" ? `\n    ${detail}` : ""}`);
}
const n = (r) => out.filter((x) => x[1] === r).length;
console.log(`\n○ ${n("ok")}　△ ${n("warn")}　× ${n("ng")}${process.argv.includes("--all") ? "" : "（○ は --all で見られる）"}`);
console.log("画面の点検は、手元のサーバー（npm run serve）で http://127.0.0.1:8080/check を開く");
process.exitCode = n("ng") ? 1 : 0;
