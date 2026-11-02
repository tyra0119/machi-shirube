// 町のことが分かるほかのサイト：町の公式サイトのほかに、その町の暮らしに役立つ外部のサイト（地域の情報サイト・地域の新聞・観光協会・商工会・
// 社会福祉協議会・コミュニティFM など）の候補を、Claude（Sonnet）に web 検索で探させる。運営者・新しさ・利用条件も読ませる。
// 候補は確かめる一覧に入れ、作者が「使ってよい」にしたサイトだけを使う（情報源カード。公式ではない印つき）。
// 使い道：町を知るページのリンクと、話題・催しなど危なくない問いの答えの出典（防災・医療・手続きには使わない）
// 動かし方: npm run local-sites -- 11227
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";
import * as ledger from "./ledger.mjs";

const MODEL = "claude-sonnet-5-5";
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const between = (t, tag) => t.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? "";
// 町の情報サイトにしないもの（大きな全国のサイト・SNS・百科事典）
const SKIP = /(^|\.)(go\.jp|lg\.jp|wikipedia\.org|x\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com|tiktok\.com|jalan\.net|tabelog\.com|google\.com|yahoo\.co\.jp|ameblo\.jp|note\.com)$/;

export async function localSites(code, log = console.log) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) throw new Error("費用の上限に達しています");
  const t = read("site/data/stats.json").towns[code];
  const name = `${t.pref} ${t.name.replace(/^.+?郡(?=.+[町村]$)/, "")}`;
  const official = read("site/data/official-sites.json")[code];
  const known = new Set(ledger.load().items.filter((x) => x.kind === "local-site" && x.scope === `muni:${code}` && x.status !== "void").map((x) => x.host));
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 6000, output_config: { effort: "medium" },
    system: "町に住む人のために、町の公式サイトのほかに暮らしに役立つ外部のサイトを探します。見つけたサイトは、トップページと「このサイトについて」「利用規約」などを実際に開いて、運営者・新しさ・利用の条件を確かめます。分からないことは「分からない」と書き、推測で埋めません。",
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 6, user_location: { type: "approximate", country: "JP" } },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10, max_content_tokens: 12000 },
    ],
    messages: [{ role: "user", content: `町：${name}\n町の公式サイト：${official?.url ?? "（不明）"}（これは除く）\n\nこの町に住む人の暮らしに役立つ、町の公式サイト以外のサイトを、多くて6つ探してください。\n探すもの：その町の地域の情報サイト（お店・催し・町の話題）、地域の新聞や地域紙、観光協会、商工会・商工会議所、社会福祉協議会、コミュニティFM、町で活動する NPO など。\n除くもの：国や県・市町村のサイト、SNS、全国の大きな口コミやグルメのサイト、百科事典、個人の日記のようなブログ、広告ばかりのまとめサイト、1年以上更新されていないサイト。\n${known.size ? `もう候補にしたサイト（除く）：${[...known].join("・")}\n` : ""}\nサイトごとに、次の形だけで答えてください：\n<site>\n<name>サイトの名前</name>\n<url>トップページの URL</url>\n<kind>種類（地域の情報サイト・地域の新聞・観光協会・商工会・社会福祉協議会・コミュニティFM・NPO など）</kind>\n<operator>運営者（サイトに書いてある名前。分からなければ「分からない」）</operator>\n<fresh>新しさ（いちばん新しい記事やお知らせの日付。開いて見たもの）</fresh>\n<terms>利用の条件（利用規約や著作権の書き方の要点と、その書いてあるページの URL。見つからなければ「見つからない」）</terms>\n<use>この町の人にどう役立つか（40字ほど）</use>\n</site>` }],
  });
  const usd = record(MODEL, res.usage, `町のことが分かるほかのサイトを探す：${name}`);
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const added = [];
  for (const m of text.matchAll(/<site>([\s\S]*?)<\/site>/g)) {
    const s = { name: between(m[1], "name"), url: between(m[1], "url"), kind: between(m[1], "kind"), operator: between(m[1], "operator"), fresh: between(m[1], "fresh"), terms: between(m[1], "terms"), use: between(m[1], "use") };
    let host;
    try { host = new URL(s.url).hostname; } catch { log(`  読めない URL：${s.url}`); continue; }
    if (SKIP.test(host) || host === official?.host || known.has(host)) { log(`  除きました：${s.name}（${host}）`); continue; }
    known.add(host);
    const item = ledger.add({
      scope: `muni:${code}`, scopeName: name, kind: "local-site", host, site: s,
      question: "このサイトを、町のことが分かるほかのサイト（公式ではない）として使ってよいか",
      value: `${s.name}（${s.kind}）：${s.use}\n運営者：${s.operator}\n新しさ：${s.fresh}\n利用の条件：${s.terms}`,
      source: { title: s.name, url: s.url },
      why: "公式ではないサイト。運営者と利用の条件を見て、町を知るページのリンクと、話題・催しの答えの出典に使ってよいかを決める（防災・医療・手続きには使わない）",
    });
    added.push(item.id);
    log(`  候補：${s.name}（${s.kind}・${host}）→ ${item.id}`);
  }
  log(`${name}：候補 ${added.length}（$${usd.toFixed(3)}）`);
  return { added, usd };
}

if (process.argv[1]?.endsWith("local-sites.mjs")) for (const c of process.argv.slice(2)) await localSites(c);
