// 市・区の中の町（町・字。丁目はまとめる）の形を作る。
// 動かし方: npm run build:towns -- 28109 11227 …（市区町村コード5けた）
// 元は e-Stat の国勢調査2020 小地域の境界データ（人口・世帯つき）。取ったものは data/raw/estat/（公開しない）
// 出力は site/data/towns/{コード}.json（町・字ごと）と site/data/towns/index.json（作った市・区の一覧）
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const UA = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";
const RAW = "data/raw/estat";
const OUT = "site/data/towns";
const codes = process.argv.slice(2).filter((c) => /^\d{5}$/.test(c));
if (!codes.length) throw new Error("市区町村コード（5けた）を1つ以上渡してください");
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mapshaper = (args) =>
  execFileSync(process.execPath, ["node_modules/mapshaper/bin/mapshaper", ...args], { stdio: ["ignore", "pipe", "pipe"] });

for (const code of codes) {
  // 1. 取る（まだ無いときだけ。名乗って、1秒以上あける）
  const zip = `${RAW}/A002005212020-${code}.zip`;
  if (!fs.existsSync(zip)) {
    await sleep(1000);
    const url = `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=${code}&coordSys=1&format=shape&downloadType=5&datum=2011`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${code}: e-Stat から取れませんでした（${res.status}）`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  // 2. 丁目を町・字にまとめ、人口と世帯を足す。名前の「〇丁目」を外す（zip はそのまま読める）
  const out = `${OUT}/${code}.json`;
  mapshaper([
    zip, "encoding=shiftjis",
    "-each", "town=KEY_CODE.slice(0,9), part=KIHON1, name=S_NAME.replace(/[一二三四五六七八九十〇0-9０-９]+丁目$/, '')",
    "-dissolve", "town", "copy-fields=part,name", "sum-fields=JINKO,SETAI",
    "-rename-fields", "population=JINKO,households=SETAI",
    "-simplify", "40%", "keep-shapes",
    "-o", out, "format=geojson", "precision=0.00001",
  ]);
  const gj = JSON.parse(fs.readFileSync(out, "utf8"));
  console.log(`${code}: 町・字 ${gj.features.length}（${(fs.statSync(out).size / 1024).toFixed(0)}KB）`);
}

// 3. 作った市・区の一覧と、名前で探すための町・字の名前（[市区町村コード, 町・字の番号, 名前]）
const done = fs.readdirSync(OUT).filter((f) => /^\d{5}\.json$/.test(f)).map((f) => f.slice(0, 5)).sort();
const names = done.flatMap((code) =>
  JSON.parse(fs.readFileSync(`${OUT}/${code}.json`, "utf8")).features.map((f) => [code, f.properties.part, f.properties.name]),
);
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify({
  source: "国勢調査 2020年（令和2年）小地域の境界データ（総務省統計局、e-Stat）を加工して作成",
  asOf: "2020年10月1日",
  codes: done,
  names,
}));
