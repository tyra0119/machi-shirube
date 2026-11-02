// 試し A：API がつながるか・Managed Agents が使えるか。
// 動かし方: npm run try:api （鍵は .env から読む。鍵そのものは画面にも記録にも出さない）
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay } from "../src/cost.mjs";

const MODEL = "claude-opus-5-5";
const client = new Anthropic();

// 1. 短い呼び出しを1回
try {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "高知県黒潮町はどの海に面していますか。1文で答えてください。" }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const usd = record(MODEL, res.usage, "試し A：つながるかの確かめ");
  console.log(`答え: ${text}`);
  console.log(`止まった理由: ${res.stop_reason}`);
  console.log(`トークン: 入力 ${res.usage.input_tokens} / 出力 ${res.usage.output_tokens}`);
  console.log(`この回の費用: $${usd.toFixed(5)}（今日の合計 $${spent(japanDay(new Date().toISOString())).toFixed(5)}）`);
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) console.error("鍵が通りません（401）");
  else if (error instanceof Anthropic.PermissionDeniedError) console.error("権限がありません（403）");
  else if (error instanceof Anthropic.RateLimitError) console.error("上限に当たりました（429）");
  else if (error instanceof Anthropic.APIError) console.error(`API のエラー ${error.status}: ${error.message}`);
  else throw error;
  process.exitCode = 1;
}

// 2. Managed Agents が使えるか（一覧を見るだけ。何も作らない・費用はかからない）
try {
  const page = await client.beta.agents.list();
  console.log(`Managed Agents: 使える（いまあるエージェント ${page.data.length} 件）`);
} catch (error) {
  if (error instanceof Anthropic.APIError) console.error(`Managed Agents: 使えない ${error.status}: ${error.message}`);
  else throw error;
}
