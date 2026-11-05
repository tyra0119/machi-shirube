// 訳のファイルを、言葉ごとの小さなファイルに分ける（町のページをほかの言葉で見るときは、その言葉の分だけを読む）。
// site/data/translations/{コード}.json → {コード}.{言葉}.json、{コード}-ai.json → {コード}-ai.{言葉}.json
// ほかの言葉は名前（ボタンの字）だけを残す。もとのファイルはそのまま（日本語で見るとき・回覧板・調べる画面が使う）
// 動かし方: npm run split-tr（訳を作る scripts/translate.mjs・translate-ai.mjs の最後にも自動で動く）
import fs from "node:fs";

const DIR = "site/data/translations";
export function splitTranslations(only) {
  let n = 0;
  for (const f of fs.readdirSync(DIR)) {
    const m = f.match(/^(\d{5}(?:-\d{4})?)(-ai)?\.json$/);
    if (!m || (only && m[1] !== only)) continue;
    const t = JSON.parse(fs.readFileSync(`${DIR}/${f}`, "utf8"));
    for (const lang of Object.keys(t.langs ?? {})) {
      const langs = Object.fromEntries(Object.entries(t.langs).map(([l, L]) => [l, l === lang ? L : { name: L.name, ja: L.ja }]));
      fs.writeFileSync(`${DIR}/${m[1]}${m[2] ?? ""}.${lang}.json`, JSON.stringify({ ...t, langs, only: lang }));
      n++;
    }
  }
  return n;
}

if (process.argv[1]?.endsWith("split-translations.mjs")) console.log(`言葉ごとのファイル ${splitTranslations(process.argv[2])} 個`);
