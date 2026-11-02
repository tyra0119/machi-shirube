// 母語で防災：町の確かめた答え（まちしるべの要約）を、外国の住民の言葉とやさしい日本語に訳す。手元の PC だけで動く。
// 動かし方: npm run translate -- 10524 [pt,es,en,easy]
// - 訳すのは Claude（Sonnet）。別の Claude（Haiku）が日本語に訳し戻し、もとの日本語と意味が同じかを確かめる
// - 意味がずれていた訳は、確かめる一覧に入れる（人が OK するまでページに出さない）。合っていた訳は自動で出す
// - 訳すのは公式の文そのものではなく、まちしるべが出典つきで確かめた答え。ページには「AI による訳」と、もとの日本語と出典を出す
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";
import * as ledger from "./ledger.mjs";

const MODEL = "claude-sonnet-5-5";
const CHECKER = "claude-haiku-5-5";
export const LANGS = {
  pt: { name: "Português", ja: "ポルトガル語" },
  es: { name: "Español", ja: "スペイン語" },
  en: { name: "English", ja: "英語" },
  easy: { name: "やさしい にほんご", ja: "やさしい日本語" },
  // 大泉町の外国の住民で、ポルトガル語・スペイン語の次に多い国籍の言葉（インドネシア・ネパール・ベトナム。2026-11-02 に足した）
  id: { name: "Bahasa Indonesia", ja: "インドネシア語" },
  ne: { name: "नेपाली", ja: "ネパール語" },
  vi: { name: "Tiếng Việt", ja: "ベトナム語" },
};
const PAGES = ["bousai", "komatta", "gomi", "tetsuzuki", "foreign", "iryo", "koutsuu", "kosodate", "kaigo", "okane", "shisetsu", "shiru"]; // 町のページのどの場面の答えも訳す（ページ全体をその言葉で見られるように）

const between = (t, tag) => t.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
const textOf = (res) => res.content.filter((b) => b.type === "text").map((b) => b.text).join("");

// 確かめ役：訳を日本語に訳し戻し、もとの日本語と意味が同じか。答えは1件ずつ印で囲ませる（JSON だと " でこわれる）
export async function checkLang(client, list, label) {
  const chk = await client.messages.create({
    model: CHECKER,
    max_tokens: 8000,
    output_config: { effort: "low" },
    system: `あなたは訳の確かめ役です。それぞれの訳を日本語に訳し戻し、もとの日本語と意味が同じかを確かめてください。
数字・日付・時間・名前・場所が同じか、足したことや抜けたことが無いかを見ます。言い方の違いはかまいません。
1件ずつ、次の形だけで答えてください（JSON にしない）：
<item id="番号"><back>訳し戻した日本語</back><ok>yes か no</ok><problems>ずれ（短く。無ければ空）</problems></item>`,
    messages: [{ role: "user", content: list.map((x) => `<item id="${x.id}">\n<original>${x.original}</original>\n<translation>${x.translation}</translation>\n</item>`).join("\n") }],
  });
  const usd = record(CHECKER, chk.usage, `訳し戻して確かめる：${label}`);
  const text = textOf(chk);
  const checks = [...text.matchAll(/<item id="([^"]+)">([\s\S]*?)<\/item>/g)].map(([, id, body]) => ({
    id,
    back: between(body, "back")?.trim() ?? "",
    ok: /^\s*yes\s*$/i.test(between(body, "ok") ?? ""),
    problems: (between(body, "problems") ?? "").trim() ? [(between(body, "problems")).trim()] : [],
  }));
  return { checks, usd };
}

// 確かめだけやり直す（しくみの不具合で確かめられなかった訳）：npm run translate -- 10524 --recheck
export async function recheckTown(code, log = console.log) {
  const file = `site/data/translations/${code}.json`;
  const t = JSON.parse(fs.readFileSync(file, "utf8"));
  const client = new Anthropic();
  let usd = 0;
  for (const [lang, l] of Object.entries(t.langs)) {
    const bad = l.items.filter((x) => x.status === "pending" && x.problems?.some((p) => /読めなかった/.test(p)));
    if (!bad.length) continue;
    log(`${l.ja}：${bad.length}件の確かめをやり直します`);
    const { checks, usd: u } = await checkLang(client, bad.map((x) => ({ id: x.qid, original: x.original, translation: x.text })), `${t.name}（${l.ja}・やり直し）`);
    usd += u;
    for (const x of bad) {
      const c = checks.find((k) => k.id === x.qid);
      if (!c) continue;
      if (x.ledgerId) ledger.voidItem(x.ledgerId, "訳の確かめ役の答えの形が読めなかった（しくみの不具合。確かめをやり直した）");
      Object.assign(x, { back: c.back, problems: c.problems, status: c.ok ? "auto" : "pending", ledgerId: undefined });
      if (!c.ok) {
        x.ledgerId = ledger.add({
          scope: `muni:${code}`, scopeName: t.name, kind: "translation", qid: x.qid, lang,
          question: `${x.short}の${l.ja}の訳は、もとの日本語と同じ意味か`,
          value: x.text, original: x.original, back: c.back, source: x.source,
          why: `訳し戻すとずれがある（${c.problems.join("・")}）。もとの日本語：${x.original}／訳し戻し：${c.back}`,
        }).id;
      }
      log(`  ${x.qid} ${c.ok ? "合っている" : `ずれ：${c.problems.join("・")}`}`);
    }
  }
  fs.writeFileSync(file, JSON.stringify(t, null, 1));
  ledger.exportPublic();
  log(`やり直しました（${usd.toFixed(3)}）`);
}

export async function translateTown(code, langs = ["pt", "es", "en", "easy"], log = console.log) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD) throw new Error(`今日の費用が上限（$${DAILY_LIMIT_USD}）に達しています`);
  if (spent() >= TOTAL_LIMIT_USD) throw new Error(`これまでの費用が合計の上限（$${TOTAL_LIMIT_USD}）に達しています`);
  const yard = JSON.parse(fs.readFileSync("site/data/yardstick.json", "utf8")).questions;
  const answers = JSON.parse(fs.readFileSync(`site/data/answers/${code}.json`, "utf8")).answers
    .filter((a) => a.value !== "見つからなかった" && PAGES.includes(yard.find((q) => q.id === a.qid)?.page))
    .map((a) => ({ id: a.qid, short: yard.find((q) => q.id === a.qid)?.short ?? "", text: a.value, source: a.source }));
  if (!answers.length) throw new Error("訳す答えがありません（防災・ごみ・手続きなどの確かめた答え）");
  const town = JSON.parse(fs.readFileSync("site/data/stats.json", "utf8")).towns[code];
  const client = new Anthropic();
  const out = { code, name: town?.name, createdAt: new Date().toISOString(), model: MODEL, checker: CHECKER, langs: {} };
  let usd = 0;

  for (const lang of langs) {
    const L = LANGS[lang];
    if (!L) throw new Error(`${lang} は分からない言葉です（${Object.keys(LANGS).join("・")}）`);
    log(`${L.ja}に訳しています（${answers.length}件）`);
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: `あなたは、町の暮らしと防災の情報を、その町に住む外国の人のために訳す係です。
- 渡す日本語は、町の公式の資料から確かめた要約です。意味を変えず、足さず、減らさずに訳してください
- 数字・日付・時間・電話番号・URL はそのまま。施設や地名は、訳した言葉のあとに日本語の名前を（ ）で残してください（看板や案内で探せるように）
- ${lang === "easy" ? "やさしい日本語にしてください。短い文、むずかしい漢字にはひらがなで読みを（ ）でつけ、むずかしい言葉は言いかえる" : `${L.ja}（${L.name}）に訳してください`}
- short（見出し）も訳してください
- 1件ずつ、<item id="番号"><short>見出しの訳</short><text>本文の訳</text></item> の形だけで答えてください（JSON にしない。訳の中に " があっても読めるように）`,
      messages: [{ role: "user", content: JSON.stringify(answers.map(({ id, short, text }) => ({ id, short, text })), null, 1) }],
    });
    usd += record(MODEL, res.usage, `訳す：${town?.name ?? code}（${L.ja}）`);
    const tr = [...textOf(res).matchAll(/<item id="([^"]+)">([\s\S]*?)<\/item>/g)].map(([, id, body]) => ({ id, short: between(body, "short")?.trim(), text: between(body, "text")?.trim() }));

    log(`${L.ja}の訳を、別の Claude が日本語に訳し戻して確かめています`);
    const { checks, usd: u } = await checkLang(client, answers.map((a) => ({ id: a.id, original: a.text, translation: tr.find((t) => t.id === a.id)?.text ?? "" })), `${town?.name ?? code}（${L.ja}）`);
    usd += u;

    out.langs[lang] = { name: L.name, ja: L.ja, items: [] };
    for (const a of answers) {
      const t = tr.find((x) => x.id === a.id);
      const c = checks.find((x) => x.id === a.id);
      const item = { qid: a.id, short: t?.short ?? a.short, text: t?.text ?? "", original: a.text, back: c?.back ?? "", source: a.source,
        status: t?.text && c?.ok ? "auto" : "pending", problems: c?.problems ?? ["確かめ役の答えが読めなかった"] };
      if (item.status === "pending") {
        const rec = ledger.add({
          scope: `muni:${code}`, scopeName: town?.name, kind: "translation", qid: a.id, lang,
          question: `${a.short}の${L.ja}の訳は、もとの日本語と同じ意味か`,
          value: item.text, original: a.text, back: item.back, source: a.source,
          why: `訳し戻すとずれがある（${item.problems.join("・")}）。もとの日本語：${a.text}／訳し戻し：${item.back}`,
        });
        item.ledgerId = rec.id;
      }
      out.langs[lang].items.push(item);
      log(`  ${a.id} ${item.status === "auto" ? "合っている" : `ずれ：${item.problems.join("・")}`}`);
    }
  }
  fs.mkdirSync("site/data/translations", { recursive: true });
  fs.writeFileSync(`site/data/translations/${code}.json`, JSON.stringify(out, null, 1));
  ledger.exportPublic();
  log(`できました：site/data/translations/${code}.json（$${usd.toFixed(3)}）`);
  return { out, usd };
}

if (process.argv[1]?.endsWith("translate.mjs")) {
  const [code, langs] = process.argv.slice(2);
  if (langs === "--recheck") await recheckTown(code);
  else await translateTown(code, langs ? langs.split(",") : undefined);
}
