// 指標名の表記揺れ検出。index.html の同名の関数と対になる影武者。
// 「売上高」と「売上」のように同じものを別名で受け取ると、別々の指標として登録され、
// グラフも履歴も分かれてしまう。根本の対策は説明書(briefingText)で外部AIの表記を
// 揃えることだが、それでも漏れる分を取り込み前に知らせるための判定をここに置く。
// CommonJS のまま維持すること(index.html が <script src> で読む前提のため)。

// 括弧の全半角・空白・記号の有無だけの違いを同一視するための正規化
function metNorm(s) {
  return String(s)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/[\s　・()%％,，]/g, '')
    .toLowerCase();
}

function metBigrams(s) {
  const a = [];
  for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2));
  return a.length ? a : [s];
}

// 0〜1。1に近いほど同じ指標を指している可能性が高い
function metSim(a, b) {
  const x = metNorm(a), y = metNorm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;                        // 括弧や記号の違いだけ (営業利益率 と 営業利益率(%))
  if (x.includes(y) || y.includes(x)) return .9; // 一方が他方を含む (売上高 と 売上)
  // 語順が入れ替わっただけの別名(PER(予想) と 予想PER)を拾うため、2文字組の一致率で見る
  const A = metBigrams(x), B = metBigrams(y), rest = B.slice();
  let hit = 0;
  A.forEach(g => { const i = rest.indexOf(g); if (i >= 0) { hit++; rest.splice(i, 1); } });
  return 2 * hit / (A.length + B.length);
}

const MET_SIM_MIN = .6;   // これ未満は別物とみなす (ROE と ROIC が引っかからない水準)

function nearestMetric(name, list) {
  let best = null, bs = 0;
  (list || []).forEach(k => { const v = metSim(name, k); if (v > bs) { bs = v; best = k; } });
  return bs >= MET_SIM_MIN ? { name: best, score: bs } : null;
}

// 取り込むとマスターに新しく追加される指標を洗い出す。
// 追加先の判定は commitImport と揃えること(スナップショットは粒度ごとのマスター、業績推移は銘柄用)。
// snapNames … 取り込み先カードの粒度に対応するスナップショット指標の一覧
// trendNames … 銘柄用の業績推移の指標の一覧。isMarket のカードでは業績推移を持たない
function newMetricsIn(rows, snapNames, trendNames, isMarket) {
  const out = [];
  (rows || []).forEach(r => {
    if (/指標/.test(r.block || '')) {
      if (!(snapNames || []).includes(r.key)) out.push({ name: r.key, kind: 'snap', near: nearestMetric(r.key, snapNames) });
    } else if (/業績|推移/.test(r.block || '')) {
      if (isMarket) return;
      if (!(trendNames || []).includes(r.key)) out.push({ name: r.key, kind: 'trend', near: nearestMetric(r.key, trendNames) });
    }
  });
  // 同じ名前が複数行にあっても知らせるのは1回
  return out.filter((x, i) => out.findIndex(y => y.name === x.name && y.kind === x.kind) === i);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { metNorm, metSim, nearestMetric, newMetricsIn, MET_SIM_MIN };
}
