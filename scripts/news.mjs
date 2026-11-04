// 町の新着のお知らせと、広報紙の最新号（Claude は使わない）。町のページの「今日」に出す。
// 毎日・毎月開く理由になる（審査の「ハッカソンのあとも使い続けるか」。作者「上2つやって」）
// 出すのは見出し・日付・リンクだけ（記事の中身は写さない）。名乗って取り、robots.txt を見て、同じサイトには1秒以上あける
// 動かし方: npm run news   出力 site/data/news/{市区町村コード}.json
// 取り直しは今は手で動かす。毎日の自動の取り直し（GitHub Actions）は、ハッカソンの締め切りのあとに入れる
import fs from "node:fs";

const UA = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";
const TOWNS = {
  "39428": {
    news: { title: "黒潮町 新着・更新情報", url: "https://www.town.kuroshio.lg.jp/pb/cont/yakuba/1346", kind: "kuroshio" },
    koho: { title: "広報くろしお", url: "https://www.town.kuroshio.lg.jp/pb/cont/kouhou" },
  },
  "10524": {
    news: { title: "大泉町 新着情報一覧", url: "https://www.town.oizumi.gunma.jp/news.html", kind: "dl" },
    koho: { title: "令和8年広報おおいずみ", url: "https://www.town.oizumi.gunma.jp/s006/gyosei/010/020/190/20200827185513.html", year: 2026 }, // 号の名前に年が無い（「10月10日号」）
  },
  "21211": {
    news: { title: "美濃加茂市 新着情報", url: "https://www.city.minokamo.lg.jp/rss/10/list1.xml", kind: "rss" },
    koho: { title: "広報みのかも", url: "https://www.city.minokamo.lg.jp/site/koho/" },
  },
  "11227": {
    news: { title: "朝霞市 新着情報", url: "https://www.city.asaka.lg.jp/rss/10/list1.xml", kind: "rss" },
    koho: { title: "朝霞市トップページ（広報あさか）", url: "https://www.city.asaka.lg.jp/" },
  },
  "15385": {
    news: { title: "阿賀町 新着情報", url: "https://www.town.aga.niigata.jp/index.update.json", page: "https://www.town.aga.niigata.jp/news.html", kind: "json" },
    koho: { title: "広報あが", url: "https://www.town.aga.niigata.jp/machi_shokai/kohoaga/index.html" },
  },
};

const lastAt = new Map(); // サイトごとの最後に取った時刻
const robots = new Map();
async function polite(url) {
  const u = new URL(url);
  const wait = 1100 - (Date.now() - (lastAt.get(u.host) ?? 0));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt.set(u.host, Date.now());
}
async function allowed(url) {
  const u = new URL(url);
  if (!robots.has(u.host)) {
    await polite(`${u.origin}/robots.txt`);
    const text = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": UA } }).then((r) => (r.ok && /text\/plain/.test(r.headers.get("content-type") ?? "") ? r.text() : "")).catch(() => "");
    // User-agent: * の Disallow だけを見る
    const dis = []; let star = false;
    for (const line of text.split(/\r?\n/)) {
      const [k, ...v] = line.split(":"); const val = v.join(":").trim();
      if (/^user-agent$/i.test(k.trim())) star = val === "*";
      else if (star && /^disallow$/i.test(k.trim()) && val) dis.push(val);
    }
    robots.set(u.host, dis);
  }
  return !robots.get(u.host).some((p) => u.pathname.startsWith(p));
}
async function get(url) {
  if (!(await allowed(url))) throw new Error(`robots.txt で取らない所：${url}`);
  await polite(url);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) text = new TextDecoder("shift_jis").decode(buf);
  return text;
}

const clean = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const abs = (href, base) => new URL(href.replace(/&amp;/g, "&"), base).href;

// 新着：町のサイトの形ごとに読む
async function readNews(src) {
  const text = await get(src.url);
  let items = [];
  if (src.kind === "rss") {
    for (const m of text.matchAll(/<item\b[\s\S]*?<\/item>/g)) {
      const it = m[0];
      const title = clean((it.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, ""));
      const link = clean((it.match(/<link>([\s\S]*?)<\/link>/) ?? [])[1]);
      const date = (it.match(/<(?:pubDate|dc:date)>([\s\S]*?)<\/(?:pubDate|dc:date)>/) ?? [])[1];
      const d = date ? new Date(date) : null;
      if (title && link) items.push({ title, url: link, date: d && !isNaN(d) ? ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()) : null });
    }
  } else if (src.kind === "json") {
    for (const x of JSON.parse(text)) items.push({ title: clean(x.page_name), url: x.url, date: String(x.publish_datetime ?? "").slice(0, 10) || null });
  } else if (src.kind === "dl") {
    // <dt class="2026114">11月4日</dt><dd><a href="…">見出し</a></dd>（年は dt の class の頭4けた）
    for (const m of text.matchAll(/<dt[^>]*class="(\d{4})\d*"[^>]*>\s*(\d{1,2})月(\d{1,2})日\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) {
      const a = m[4].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (a) items.push({ title: clean(a[2]), url: abs(a[1], src.url), date: ymd(m[1], m[2], m[3]) });
    }
  } else if (src.kind === "kuroshio") {
    // <a href="…"><li>…<h3>見出し</h3><p class="day">2026.11.04</p>…</li></a>
    for (const m of text.matchAll(/<a href="([^"]+)">\s*<li>([\s\S]*?)<\/li>\s*<\/a>/g)) {
      const title = clean((m[2].match(/<h3>([\s\S]*?)<\/h3>/) ?? [])[1]);
      const day = (m[2].match(/class="day">(\d{4})\.(\d{2})\.(\d{2})/) ?? []);
      if (title) items.push({ title, url: abs(m[1], src.url), date: day[1] ? ymd(day[1], day[2], day[3]) : null });
    }
  }
  // 同じリンクは1つに。新しい順に 10 件
  const seen = new Set();
  items = items.filter((x) => !seen.has(x.url) && seen.add(x.url)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10);
  if (!items.length) throw new Error(`新着を読めませんでした（サイトの形が変わったかも）：${src.url}`);
  return { source: { title: src.title, url: src.page ?? src.url }, items };
}

// 広報紙の最新号：一覧のページのリンクの中から「広報」と年月のあるものを集め、いちばん新しいものを選ぶ
const WAREKI = { 令和: 2018, 平成: 1988 };
function issueDate(s, year) {
  const t = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  let m = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/);
  if (m) return ymd(m[1], m[2], m[3] ?? 1);
  m = t.match(/(令和|平成)\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/);
  if (m) return ymd(WAREKI[m[1]] + (m[2] === "元" ? 1 : Number(m[2])), m[3], m[4] ?? 1);
  m = t.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = year && t.match(/(\d{1,2})\s*月\s*(?:(\d{1,2})\s*日)?\s*号/);
  if (m) return ymd(year, m[1], m[2] ?? 1);
  return null;
}
async function readKoho(src, url = src.url, hop = 0, linkYear = null) {
  const text = await get(url);
  const found = [];
  const years = []; // 「広報あが2026年」のような、年ごとのページへのリンク
  // 年度のページ（美濃加茂市「令和08年度（2026年度）の広報紙」からたどった先）：年度はたどったリンクの字から。1〜3月号は次の年
  const fy = linkYear;
  for (const m of text.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    let title = clean(m[2]);
    // リンクの字が「全ページ」だけのときは、すぐ前に書いてある号の名前（「11月号」）を使う
    if (hop && /^全ページ/.test(title) && fy) {
      const before = (clean(text.slice(Math.max(0, m.index - 600), m.index)).match(/(\d{1,2})\s*月号(?!.*月号)/) ?? [])[1];
      if (before) { const mo = Number(before); title = `${src.title} ${mo < 4 ? fy + 1 : fy}年${mo}月号`; }
    }
    // 年ごとのページ（たどった先）では、号の名前に「広報」が無いこともある（「2026年1月号」）
    if (!(hop ? /号/ : /広報/).test(title) || /過去|バックナンバー|一覧|広告|募集|声の|について/.test(title)) continue;
    title = title.replace(/^(.{0,40}?号).*$/, "$1").replace(/^(\S+)\s+\1/, "$1"); // 号の名前のあとの説明は切る。「広報くろしお 広報くろしお」の重なりも1つに
    const date = issueDate(title, src.year);
    if (date) found.push({ title: /広報/.test(title) ? title : `${src.title} ${title}`, url: abs(m[1], url), date });
    else if (!/月/.test(title)) { const y = title.match(/(\d{4})\s*年/); if (y) years.push({ y: Number(y[1]), url: abs(m[1], url) }); }
  }
  found.sort((a, b) => b.date.localeCompare(a.date));
  if (!found.length && years.length && !hop) { const y = years.sort((a, b) => b.y - a.y)[0]; return readKoho(src, y.url, 1, y.y); }
  if (!found.length) throw new Error(`広報紙の号を読めませんでした（サイトの形が変わったかも）：${url}`);
  return { source: { title: src.title, url }, latest: found[0] };
}

fs.mkdirSync("site/data/news", { recursive: true });
const only = process.argv[2];
for (const [code, t] of Object.entries(TOWNS)) {
  if (only && only !== code) continue;
  const out = { code, fetchedAt: new Date().toISOString().slice(0, 10) };
  try { out.news = await readNews(t.news); } catch (e) { console.log(code, "新着：", e.message); }
  try { out.koho = await readKoho(t.koho); } catch (e) { console.log(code, "広報：", e.message); }
  const file = `site/data/news/${code}.json`;
  // 取れなかったものは、前に取れたものを残す（一時的な不調で消さない）
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  for (const k of ["news", "koho"]) if (!out[k] && prev[k]) out[k] = { ...prev[k], stale: true };
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(code, `新着 ${out.news?.items.length ?? 0} 件・広報 ${out.koho ? `${out.koho.latest.title}（${out.koho.latest.date}）` : "なし"}`);
}
