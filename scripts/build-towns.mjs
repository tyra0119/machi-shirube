// 市・区の中の町（町・字。丁目はまとめる）の形を作る。
// 動かし方: npm run build:towns -- 28109 11227 …（市区町村コード5けた）
// 元は e-Stat の国勢調査2020 小地域の境界データ（人口・世帯つき）。取ったものは data/raw/estat/（公開しない）
// 出力は site/data/towns/{コード}.json（町・字ごと）と site/data/towns/index.json（作った市・区の一覧）
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import JSZip from "jszip";

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
  // 3. 町・字ごとの年齢（国勢調査2020 小地域 T001082「年齢（5歳階級）別人口」）を足す
  const ages = await ageTable(code.slice(0, 2));
  // 4. 町・字ごとの外国の住民（国勢調査2020 小地域集計 第2表「男女別人口，外国人人口及び世帯数－町丁・字等」）
  const foreign = await foreignTable(code.slice(0, 2));
  const gj = JSON.parse(fs.readFileSync(out, "utf8"));
  let hidden = 0;
  for (const f of gj.features) {
    const fr = foreign.get(f.properties.town);
    if (fr?.hidden) f.properties.foreignHidden = true;
    else if (fr) Object.assign(f.properties, fr);
    const a = ages.get(f.properties.town);
    if (!a) continue;
    if (a.hidden) { f.properties.ageHidden = true; hidden++; continue; }
    Object.assign(f.properties, a.rates);
  }
  fs.writeFileSync(out, JSON.stringify(gj));
  console.log(`${code}: 町・字 ${gj.features.length}（${(fs.statSync(out).size / 1024).toFixed(0)}KB）。年齢の数字が隠されている町・字 ${hidden}`);
}

// 県ごとの第2表を取り（まだ無いときだけ）、町・字（市区町村コード＋町丁字コード4けた）ごとに外国の住民の数と割合を出す。
// 表のファイルの番号は県ごとに違うので、e-Stat の県の一覧のページから読み取る
async function foreignTable(pref) {
  const file = `${RAW}/kokusei/t2-${pref}.csv`;
  if (!fs.existsSync(file)) {
    fs.mkdirSync(`${RAW}/kokusei`, { recursive: true });
    const tclass2 = String(1159873 + Number(pref)).padStart(12, "0"); // 県の一覧（01 北海道 = 000001159874 から県の番号順）
    await sleep(1000);
    const list = await (await fetch(`https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&toukei=00200521&tstat=000001136464&cycle=0&tclass1=000001136472&tclass2=${tclass2}&tclass3val=0`, { headers: { "User-Agent": UA } })).text();
    if (!list.includes(`${pref}：`)) throw new Error(`e-Stat の県の一覧（${pref}）が見つかりません`);
    const id = list.match(/stat_infid=(\d+)"[^>]*>\s*男女別人口，外国人人口及び世帯数/)?.[1];
    if (!id) throw new Error(`第2表（${pref}）の場所が読み取れません`);
    await sleep(1000);
    const res = await fetch(`https://www.e-stat.go.jp/stat-search/file-download?statInfId=${id}&fileKind=1`, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`第2表（${pref}）が取れませんでした（${res.status}）`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const txt = new TextDecoder("shift_jis").decode(fs.readFileSync(file));
  const out = new Map();
  for (const line of txt.split(/\r?\n/)) {
    const r = line.split(",").map((s) => s.replace(/^"|"$/g, "")).slice(1); // いちばん左は行番号
    // 地域階層レベル：2 = 丁目のない町・字、3 = 丁目をまとめた町・字
    if (!/^\d{5}$/.test(r[0]) || !/^\d{4}$/.test(r[1]) || (r[2] !== "2" && r[2] !== "3")) continue;
    const total = /^\d+$/.test(r[10]) ? Number(r[10]) : null;
    const foreigners = /^\d+$/.test(r[13]) ? Number(r[13]) : r[13] === "-" ? 0 : null;
    if (r[3] || total === null || foreigners === null) { out.set(r[0] + r[1], { hidden: true }); continue; }
    if (!total) continue;
    out.set(r[0] + r[1], { foreigners, foreignRate: Math.round((foreigners / total) * 1000) / 10 });
  }
  return out;
}

// 県ごとの年齢の表を取り（まだ無いときだけ）、町・字（KEY_CODE 9けた）ごとに割合を出す
async function ageTable(pref) {
  const zip = `${RAW}/stats/T001082-${pref}.zip`;
  if (!fs.existsSync(zip)) {
    fs.mkdirSync(`${RAW}/stats`, { recursive: true });
    await sleep(1000);
    const res = await fetch(`https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001082&code=${pref}&downloadType=2`, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`年齢の表（${pref}）が e-Stat から取れませんでした（${res.status}）`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const files = (await JSZip.loadAsync(fs.readFileSync(zip))).files;
  const txt = new TextDecoder("shift_jis").decode(await files[Object.keys(files).find((n) => n.endsWith(".txt"))].async("uint8array"));
  const head = txt.split(/\r?\n/)[0].split(",");
  const col = (id) => head.indexOf(id);
  const [U15, A1564, O65, O75] = ["T001082017", "T001082018", "T001082019", "T001082020"].map(col);
  const out = new Map();
  for (const line of txt.split(/\r?\n/).slice(2)) {
    const r = line.split(",");
    // 段：2 = 丁目のない町・字、3 = 丁目をまとめた町・字（4 は丁目、1 は市区町村）
    if (r[1] !== "2" && r[1] !== "3") continue;
    const n = (i) => (/^\d+$/.test(r[i]) ? Number(r[i]) : r[i] === "-" ? 0 : null); // 「-」は 0、「*」「X」は隠されている
    const [u15, a1564, o65, o75] = [U15, A1564, O65, O75].map(n);
    // 秘匿の処理：1 = 隠した、2 = 隣の町・字と合わせた
    if (r[4] === "1" || r[4] === "2" || [u15, a1564, o65].includes(null)) { out.set(r[0], { hidden: true }); continue; }
    const known = u15 + a1564 + o65; // 年齢の分かっている人
    if (!known) continue;
    const pct = (v) => Math.round((v / known) * 1000) / 10;
    out.set(r[0], { rates: { under15Rate: pct(u15), over65Rate: pct(o65), over75Rate: o75 === null ? null : pct(o75) } });
  }
  return out;
}

// 3. 作った市・区の一覧と、名前で探すための町・字の名前（[市区町村コード, 町・字の番号, 名前]）
const done = fs.readdirSync(OUT).filter((f) => /^\d{5}\.json$/.test(f)).map((f) => f.slice(0, 5)).sort();
const names = done.flatMap((code) =>
  JSON.parse(fs.readFileSync(`${OUT}/${code}.json`, "utf8")).features.map((f) => [code, f.properties.part, f.properties.name]),
);
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify({
  source: "国勢調査 2020年（令和2年）小地域の境界データ・年齢（5歳階級）別人口・小地域集計 第2表（外国人人口）（総務省統計局、e-Stat）を加工して作成",
  asOf: "2020年10月1日",
  codes: done,
  names,
}));
