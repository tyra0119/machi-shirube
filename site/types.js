// 深掘りの型の候補：全国の市区町村と比べた数字と、国の一覧の印から、決まりに当てはめて選ぶ（Claude は使わない）。
// ここで出すのは「候補」。この町で本当に情報が届きにくいのは誰かは、町を調べるときに Claude が公式の資料から見立て、人が確かめる
// t：stats.json の町、f：flags.json の印、s：stats.json の境目（summary）
function typeCandidates(t, f, s) {
  const out = [];
  const add = (type, who, reason, strength) => out.push({ type, who, reason, strength });
  const p = (v) => `${v.toFixed(1)}%`;
  // 上からの位置（0〜100）を、強さ（0〜1）に。境目ちょうどで 0、全国一で 1 に近い
  const from = (top, edge) => Math.max(0, (edge - top) / edge);

  if (t.foreignRate >= s.foreignRate.top10) {
    add("母語で防災", "外国から来て暮らす人",
      `外国の住民が ${p(t.foreignRate)}（全国の上から10%の境目は ${p(s.foreignRate.top10)}）`,
      0.5 + from(t.top.foreignRate, 10) / 2 + (t.foreignRate >= s.foreignRate.top5 ? 0.3 : 0));
  }
  if ((t.socialChangeRate >= s.socialChangeRate.top10 || t.changeRate >= s.changeRate.top10) && t.over65Rate <= s.over65Rate.bottom10) {
    add("はじめての町", "引っ越してきた人・若い家族",
      `引っ越しで人が増えていて（1年で ${t.socialChangeRate > 0 ? "+" : ""}${p(t.socialChangeRate)}）、65歳以上は ${p(t.over65Rate)} と少ない`,
      0.6 + from(t.top.socialChangeRate, 10) / 3);
  }
  if (t.changeRate <= s.changeRate.bottom10 && t.over65Rate >= s.over65Rate.top10) {
    add("人が減る町の暮らし", "町に残る人・一人暮らしのお年寄り",
      `1年で人口が ${p(t.changeRate)}、65歳以上が ${p(t.over65Rate)}（どちらも全国の上下10%に入る）`,
      0.6 + from(t.top.over65Rate, 10) / 3);
  }
  if (f.snow === "特別豪雪地帯" || (f.snow && t.over65Rate >= s.over65Rate.top20)) {
    add("雪の暮らし", "雪下ろしや雪かきが難しいお年寄り",
      f.snow === "特別豪雪地帯" ? `特別豪雪地帯（65歳以上は ${p(t.over65Rate)}）` : `豪雪地帯で、65歳以上が ${p(t.over65Rate)}（全国の上から20%に入る）`,
      f.snow === "特別豪雪地帯" ? 0.8 : 0.55);
  }
  if (f.volcano) add("火山と暮らす", "火山のふもとに住む人・訪れる人", "火山災害警戒地域に入っている", 0.7);
  if (f.island) add("島の暮らし", "島に住む人（船や飛行機が止まると行き来できなくなる）", "離島振興対策実施地域の島がある", 0.6);
  if (t.elderlySingleRate != null && t.elderlySingleRate >= s.elderlySingleRate.top10) {
    add("一人暮らしのお年寄り", "見守りや避難の声かけが届きにくい、一人で暮らすお年寄り",
      `65歳以上の一人暮らしの世帯が ${p(t.elderlySingleRate)}（全国の上から10%の境目は ${p(s.elderlySingleRate.top10)}）`,
      0.5 + (t.elderlySingleRate >= s.elderlySingleRate.top5 ? 0.3 : 0.1));
  }
  return out.sort((a, b) => b.strength - a.strength).slice(0, 3);
}

// まだ計算していないので候補にできない型（町を調べるときに計算する）
const TYPES_LATER = "わが家の避難（浸水・津波）・水と揺れ・坂の地図は、浸水・揺れ・坂を計算してから候補にします。";

function typeCandidatesHTML(t, f, s) {
  const list = typeCandidates(t, f, s);
  const items = list.length
    ? `<ol class="types">${list.map((c) => `<li><span class="type">${c.type}</span><span class="who">${c.who}</span><span class="why">${c.reason}</span></li>`).join("")}</ol>`
    : `<p>全国の数字と国の一覧からは、目立つ型は見つかりませんでした。</p>`;
  return `${items}<p class="note">全国の数字と国の一覧に、決まりを当てはめた候補です。${TYPES_LATER}本当に届きにくいのは誰かは、町を調べるときに Claude が公式の資料から見立て、人が確かめます。</p>`;
}
