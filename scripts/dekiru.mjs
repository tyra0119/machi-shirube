// 数から、できることへ：町の数（国のデータを重ねた数）と、確かめ済みの町の答え（公式のページから調べたもの）を Claude（Sonnet）に渡し、
// 「この数の人は、町の案内のどれを使えばいいか」を多くて5つつながせる。つなぎの文は、答えの文からそのまま写した所（引用）を必ず添える。
// PC が照らす：引用が本当に答えの文にあるか・文の中の数が渡した数か引用にあるか。合わないものは捨てる。
// 避難の判断にひびくので、人が確かめてから町のページに出す（確かめる一覧に入れる）
// 動かし方: npm run dekiru -- 39428
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";
import { townFacts } from "./mitate.mjs";

const MODEL = "claude-sonnet-5-5";
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const flat = (s) => s.replace(/\s+/g, "").replace(/[「」『』]/g, "");
const numsOf = (s) => (s.match(/\d[\d,.]*/g) ?? []).map((v) => v.replace(/,/g, "").replace(/\.$/, ""));

export async function dekiru(code, log = console.log) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) throw new Error("費用の上限に達しています");
  const stats = read("site/data/stats.json");
  const t = stats.towns[code];
  const name = `${t.pref} ${t.name.replace(/^.+?郡(?=.+[町村]$)/, "")}`;
  const facts = townFacts(code);
  // 町の答えのうち、見つかったものだけ（見つからなかった・確かめ待ちは渡さない）
  const answers = (read(`site/data/answers/${code}.json`)?.answers ?? []).filter((a) => a.value && a.value !== "見つからなかった" && a.source?.url);
  if (!answers.length) throw new Error("確かめ済みの答えがありません");
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 3000, output_config: { effort: "medium" },
    system: "町の数と、町の公式のページから調べた案内をつないで、住む人が次に何をすればいいかを示す手伝いをします。案内の文に書いてあることだけを使い、書いていないこと（電話番号・場所・決まり）を足しません。数を変えたり計算したりしません。医療の助言はしません。怖がらせず、やさしい短い日本語で書きます。",
    messages: [{ role: "user", content: `町：${name}\n\n町の数（F番号つき）：\n${facts.map((x, i) => `F${i + 1} ${x}`).join("\n")}\n\n町の公式のページから調べた案内（番号つき）：\n${answers.map((a) => `<answer id="${a.id}">\n問い：${a.question}\n答え：${a.value}\n</answer>`).join("\n")}\n\n上の数のうち、住む人の備えや暮らしにかかわる大事なものを選び、それぞれ「その数にあてはまる人が、町の案内のどれを使えばいいか」をつないでください。多くても5つ、大事な順に。案内にあてはまるものが無い数は、選ばないでください。全国と比べて目立つ数や、あてはまる人の多い数を先に。数と案内が、そのまま結びつくもの（津波の想定の所に住む人 → 津波のときの避難場所、など）だけにしてください。次の形だけで：\n<link>\n<fact>F番号</fact>\n<num>その数の行から、そのまま写した所（30字まで。数を含めて。言い換えない）</num>\n<who>あてはまる人（15字ほど。数は書かない。数は PC が横に出す）</who>\n<todo>その人が次にできること（40字ほど。「〜を見る」「〜に登録する」「〜に相談する」のように動きで。案内に書いてあることだけ）</todo>\n<ref>答えの id</ref>\n<quote>その答えの文から、そのまま写した所（60字まで。言い換えない）</quote>\n</link>` }],
  });
  const usd = record(MODEL, res.usage, `数から、できることへ：${name}`);
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const out = [];
  for (const m of text.matchAll(/<link>([\s\S]*?)<\/link>/g)) {
    const g = (tag) => m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? "";
    const fi = Number(g("fact").replace(/\D/g, "")) - 1;
    const fact = facts[fi];
    const a = answers.find((x) => x.id === g("ref"));
    const x = { num: g("num"), who: g("who"), todo: g("todo"), quote: g("quote") };
    const why = !fact ? "数の番号が無い" : !a ? "答えの id が無い" : !x.todo || !x.quote || !x.num ? "文が空"
      : !numsOf(x.num).length || !flat(fact).includes(flat(x.num)) ? "数の写しが数の行に無い" : !flat(a.value).includes(flat(x.quote)) ? "引用が答えの文に無い"
      : (() => { const bad = numsOf(x.who + x.todo).filter((n) => !(fact + a.value).replace(/,/g, "").includes(n)); return bad.length ? `渡していない数 ${bad.join("・")}` : ""; })();
    if (why) { log(`  捨てました：${x.who || "?"}（${why}）`); continue; }
    if (out.some((o) => o.fact === fact && o.ref === a.id)) continue;
    if (/今後30年に/.test(fact) && !/30年/.test(x.num)) x.num = `今後30年に${x.num}`; // 期間が抜けると、確率の意味が変わる
    const factSrc = fact.match(/（([^（）]*)）$/)?.[1] ?? "";
    out.push({ fact, factSrc, ...x, ref: a.id, qid: a.qid, asOf: a.asOf ?? null, source: { title: a.source.title, url: a.source.url } });
  }
  if (!out.length) throw new Error("つなげたものがありません");
  // 前に作ったものが確かめ待ちなら、取り消してから入れ直す
  const prev = read(`site/data/dekiru/${code}.json`);
  const { add, voidItem } = await import("./ledger.mjs");
  if (prev?.ledgerId) voidItem(prev.ledgerId, "作り直したため");
  const item = add({
    scope: `muni:${code}`, scopeName: name, kind: "dekiru", question: "町の数と、町の案内のつなぎ方は正しいか（その数の人に、その案内が合っているか）",
    value: out.map((o, i) => `${i + 1}. ${o.who}：${o.todo}（案内「${o.quote}」）`).join("\n"),
    source: out[0].source,
    why: "避難や暮らしの判断にひびくので、つなぎ方が合っているかと、引用の元の答えが今も正しいかを人が見る",
  });
  fs.mkdirSync("site/data/dekiru", { recursive: true });
  fs.writeFileSync(`site/data/dekiru/${code}.json`, JSON.stringify({
    code, name, createdAt: new Date().toISOString(), model: MODEL, status: "pending", ledgerId: item.id, links: out,
    note: "町の数と、町の公式のページから調べた案内を、AI がつないだものです。案内の文は、調べた答えからそのまま写し、PC で照らしています",
  }, null, 1));
  log(`${name}：${out.length} つ（${out.map((o) => o.who).join("／")}）・確かめ待ち ${item.id}（$${usd.toFixed(3)}）`);
  return { links: out.length, usd };
}

if (process.argv[1]?.endsWith("dekiru.mjs")) for (const c of process.argv.slice(2)) await dekiru(c);
