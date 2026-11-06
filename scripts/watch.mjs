// 見張り：公開している答え・話題・情報源カードの出典のページが、まだあるかを確かめる（Claude は使わない）。
// 動かし方: npm run watch   出力 site/data/health.json（公開してよい：URL と状態だけ）
// 知らせの考え方（作者の経験から）：人が手を動かすべきものだけを知らせる
//  - ページが消えた（404・410）はすぐ知らせる
//  - 相手の一時的な不調（5xx・つながらない）は、2回続いたときだけ。503 は「メンテナンス中かも」と書き、決めつけない
//  - プログラムからの読み取りを断るサイトの返事（403）と、robots.txt で取らない所は、切れた数に入れない
//  - 一度にたくさん切れたら、1件ずつ並べず「見張る側のずれを疑う」1件にまとめる
import fs from "node:fs";
import crypto from "node:crypto";

const UA = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";
const OUT = "site/data/health.json";
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { links: {} };

// 見張る URL と、それを使っている所
const used = new Map();
const add = (url, where) => {
  if (!url || !/^https?:\/\//.test(url)) return;
  if (!used.has(url)) used.set(url, []);
  used.get(url).push(where);
};
for (const f of fs.readdirSync("site/data/answers").filter((x) => /^\d{5}(-\d{4})?\.json$/.test(x))) {
  const key = f.replace(".json", "");
  for (const a of JSON.parse(fs.readFileSync(`site/data/answers/${f}`, "utf8")).answers) {
    add(a.source?.url, { page: key, qid: a.qid });
    for (const x of a.items ?? []) add(x.url, { page: key, qid: a.qid });
  }
}
if (fs.existsSync("site/data/sources")) {
  for (const f of fs.readdirSync("site/data/sources").filter((x) => x.endsWith(".json"))) {
    for (const c of JSON.parse(fs.readFileSync(`site/data/sources/${f}`, "utf8")).cards ?? []) add(c.url, { page: f.replace(".json", ""), card: c.id });
  }
}

// 行儀よく取る：robots.txt を見る・同じサイトへは1秒あける・15秒で諦める
const robots = new Map();
const lastHit = new Map();
async function check(url) {
  const u = new URL(url);
  if (!robots.has(u.origin)) {
    const txt = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    robots.set(u.origin, txt);
  }
  if (disallowed(robots.get(u.origin), u.pathname)) return { kind: "robots" };
  const wait = 1000 - (Date.now() - (lastHit.get(u.host) ?? 0));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    lastHit.set(u.host, Date.now());
    // 奥のページが、サイトのトップページに飛ばされる：ページが移った・消えたとみなす（11/6、美濃加茂市の古い住所が新しいサイトのトップに、
    // 黒潮町のお土産のページが観光サイトのトップに飛ばされ、「中身が変わった」と受け取って照らし直しが空の理由で食い違いにしていた）
    if (res.ok && res.redirected && new URL(res.url).pathname === "/" && u.pathname !== "/") {
      res.body?.cancel();
      return { kind: "gone", status: "top", moved: res.url };
    }
    if (res.ok) {
      // 中身が変わったかも見る：HTML は文字だけ（スクリプト・タグ・空白を外す）、ほかはそのままの中身で、指紋（ハッシュ）を取る。
      // HTML の文字は local/cache/watch/ にだけ置き、中身が変わったときの照らし直しに使う（scripts/watch-recheck.mjs）
      const buf = Buffer.from(await res.arrayBuffer());
      const html = /html/i.test(res.headers.get("content-type") ?? "");
      const body = html ? pageText(buf.toString("utf8")) : buf;
      const hash = crypto.createHash("sha1").update(body).digest("hex").slice(0, 16);
      if (html) { fs.mkdirSync("local/cache/watch", { recursive: true }); fs.writeFileSync(`local/cache/watch/${keyOf(url)}.txt`, body); }
      return { kind: "ok", status: res.status, moved: res.redirected ? res.url : undefined, hash };
    }
    res.body?.cancel();
    if (res.status === 404 || res.status === 410) return { kind: "gone", status: res.status };
    if (res.status === 403) return { kind: "refused", status: 403 };
    if (res.status === 503) return { kind: "maint", status: 503 };
    return { kind: "error", status: res.status };
  } catch (e) {
    lastHit.set(u.host, Date.now());
    return { kind: "error", status: e.name === "TimeoutError" ? "timeout" : "network" };
  }
}
// ページの文字だけ（スクリプト・スタイル・タグを外し、空白をまとめる）
function pageText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
const keyOf = (url) => crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
function disallowed(txt, path) {
  let mine = false;
  const rules = [];
  for (const line of txt.split(/\r?\n/)) {
    const [k, ...v] = line.split(":");
    const val = v.join(":").trim();
    if (/^user-agent$/i.test(k.trim())) mine = val === "*" || /machi-shirube/i.test(val);
    else if (mine && /^disallow$/i.test(k.trim()) && val) rules.push(val);
  }
  return rules.some((r) => path.startsWith(r));
}

const at = new Date().toISOString();
const links = {};
let i = 0;
for (const [url, where] of used) {
  const r = await check(url);
  const before = prev.links?.[url];
  const failing = r.kind === "error" || r.kind === "maint";
  links[url] = {
    ...r,
    used: where,
    checkedAt: at,
    since: r.kind === "ok" ? undefined : before && before.kind === r.kind ? before.since : at,
    streak: failing ? (before?.kind === r.kind ? (before.streak ?? 1) + 1 : 1) : undefined,
    // 中身が前と変わった日（前の指紋があり、違うとき）。照らし直しが済むまで残す
    changedAt: r.hash && before?.hash && before.hash !== r.hash ? at : r.hash && before?.hash === r.hash ? before.changedAt : undefined,
  };
  process.stdout.write(`\r${++i}/${used.size}`);
}
console.log();

// 知らせるもの：消えた（すぐ）・不調が2回続いた。たくさん同時に新しく切れたら、まとめて1件にする
const problems = Object.entries(links).filter(([, l]) => l.kind === "gone" || ((l.kind === "error" || l.kind === "maint") && l.streak >= 2))
  .map(([url, l]) => ({ url, kind: l.kind, status: l.status, since: l.since, used: l.used }));
const fresh = problems.filter((p) => p.since === at);
const burst = fresh.length >= Math.max(5, used.size * 0.3);
const counts = Object.values(links).reduce((c, l) => ((c[l.kind] = (c[l.kind] ?? 0) + 1), c), {});
fs.writeFileSync(OUT, JSON.stringify({
  checkedAt: at,
  total: used.size,
  counts,
  note: burst ? `一度に ${fresh.length} 件が新しく切れました。相手のサイトではなく、見張る側の読み方のずれを先に疑ってください` : undefined,
  problems: burst ? problems.filter((p) => p.since !== at) : problems,
  links,
}, null, 1));
// エラー調査につなぐ：知らせは確かめる一覧に入れる（同じ URL の知らせが待っていれば足さない）。
// 人が「直して」を押すと、Claude がその問いを調べ直し、新しいページを探す（手元のサーバー）
if (!burst) {
  const { load, add: addItem } = await import("./ledger.mjs");
  const all = load().items;
  const open = new Set(all.filter((x) => x.kind === "watch" && x.status === "pending").map((x) => x.watchUrl));
  const answers = (page) => JSON.parse(fs.readFileSync(`site/data/answers/${page}.json`, "utf8")).answers;
  for (const p of problems.filter((x) => !open.has(x.url))) {
    // 1つの答えが同じページを2か所（出典と、答えの中の一覧）で使っていても、知らせは1件
    for (const u of p.used.filter((x, i, all) => x.qid && all.findIndex((y) => y.page === x.page && y.qid === x.qid) === i)) {
      const a = answers(u.page).find((x) => x.qid === u.qid);
      if (!a) continue;
      const label = p.kind === "gone" && p.status === "top" ? `ページが移った（${new URL(links[p.url].moved).host} のトップページに飛ばされる）`
        : p.kind === "gone" ? `ページが見つからない（${p.status}）` : p.kind === "maint" ? "相手のサイトがメンテナンス中かも（503 が続いている）" : `つながらない状態が続いている（${p.status}）`;
      addItem({
        scope: a.scope, scopeName: all.find((x) => x.id === a.id)?.scopeName, kind: "watch", qid: a.qid, question: a.question, value: a.value, source: a.source,
        redoOf: a.id, watchUrl: p.url,
        why: `見張り：出典の${label}。${p.since.slice(0, 10)} から。「直して」で Claude が新しいページを探して調べ直します`,
      });
      console.log(`  確かめる一覧に入れました：${u.page} ${u.qid}`);
    }
  }
}
console.log(`見張り：${used.size} 件（${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join("・")}）・知らせ ${problems.length} 件${burst ? "（まとめて1件）" : ""}`);
for (const p of problems) console.log(`  ${p.kind} ${p.status ?? ""} ${p.url}（${p.used.map((u) => `${u.page} ${u.qid ?? u.card}`).join("、")}）`);
