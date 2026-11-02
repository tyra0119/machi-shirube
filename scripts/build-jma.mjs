// 市区町村コード（5けた）→ 気象庁の地域（警報の市町村・予報の一次細分区域・府県予報区）の表を作る。
// 動かし方: npm run build:jma（入力 data/raw/jma-area.json＝気象庁 https://www.jma.go.jp/bosai/common/const/area.json を取ったもの）
// 出力 site/data/jma.json。町のページが、見る人のブラウザで気象庁の予報・警報をその場で読むときに使う
import fs from "node:fs";

const UA = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";
const RAW = "data/raw/jma-area.json";
if (!fs.existsSync(RAW)) {
  const res = await fetch("https://www.jma.go.jp/bosai/common/const/area.json", { headers: { "User-Agent": UA } });
  fs.mkdirSync("data/raw", { recursive: true });
  fs.writeFileSync(RAW, Buffer.from(await res.arrayBuffer()));
}
const area = JSON.parse(fs.readFileSync(RAW, "utf8"));
const out = {};
for (const [c20, a] of Object.entries(area.class20s)) {
  const code = c20.slice(0, 5); // 7けた（市区町村コード5けた＋2けた）。分けている市町村は最初の1つで代表させる
  if (out[code]) continue;
  const c15 = area.class15s[a.parent];
  const c10 = c15 && area.class10s[c15.parent];
  if (!c10) continue;
  out[code] = { class20: c20, class10: c15.parent, class10Name: c10.name, office: c10.parent, officeName: area.offices[c10.parent]?.name };
}
fs.writeFileSync("site/data/jma.json", JSON.stringify(out));
console.log(`市区町村 ${Object.keys(out).length}`);
for (const c of ["39428", "10524", "11227", "28109"]) console.log(c, JSON.stringify(out[c]));
