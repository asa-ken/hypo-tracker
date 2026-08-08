// 非表示から戻した指標が一覧の末尾へ飛ぶと、6件ごとの指標グリッドで2ページ目に押し出され、
// 1ページ目が「データなし」だけになって数字を見つけられなくなる。
//  ・戻す位置は既定の並びでの位置(末尾ではない)
//  ・すでに並びが崩れているデータは「並び順を既定に戻す」で組み直せる
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  const pages = () => p.evaluate(() => [...document.querySelectorAll('#view .metric')]
    .map(g => [...g.querySelectorAll('.m')].map(c => c.querySelector('.k').textContent)));

  // ---- 1. 非表示→表示で位置が動かない(PR #60の担保) ----
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id)); await p.waitForTimeout(350);
  const order0 = await p.evaluate(() => DB.metricsMaster.snap.slice());
  await p.evaluate(() => { toggleMetric('snap', 'PER(予想)'); toggleMetric('snap', 'PER(予想)'); });
  await p.waitForTimeout(350);
  ok('切り替えても並び順は動かない', JSON.stringify(await p.evaluate(() => DB.metricsMaster.snap)) === JSON.stringify(order0));

  // ---- 2. 旧データ(別リストへ退避済み)を戻すとき、末尾ではなく既定の位置に入る ----
  await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hypo_tracker_proto_v1'));
    // 旧実装で「PER(予想)を非表示」にした状態。一覧からは取り除かれている
    db.metricsMaster.snap = db.metricsMaster.snap.filter(k => k !== 'PER(予想)');
    db.metricsMaster.hiddenSnap = ['PER(予想)'];
    db.metricsMaster.trend = db.metricsMaster.trend.filter(t => t.name !== '営業利益');
    db.metricsMaster.hiddenTrend = [{ name: '営業利益', graph: true }];
    localStorage.setItem('hypo_tracker_proto_v1', JSON.stringify(db));
  });
  await p.reload(); await p.waitForTimeout(450);
  const mig = await p.evaluate(() => ({ snap: DB.metricsMaster.snap.slice(), trend: DB.metricsMaster.trend.map(t => t.name) }));
  ok('既定で先頭の指標は先頭に戻る(末尾に飛ばない)', mig.snap[0] === 'PER(予想)');
  ok('元の並びがそのまま復元される', JSON.stringify(mig.snap) === JSON.stringify(order0));
  ok('業績推移も既定の位置に戻る', JSON.stringify(mig.trend) === JSON.stringify(['売上高', '営業利益', 'EPS']));
  ok('戻したうえで非表示中のまま', await p.evaluate(() =>
    DB.metricsMaster.hiddenSnap.includes('PER(予想)') && DB.metricsMaster.hiddenTrend.includes('営業利益')));

  // ---- 3. 数値を1つしか持たない銘柄でも、その指標が1ページ目に出る ----
  await p.evaluate(() => {
    DB.metricsMaster.hiddenSnap = []; DB.metricsMaster.hiddenTrend = [];
    // 実際の使われ方に合わせ、指標が7件以上あってページャーが出る状態にする
    ['時価総額', '信用倍率', '目標株価コンセンサス'].forEach(k => { if (!DB.metricsMaster.snap.includes(k)) DB.metricsMaster.snap.push(k); });
    DB.stocks.push({ id: '9993', name: '数値が1つだけの銘柄', code: '9993', kind: '保有',
      metrics: { 'PER(予想)': { v: '9.8', unit: '倍', d: '2026/3/10' } }, trend: {}, sections: {}, links: [] });
    save(); openStock('9993');
  });
  await p.waitForTimeout(400);
  const pg = await pages();
  ok('指標が7件以上あるとページャーになる(テスト前提)', pg.length >= 2);
  ok('数値を持つ指標が1ページ目に出る', pg[0].includes('PER(予想)'));
  ok('1ページ目が「データなし」だけにならない', await p.evaluate(() =>
    [...document.querySelectorAll('#view .metric')][0].innerText.replace(/データなし/g, '').includes('9.8')));

  // ---- 4. すでに並びが崩れているデータは「並び順を既定に戻す」で直せる ----
  await p.evaluate(() => {
    // 旧実装の復元(末尾へpush)で崩れた並びを再現する
    DB.metricsMaster.snap = ['PBR', '時価総額', '配当利回り(予想)', '信用倍率', '営業利益率', '自己資本比率', 'ROE', '目標株価コンセンサス', 'PER(予想)'];
    save(); render();
  });
  await p.waitForTimeout(350);
  const broken = await pages();
  ok('崩れた並びでは1ページ目に数値が出ない(前提の再現)', !broken[0].includes('PER(予想)'));

  await p.evaluate(() => { sheetMetricsMaster(); resetMetricOrder(); }); await p.waitForTimeout(300);
  ok('確認をはさんでから並び替える', await p.evaluate(() => /並び順を既定に戻す/.test(document.querySelector('#sheet h3').textContent)));
  ok('表示中/非表示中は変えないと明記する', await p.evaluate(() => /表示中\/非表示中の設定と、取り込み済みの数値は変わりません/.test(document.querySelector('#sheet').innerText)));
  await p.evaluate(() => runConfirm()); await p.waitForTimeout(500);
  const fixed = await p.evaluate(() => DB.metricsMaster.snap.slice());
  ok('既定にある指標が既定の順に並び直る', JSON.stringify(fixed.slice(0, 6)) === JSON.stringify(['PER(予想)', 'PBR', 'ROE', '営業利益率', '自己資本比率', '配当利回り(予想)']));
  ok('既定に無い指標は今の順のまま後ろに続く', JSON.stringify(fixed.slice(6)) === JSON.stringify(['時価総額', '信用倍率', '目標株価コンセンサス']));
  ok('指標は1つも増減しない', fixed.length === 9);

  await p.evaluate(() => closeSheet()); await p.waitForTimeout(350);
  const after = await pages();
  ok('並び替えると数値が1ページ目に戻る', after[0].includes('PER(予想)'));

  // 表示中/非表示中と取り込み済みの数値は触らない
  await p.evaluate(() => { toggleMetric('snap', 'PBR'); closeSheet(); }); await p.waitForTimeout(300);
  await p.evaluate(() => { sheetMetricsMaster(); resetMetricOrder(); }); await p.waitForTimeout(250);
  await p.evaluate(() => runConfirm()); await p.waitForTimeout(450);
  ok('並び替えても非表示中の設定は残る', await p.evaluate(() => DB.metricsMaster.hiddenSnap.includes('PBR')));
  ok('並び替えても数値は変わらない', await p.evaluate(() => stock('9993').metrics['PER(予想)'].v === '9.8'));

  // ---- 5. 市場カード側にも同じ入口がある ----
  await p.evaluate(() => { closeSheet(); backFromDetail(); openStock(DB.stocks.find(s => s.kind === '市場').id); });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const m = curScopeMet();
    m.snap = ['為替(USD/JPY)', '長期金利(10年)', '予想PER(市場全体)'];   // 崩れた並び
    save(); sheetMarketMetricsMaster();
  });
  await p.waitForTimeout(300);
  ok('市場の設定にも「並び順を既定に戻す」がある', await p.evaluate(() =>
    [...document.querySelectorAll('#sheet button')].some(b => b.textContent.trim() === '並び順を既定に戻す')));
  await p.evaluate(() => resetMarketMetricOrder()); await p.waitForTimeout(250);
  await p.evaluate(() => runConfirm()); await p.waitForTimeout(450);
  ok('市場の指標も既定の順に戻る', JSON.stringify(await p.evaluate(() => curScopeMet().snap)) ===
    JSON.stringify(['予想PER(市場全体)', '長期金利(10年)', '為替(USD/JPY)']));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
