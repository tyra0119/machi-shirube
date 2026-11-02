// 町の特徴（その町ならではのページを出すかどうか）を、国の数字から決める。手元で動かし、公開してよい結果だけを書き出す。
// 動かし方: npm run build:features（先に build:industry と build:flags）
// 出力 site/data/features.json：コード → 特徴の並び（町のページと、Claude に聞く問いを選ぶのに使う）
// 決まり（全国の市区町村と比べた数字。めやす）：
//  - 農業：働く人のうち農業・林業が 8% 以上か、全国で高いほうから 25% 以内
//  - 漁業：働く人のうち漁業が 2% 以上か、全国で高いほうから 10% 以内（かつ 0.5% 以上）
//  - 雪：豪雪地帯・特別豪雪地帯（国土数値情報 A22）
//  - 火山：火山災害警戒地域（内閣府）
//  - 島：離島振興対策実施地域がある（国土数値情報 A19）
import fs from "node:fs";

const industry = JSON.parse(fs.readFileSync("site/data/industry.json", "utf8")).towns;
const flags = JSON.parse(fs.readFileSync("site/data/flags.json", "utf8")).flags;
const out = {};
const add = (code, f) => (out[code] ??= []).push(f);
for (const [code, t] of Object.entries(industry)) {
  if (t.agri >= 8 || t.agriTop <= 25) add(code, "nougyou");
  if ((t.fish >= 2 || t.fishTop <= 10) && t.fish >= 0.5) add(code, "gyogyou");
}
for (const [code, f] of Object.entries(flags)) {
  if (f.snow) add(code, "yuki");
  if (f.volcano) add(code, "kazan");
  if (f.island) add(code, "shima");
}
fs.writeFileSync("site/data/features.json", JSON.stringify({
  rules: "農業：農業・林業 8%以上か全国の上から25%以内／漁業：漁業 2%以上か上から10%以内（0.5%以上）／雪：豪雪地帯／火山：火山災害警戒地域／島：離島がある",
  towns: out,
}));
const count = (f) => Object.values(out).filter((x) => x.includes(f)).length;
console.log(`農業 ${count("nougyou")}・漁業 ${count("gyogyou")}・雪 ${count("yuki")}・火山 ${count("kazan")}・島 ${count("shima")}`);
for (const c of ["39428", "10524", "11227", "28109"]) console.log(c, out[c]);
