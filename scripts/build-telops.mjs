// 天気コードの決まった言い方：気象庁の予報のページ（https://www.jma.go.jp/bosai/forecast/）の中にある一覧（TELOPS：天気コード → 日本語・英語）を取り出す。
// ほかの言葉の町のページでは、気象庁の長い天気の文の代わりに、この決まった言い方を訳して出す（日本語の文は語の並びがちがい、言葉ごとに訳せないため）
// Claude は使わない。取ったページは local/cache/jma/ にだけ置く
// 動かし方: npm run build:telops
import fs from "node:fs";

const UA = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";
const file = "local/cache/jma/forecast-index.html";
if (!fs.existsSync(file)) {
  fs.mkdirSync("local/cache/jma", { recursive: true });
  fs.writeFileSync(file, await (await fetch("https://www.jma.go.jp/bosai/forecast/", { headers: { "User-Agent": UA } })).text());
}
const html = fs.readFileSync(file, "utf8");
const telops = {};
for (const m of html.matchAll(/(\d{3}):\["[^"]*","[^"]*","\d{3}","([^"]*)","([^"]*)"\]/g)) {
  const ja = JSON.parse(`"${m[2]}"`); // 晴 などをもどす
  telops[m[1]] = { ja, en: m[3] };
}
const n = Object.keys(telops).length;
if (n < 50) throw new Error(`天気コードの一覧が読めませんでした（${n}）`);
fs.writeFileSync("site/data/jma-telops.json", JSON.stringify({
  source: { title: "気象庁ホームページ（天気予報のページの天気コードの一覧）", url: "https://www.jma.go.jp/bosai/forecast/", fetchedAt: new Date().toISOString().slice(0, 10) },
  telops,
}, null, 1));
console.log(`天気コード ${n}（例：101 ${telops["101"]?.ja} / ${telops["101"]?.en}）`);
