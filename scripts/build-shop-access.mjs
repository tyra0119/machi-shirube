// 買い物の不便：農林水産政策研究所の「食料品アクセス困難人口」（2020年・市町村別。店まで 500m 以上で、車を使うのが難しい65歳以上）から、
// その町の行だけを引用して、全国と並べる。Claude は使わない
// 動かし方: npm run build:shop-access -- 39428 10524 11227
// 国の表（local/cache/maff/2020_table05.xlsx）は手元にだけ置く。表には「転載・再配布は前もって連絡」とあるので、表まるごとは入れない
//   取る所：https://www.maff.go.jp/primaff/seika/fsc/faccess/a_map.html の「表5. 食料品アクセス困難人口の動向（市町村別）」
// OpenStreetMap の店の場所と 250m 四方の人口を重ねる形も試したが、地方の店の載り漏れが大きく（黒潮町で 6 か所）、使わないことにした
import fs from "node:fs";
import ExcelJS from "exceljs";

export async function buildShopAccess(codes, log = console.log) {
  const w = new ExcelJS.Workbook();
  await w.xlsx.readFile("local/cache/maff/2020_table05.xlsx");
  const rows = new Map();
  let n = 0, base = 0, n75 = 0, base75 = 0;
  w.worksheets[0].eachRow((r, i) => {
    if (i < 8) return;
    const v = r.values.slice(1).map((x) => (x?.result != null ? x.result : x));
    if (!/^\d{5}$/.test(String(v[1] ?? ""))) return;
    rows.set(String(v[1]), v);
    if (v[3] && v[4]) { n += Number(v[3]); base += Number(v[3]) / (Number(v[4]) / 100); }
    if (v[5] && v[6]) { n75 += Number(v[5]); base75 += Number(v[5]) / (Number(v[6]) / 100); }
  });
  const r10 = (v) => Math.round(v / 10) * 10;
  const r1 = (v) => Math.round(v * 10) / 10;
  for (const code of codes) {
    const v = rows.get(code);
    if (!v) { log(`${code}：表にありません`); continue; }
    const out = {
      code, year: 2020, createdAt: new Date().toISOString(),
      people: r10(Number(v[3])), rate: r1(Number(v[4])), over75: r10(Number(v[5])), rate75: r1(Number(v[6])),
      nationRate: r1((n / base) * 100), nationRate75: r1((n75 / base75) * 100),
      past: { 2005: r1(Number(v[7])), 2010: r1(Number(v[9])), 2015: r1(Number(v[11])) },
      note: "食料品アクセス困難人口は、食料品を買える店（スーパー・コンビニ・ドラッグストア・精肉・鮮魚・青果の店など）まで 500m 以上あり、車を使うのが難しい65歳以上の人の推計です。2015年以前は定義とデータがちがうので、そのまま比べられません",
      sources: [{ title: "農林水産政策研究所 食料品アクセスマップ（2020年 食料品アクセス困難人口・市町村別）より引用", url: "https://www.maff.go.jp/primaff/seika/fsc/faccess/a_map.html" }],
    };
    fs.mkdirSync("site/data/shop-access", { recursive: true });
    fs.writeFileSync(`site/data/shop-access/${code}.json`, JSON.stringify(out, null, 1));
    log(`${code}：65歳以上の ${out.rate}%（約 ${out.people} 人。全国 ${out.nationRate}%）。75歳以上は ${out.rate75}%（全国 ${out.nationRate75}%）`);
  }
}

if (process.argv[1]?.endsWith("build-shop-access.mjs")) await buildShopAccess(process.argv.slice(2));
