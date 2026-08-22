// 視覚的ノイズ(線の量)の絶対量検査。
//
// これまで `DESIGN_SCORECARD.md` の「視覚的ノイズ」の測定方法は
// 「スクリーンショットを比較し、装飾要素の**追加・削除**を確認」= その周の差分だけを見ていた。
// 各周で新しい枠線を足していないので毎回「視覚的ノイズ=3」が付き続け、一方で線の**絶対量**は
// 周をまたいで蓄積していた。差分を見る指標では、蓄積して閾値を越える種類の劣化は原理的に検出できない。
// 実際にユーザー指摘(「取り込む画面全般的に枠線やエリアの境界線が多くてビジー感があります」)まで
// 気づけなかった。経緯は `REVIEW_BACKLOG.md`「プロセスの欠陥」を参照。
//
// このスイートは画面ごとの線の本数を数え、記録した値と**完全一致**するかを見る。
// 増えたら当然失敗するが、**減った場合も失敗させる**。減ったまま記録を古いままにすると、
// その差分ぶんは無検査で再び積み増せてしまい、まさに直そうとしている蓄積を許すことになる。
// 数が変わったら、BASELINE を更新し、増減の理由を DECISIONS.md に書く。
//
// 数えるのは「実際に描画されている線」。表示されていない要素(display:none、幅0・高さ0)は数えない。
// CSSの字面ではなく実レンダリングを見るのは、条件によって出たり消えたりする線を取りこぼさないため。
//
// 参考(この指標が元の問題を捉えられることの確認、2026-08-22実測):
//   取り込み画面・貼り付け後  PR #155 の前 = 62本 → 後 = 41本(34%減)
//   同・要素総数は 180 → 198 と*増えて*おり、要素数ではなく線の量を測れていることも確認できる。
const { chromium } = require('playwright');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const rd = fs.readFileSync(__dirname + '/fixtures/realdata.json', 'utf8');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

// 時刻を固定する。2026-08-22時点の実測では、日付を変えても下の数値は変わらなかった
// (2027-03-15で試して同値)。ただしリマインダーの「期限切れ/今日/今週」への振り分けが
// 変われば区分見出しの数が変わり、線の数も変わりうる。実行日で落ちるのを防ぐため固定しておく。
const FIXED = new Date('2026-08-22T03:00:00Z');

// 記録した線の本数(2026-08-22実測)。変えるときは増減の理由を DECISIONS.md に書く。
// 減った場合も一致しなくなるので、必ずここも更新する(古い値を残すと、その差分ぶんを
// 無検査で積み増せてしまい、この検査の目的そのものが崩れる)
const BASELINE = {
  'ホーム': 2,
  '市場・銘柄分析': 11,
  'リマインダー': 11,
  '銘柄詳細': 208,
  '取り込み(貼り付け前)': 18,
  '取り込み(貼り付け後)': 41,
};

const MD = `# 銘柄: テスト精機 (9001)
## 指標
- 配当利回り: 2.1 | 単位:% | 基準日 2026/8/20
- PBR: 1.8 | 基準日 2026/8/20
- これは形式に沿っていない行です
- これも読めない行です
## 注目ポイント
- 本文: 決算発表を確認する
- イベント日: 2026/9/10

これは自由文です。メモ候補として拾われます。
もう1つ自由文を置きます。
`;

// 実際に描画されている線(border)の本数を辺単位で数える
const COUNT = () => {
  let lines = 0;
  for (const el of document.querySelectorAll('#view *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
      const st = cs['border' + s + 'Style'];
      if (parseFloat(cs['border' + s + 'Width']) > 0 && st !== 'none' && st !== 'hidden') lines++;
    }
  }
  return lines;
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const got = {};
  const errs = [];

  // ---- 実運用規模のデータで主要画面を測る ----
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install({ time: FIXED });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), rd);
  await p.reload(); await p.waitForTimeout(500);

  for (const [label, screen] of [['ホーム', 'home'], ['市場・銘柄分析', 'analysis'], ['リマインダー', 'reminder']]) {
    await p.evaluate(s => go(s), screen);
    await p.waitForTimeout(350);
    got[label] = await p.evaluate(COUNT);
  }
  // 銘柄詳細は指標数が最も多い銘柄で測る(表が縦に伸びた状態)
  await p.evaluate(() => {
    const st = DB.stocks.slice().sort((a, b) => (b.metrics || []).length - (a.metrics || []).length)[0];
    openStock(st.id);
  });
  await p.waitForTimeout(450);
  got['銘柄詳細'] = await p.evaluate(COUNT);
  await p.close();

  // ---- 取り込み画面は貼り付け内容を固定したいので testdata で測る ----
  const q = await b.newPage({ viewport: { width: 390, height: 844 } });
  q.on('pageerror', e => errs.push(String(e)));
  await q.clock.install({ time: FIXED });
  await q.goto('http://127.0.0.1:8731/index.html');
  await q.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await q.reload(); await q.waitForTimeout(400);
  await q.evaluate(() => go('import')); await q.waitForTimeout(300);
  got['取り込み(貼り付け前)'] = await q.evaluate(COUNT);
  await q.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, MD);
  await q.waitForTimeout(500);
  got['取り込み(貼り付け後)'] = await q.evaluate(COUNT);
  await q.close();

  for (const k of Object.keys(BASELINE)) {
    ok(`${k}: 線の本数が記録どおり(${BASELINE[k]}本)`, got[k] === BASELINE[k],
      got[k] === BASELINE[k] ? undefined : { 記録: BASELINE[k], 実測: got[k], 差: got[k] - BASELINE[k] });
  }
  console.log('実測値:', JSON.stringify(got));
  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
