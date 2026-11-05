// AI が作った文（届きにくい人の見立て・町・字ごとのひとこと・数から、できることへ）を、外国の住民の言葉とやさしい日本語に訳す。手元の PC だけで動く。
// 動かし方: npm run translate-ai -- 10524 [pt,es,en,easy,id,ne,vi]
// - 訳すのは Claude（Sonnet）。別の Claude（Haiku）が日本語に訳し戻し、もとの日本語と意味が同じかを確かめる（translate.mjs と同じ確かめ役）
// - ずれた訳は出さない（その文は日本語のまま出る）。もとの文が人の確かめ待ちのもの（数から、できることへ）は、町のページが状態を見て出し分ける
// 出力 site/data/translations/{コード}-ai.json
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";
import { LANGS, checkLang } from "./translate.mjs";
import { splitTranslations } from "./split-translations.mjs";

const MODEL = "claude-sonnet-5-5";
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const between = (t, tag) => t.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
const textOf = (res) => res.content.filter((b) => b.type === "text").map((b) => b.text).join("");

// 訳す文を、id つきの1つの並びにする（m=見立て・h=ひとこと・d=数から、できることへ・n=注意書き）
function collect(code) {
  const list = [];
  const push = (id, text) => text && list.push({ id, text });
  const m = read(`site/data/mitate/${code}.json`);
  m?.who.forEach((w, i) => { push(`m${i}.person`, w.person); push(`m${i}.wall`, w.wall); push(`m${i}.why`, w.why); });
  push("n.mitate", m?.note);
  const h = read(`site/data/hitokoto/${code}.json`);
  for (const [k, v] of Object.entries(h?.parts ?? {})) push(`h${k}`, v.text);
  push("n.hitokoto", h?.note);
  const d = read(`site/data/dekiru/${code}.json`);
  d?.links.forEach((l, i) => { push(`d${i}.who`, l.who); push(`d${i}.num`, l.num); push(`d${i}.todo`, l.todo); push(`d${i}.quote`, l.quote); });
  push("n.dekiru", d?.note);
  // 町の紹介（scripts/intro.mjs。どんな町？）
  const it = read(`site/data/intro/${code}.json`);
  it?.sentences.forEach((x, i) => push(`i${i}`, x.text));
  push("n.intro", it?.note);
  // 町のクイズ（scripts/quiz.mjs）
  const qz = read(`site/data/quiz/${code}.json`);
  qz?.questions.forEach((x, i) => { for (const k of ["q", "a", "b", "c", "why"]) push(`q${i}.${k}`, x[k]); });
  push("n.quiz", qz?.note);
  // ごみを出す日（AI が町の収集日の表から読み取った、ごみの種類・曜日・出し方の要点）。同じ文は1回だけ。id は g0, g1 …、もとの文は gomi に残す
  const gd = read(`site/data/gomi-days/${code}.json`);
  const gomi = [...new Set([...(gd?.areas ?? []).flatMap((a) => [a.area, ...a.days.flatMap((x) => [x.kind, x.when])]), ...(gd?.rules ?? []).flatMap((r) => [r.kind, r.how, r.time])].filter(Boolean))];
  gomi.forEach((t, i) => push(`g${i}`, t));
  // このごみは何ごみ？の辞書（町の公式の一覧表から作ったもの）：品目の名前・ごみの種類・注意。同じ文は1回だけ。id は w0, w1 …
  // （作者「A」：ポルトガル語の画面で「pilha」と入れても見つからず、答えも日本語だけだった）
  const gdict = read(`site/data/gomi/${code}.json`);
  const words = [...new Set((gdict?.items ?? []).flatMap((x) => [x.n, x.k, ...(x.also ?? []), x.note]).filter(Boolean))];
  words.forEach((t, i) => push(`w${i}`, t));
  return { list, gomi, words, made: { mitate: m?.createdAt ?? null, hitokoto: h?.createdAt ?? null, dekiru: d?.createdAt ?? null, gomi: gd?.createdAt ?? null, quiz: qz?.createdAt ?? null, intro: it?.createdAt ?? null, gomidict: gdict?.createdAt ?? null } };
}

export async function translateAI(code, langs = Object.keys(LANGS), log = console.log) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) throw new Error("費用の上限に達しています");
  const { list, gomi, words, made } = collect(code);
  if (!list.length) throw new Error("訳す文がありません（見立て・ひとこと・数から、できることへ）");
  const town = read("site/data/stats.json").towns[code];
  const client = new Anthropic();
  const file = `site/data/translations/${code}-ai.json`;
  const out = read(file) ?? { code, langs: {} };
  // もとの文が前と同じ種類は、確かめの通った訳を使い回す（通らなかった文だけ訳し直す）
  const kindOf = (id) => ({ m: "mitate", h: "hitokoto", d: "dekiru", g: "gomi", q: "quiz", i: "intro", w: "gomidict" })[id[0]] ?? id.split(".")[1];
  const same = (id) => out.made?.[kindOf(id)] && out.made[kindOf(id)] === made[kindOf(id)];
  const prevOk = Object.fromEntries(Object.entries(out.langs).map(([l, v]) => [l, Object.fromEntries(Object.entries(v.texts).filter(([id]) => same(id)))]));
  Object.assign(out, { name: town?.name, createdAt: new Date().toISOString(), model: MODEL, made });
  let usd = 0;
  const all = list;
  // 言葉ごとに同時に進める（ごみの辞書の 721 の言葉を足すと、1つの言葉ずつでは3時間ほどかかった）
  await Promise.all(langs.map(async (lang) => {
    const L = LANGS[lang];
    if (!L) throw new Error(`${lang} は分からない言葉です（${Object.keys(LANGS).join("・")}）`);
    const kept = prevOk[lang] ?? {};
    const list = all.filter((x) => !kept[x.id]);
    if (!list.length) { log(`${L.ja}：みな訳してあります`); return; }
    // 20件ずつ頼む（町・字の多い町〈美濃加茂市 78件〉をまとめて頼むと、訳か確かめの答えが長さの上限で切れ、後ろの文が読めなかった）
    const tr = {};
    const checks = [];
    // 20件ずつ頼む。ごみの辞書の品目（w…）は短いので 60件ずつ
    const chunk = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
    for (const part of [...chunk(list.filter((x) => !x.id.startsWith("w")), 20), ...chunk(list.filter((x) => x.id.startsWith("w")), 60)]) {
      const res = await client.messages.create({
        model: MODEL, max_tokens: 12000,
        system: `町に住む人に向けた、暮らしと防災の短い文を訳します。
  - 意味を変えず、足さず、減らさずに訳してください
  - 数字・%・電話番号・URL はそのまま。施設や地名は、訳した言葉のあとに日本語の名前を（ ）で残してください（看板や案内で探せるように）
  - ${lang === "easy" ? "やさしい日本語にしてください。短い文、むずかしい漢字にはひらがなで読みを（ ）でつけ、むずかしい言葉は言いかえる" : `${L.ja}（${L.name}）に訳してください`}
  - 1件ずつ、<item id="番号">訳</item> の形だけで答えてください（JSON にしない）`,
        messages: [{ role: "user", content: part.map((x) => `<item id="${x.id}">${x.text}</item>`).join("\n") }],
      });
      usd += record(MODEL, res.usage, `AI の文を訳す：${town?.name ?? code}（${L.ja}）`);
      Object.assign(tr, Object.fromEntries([...textOf(res).matchAll(/<item id="([^"]+)">([\s\S]*?)<\/item>/g)].map(([, id, t]) => [id, t.trim()])));
      const c = await checkLang(client, part.map((x) => ({ id: x.id, original: x.text, translation: tr[x.id] ?? "" })), `${town?.name ?? code}（AI の文・${L.ja}）`);
      checks.push(...c.checks);
      usd += c.usd;
    }
    const ok = { ...kept };
    const bad = [];
    for (const x of list) {
      const c = checks.find((k) => k.id === x.id);
      if (tr[x.id] && c?.ok) ok[x.id] = tr[x.id];
      else bad.push(`${x.id}（${c?.problems.join("・") || "訳か確かめが読めなかった"}）`);
    }
    // ごみの文は、もとの文 → 訳 で引けるようにしておく（町のページはもとの文で引く）
    const gomiTr = Object.fromEntries(gomi.map((ja, i) => [ja, ok[`g${i}`]]).filter(([, v]) => v));
    const gomiDictTr = Object.fromEntries(words.map((ja, i) => [ja, ok[`w${i}`]]).filter(([, v]) => v));
    out.langs[lang] = { name: L.name, ja: L.ja, texts: ok, gomi: gomiTr, gomiDict: gomiDictTr };
    log(`${L.ja}：${Object.keys(ok).length} / ${all.length}${bad.length ? `。出さない：${bad.length} 件（${bad.slice(0, 5).join("／")}${bad.length > 5 ? " ほか" : ""}）` : ""}`);
  }));
  fs.mkdirSync("site/data/translations", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  splitTranslations(code); // 言葉ごとの小さなファイル
  log(`できました：${file}（$${usd.toFixed(3)}）`);
  return { usd };
}

if (process.argv[1]?.endsWith("translate-ai.mjs")) {
  const [code, langs] = process.argv.slice(2);
  await translateAI(code, langs ? langs.split(",") : undefined);
}
