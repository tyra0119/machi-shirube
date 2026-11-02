// 作品が使った API の費用を数える。残高ではなく「使った額」を、1回ごとに local/costs.jsonl に足していく。
// 値段は 100万トークンあたりのドル（入力・出力）。2026-10 の値段（Claude API の資料の表）。使う前に Console の値段と照らす。
import fs from "node:fs";
import path from "node:path";

const PRICES = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

const LOG = path.join("local", "costs.jsonl");

// Web 検索は 1,000回で $10（1回 $0.01）。web_fetch はトークンの分だけ
const WEB_SEARCH_USD = 0.01;

// キャッシュの読み出しは入力の 0.1 倍、書き込みは 1.25 倍で数える
export function costOf(model, usage) {
  const p = PRICES[model];
  if (!p) throw new Error(`値段の分からないモデル: ${model}`);
  const input =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) * 0.1 +
    (usage.cache_creation_input_tokens ?? 0) * 1.25;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return (input * p.input + (usage.output_tokens ?? 0) * p.output) / 1_000_000 + searches * WEB_SEARCH_USD;
}

// 費用の上限（作品の中で止める。Console のワークスペースの上限とは別）。
// ハッカソンの API の使える額は $500。作者「$500使えるなら、1日の使用量はもっと増やしていいのでは？」（2026-11-02）で、
// 1日 $40（6日で $240。残りは仕上げとやり直しに）にした。合計は $450 で止める（ここで数える額は値段の表からの見積もりなので、$50 の余裕を残す）。
// 作者が決めた日だけ、環境変数 DAILY_LIMIT_USD・TOTAL_LIMIT_USD で変える
export const DAILY_LIMIT_USD = Number(process.env.DAILY_LIMIT_USD ?? 40);
export const TOTAL_LIMIT_USD = Number(process.env.TOTAL_LIMIT_USD ?? 450);

// 1回の呼び出しを記録して、その回の費用を返す。what は人が読める「何のための呼び出しか」
export function record(model, usage, what) {
  const usd = costOf(model, usage);
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const row = {
    at: new Date().toISOString(),
    what,
    model,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    usd,
  };
  fs.appendFileSync(LOG, JSON.stringify(row) + "\n");
  return usd;
}

// これまでに使った額（日付を渡すとその日だけ。日付は日本時間の YYYY-MM-DD）
export function spent(day) {
  if (!fs.existsSync(LOG)) return 0;
  return fs
    .readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((r) => !day || japanDay(r.at) === day)
    .reduce((sum, r) => sum + r.usd, 0);
}

export function japanDay(iso) {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
}
