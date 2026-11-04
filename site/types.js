// 全国（または市の町・字）の中での位置を、住む人に分かる言葉で言う（作者「『上から ○%』これは分かりにくいからやめよう」）。
// 上から（下から）10番目までは順番で、上から（下から）1割までは「高いほう（低いほう）」と言い、真ん中の値を添える。それ以外は真ん中の値だけ
// rank：高いほうから何番目（同じ値は同じ順位）、total：比べた数、mid：真ん中の値の文字（「1.8%」など）、muni：市の町・字で比べるときの市の名前
function placeWords(rank, total, mid, muni) {
  const tn = typeof TN === "function" ? TN : (s, v) => s.replace(/\{(\w+)\}/g, (a, k) => v[k] ?? a);
  const v = { n: total.toLocaleString("ja-JP"), muni, m: mid };
  const low = total - rank + 1;
  const word = muni
    ? (rank <= 10 && rank <= total / 2 ? tn("{muni}の {n} の町・字で {r} 番目に高い", { ...v, r: rank })
      : low <= 10 && low < total / 2 ? tn("{muni}の {n} の町・字で {r} 番目に低い", { ...v, r: low })
      : "")
    : (rank <= 10 ? tn("全国 {n} の市区町村で {r} 番目に高い", { ...v, r: rank })
      : low <= 10 ? tn("全国 {n} の市区町村で {r} 番目に低い", { ...v, r: low })
      : rank <= total / 10 ? tn("全国でも高いほう", v)
      : low <= total / 10 ? tn("全国でも低いほう", v)
      : "");
  if (mid == null) return word;
  const m = muni ? tn("{muni}の町・字の真ん中は {m}", v) : tn("全国の真ん中は {m}", v);
  return word ? `${word}（${m}）` : m;
}

// 深掘りの型の候補：全国の市区町村と比べた数字と、国の一覧の印から、決まりに当てはめて選ぶ（Claude は使わない）。
// ここで出すのは「候補」。この町で本当に情報が届きにくいのは誰かは、町を調べるときに Claude が公式の資料から見立て、人が確かめる
// t：stats.json の町、f：flags.json の印、s：stats.json の境目（summary）
// 町のページでは、ほかの言葉に訳す（辞書は scripts/i18n.mjs が LT("…")・LTN("…", を集める）。日本地図の画面では日本語のまま
const typesT = () => ({
  LT: typeof T === "function" ? T : (x) => x,
  LTN: typeof TN === "function" ? TN : (x, v) => x.replace(/\{(\w+)\}/g, (a, k) => v[k] ?? a),
});
function typeCandidates(t, f, s) {
  const { LT, LTN } = typesT();
  const out = [];
  const add = (type, who, reason, strength) => out.push({ type: LT(type), who: LT(who), reason, strength });
  const p = (v) => `${v.toFixed(1)}%`;
  // 上からの位置（0〜100）を、強さ（0〜1）に。境目ちょうどで 0、全国一で 1 に近い
  const from = (top, edge) => Math.max(0, (edge - top) / edge);

  if (t.foreignRate >= s.foreignRate.top10) {
    add("母語で防災", "外国から来て暮らす人",
      LTN("外国の住民が {v}（全国の真ん中は {m}）", { v: p(t.foreignRate), m: p(s.foreignRate.median) }),
      0.5 + from(t.top.foreignRate, 10) / 2 + (t.foreignRate >= s.foreignRate.top5 ? 0.3 : 0));
  }
  if ((t.socialChangeRate >= s.socialChangeRate.top10 || t.changeRate >= s.changeRate.top10) && t.over65Rate <= s.over65Rate.bottom10) {
    add("はじめての町", "引っ越してきた人・若い家族",
      LTN("引っ越しで人が増えていて（1年で {c}）、65歳以上は {o} と少ない", { c: `${t.socialChangeRate > 0 ? "+" : ""}${p(t.socialChangeRate)}`, o: p(t.over65Rate) }),
      0.6 + from(t.top.socialChangeRate, 10) / 3);
  }
  if (t.changeRate <= s.changeRate.bottom10 && t.over65Rate >= s.over65Rate.top10) {
    add("人が減る町の暮らし", "町に残る人・一人暮らしのお年寄り",
      LTN("1年で人口が {c}、65歳以上が {o}（どちらも全国でも目立つ）", { c: p(t.changeRate), o: p(t.over65Rate) }),
      0.6 + from(t.top.over65Rate, 10) / 3);
  }
  if (f.snow === "特別豪雪地帯" || (f.snow && t.over65Rate >= s.over65Rate.top20)) {
    add("雪の暮らし", "雪下ろしや雪かきが難しいお年寄り",
      f.snow === "特別豪雪地帯" ? LTN("特別豪雪地帯（65歳以上は {o}）", { o: p(t.over65Rate) }) : LTN("豪雪地帯で、65歳以上が {o}（全国でも高いほう）", { o: p(t.over65Rate) }),
      f.snow === "特別豪雪地帯" ? 0.8 : 0.55);
  }
  if (f.volcano) add("火山と暮らす", "火山のふもとに住む人・訪れる人", LT("火山災害警戒地域に入っている"), 0.7);
  if (f.island) add("島の暮らし", "島に住む人（船や飛行機が止まると行き来できなくなる）", LT("離島振興対策実施地域の島がある"), 0.6);
  if (t.elderlySingleRate != null && t.elderlySingleRate >= s.elderlySingleRate.top10) {
    add("一人暮らしのお年寄り", "見守りや避難の声かけが届きにくい、一人で暮らすお年寄り",
      LTN("65歳以上の一人暮らしの世帯が {v}（全国の真ん中は {m}）", { v: p(t.elderlySingleRate), m: p(s.elderlySingleRate.median) }),
      0.5 + (t.elderlySingleRate >= s.elderlySingleRate.top5 ? 0.3 : 0.1));
  }
  return out.sort((a, b) => b.strength - a.strength).slice(0, 3);
}


function typeCandidatesHTML(t, f, s) {
  const { LT } = typesT();
  const list = typeCandidates(t, f, s);
  const items = list.length
    ? `<ol class="types">${list.map((c) => `<li><span class="type">${c.type}</span><span class="who">${c.who}</span><span class="why">${c.reason}</span></li>`).join("")}</ol>`
    : `<p>${LT("全国の数字と国の一覧からは、目立つ型は見つかりませんでした。")}</p>`;
  return `${items}<p class="note">${LT("全国の数字と国の一覧に、決まりを当てはめた候補です。くわしく調べた町では、浸水・揺れ・坂・事故・バスなどの国のデータを重ねた数から、AI が見立て直します（町のページのいちばん上）。")}</p>`;
}
