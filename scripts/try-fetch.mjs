// 試し B：町のサイトを Anthropic 側（Claude のページを取る道具）から取れるか。PC 側からも比べる。
// 動かし方: npm run try:fetch -- [URL]（既定は黒潮町のトップ）
import Anthropic from "@anthropic-ai/sdk";
import { record } from "../src/cost.mjs";

const MODEL = "claude-opus-5-5";
const UA = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";
const target = process.argv[2] ?? "https://www.town.kuroshio.lg.jp/";
const origin = new URL(target).origin;

// 1. PC 側：robots.txt を名乗って取り、1秒あけてからトップを取る
const robots = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": UA } });
console.log(`PC 側 robots.txt: ${robots.status}`);
if (robots.ok) console.log((await robots.text()).split("\n").slice(0, 15).join("\n"));
await new Promise((r) => setTimeout(r, 1000));
const top = await fetch(target, { headers: { "User-Agent": UA } });
console.log(`PC 側 トップ: ${top.status}（${(await top.text()).length} 文字）`);

// 2. Anthropic 側：web_fetch でトップを取らせ、何が取れたかだけ短く答えさせる
const client = new Anthropic();
const res = await client.messages.create({
  model: MODEL,
  max_tokens: 4096,
  output_config: { effort: "low" },
  tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 1, max_content_tokens: 20000 }],
  messages: [
    {
      role: "user",
      content: `${target} を取ってください。取れたら、ページの題名と、防災・避難に関係しそうなリンクを3つまで（文字とURL）だけ答えてください。取れなければ、そのことだけ答えてください。`,
    },
  ],
});

for (const block of res.content) {
  if (block.type === "web_fetch_tool_result") {
    const c = block.content;
    if (c.type === "web_fetch_tool_error") console.log(`Anthropic 側: 取れない（${c.error_code}）`);
    else {
      console.log(`Anthropic 側: 取れた（${c.url}、取得 ${c.retrieved_at ?? "時刻なし"}）`);
      const src = c.content?.source;
      const body = typeof src?.data === "string" ? src.data : JSON.stringify(src ?? c.content);
      console.log(`  中身の形: ${src?.type ?? "?"} ${src?.media_type ?? ""}、${body.length} 文字。先頭: ${body.slice(0, 300).replace(/\s+/g, " ")}`);
    }
  } else if (block.type !== "text") {
    console.log(`（ほかの部品: ${block.type}）`);
  }
}
console.log("--- Claude の答え ---");
console.log(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
const usd = record(MODEL, res.usage, `試し B：${target} を web_fetch で取る`);
console.log(`--- 止まった理由: ${res.stop_reason} / 入力 ${res.usage.input_tokens}・出力 ${res.usage.output_tokens} トークン / $${usd.toFixed(4)}`);
