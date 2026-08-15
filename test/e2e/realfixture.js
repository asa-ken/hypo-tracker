// 実運用規模のfixture(realdata.json)が、意図した「厳しさ」を保っていることを確認する。
// このfixtureは Phase 1 の「多件数」状態の観察に使う(UI_REVIEW_LOOP.md 参照)。
// testdata.json は小さく安定していることに価値があるが、そちらだけで観察すると
// 実運用でしか出ない崩れ(長い指標名で数値列が隠れる、表が伸びてグラフが画面外になる等)を
// 構造的に見逃す。fixtureが痩せていくと観察の網も同時に粗くなるため、規模を機械で固定する。
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/realdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(d === undefined ? v : d));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(500);

  // ---- 1. migrate() を通しても規模が痩せない ----
  // 別名統合(売上→売上高 等)で指標が畳まれる名前を使っていると、読み込むたびに件数が減り、
  // 「多件数の観察」のつもりが実質 testdata.json と変わらない規模になってしまう
  const m = await p.evaluate(() => ({
    trend: DB.metricsMaster.trend.length,
    snap: DB.metricsMaster.snap.length,
    longest: Math.max(...DB.metricsMaster.trend.map(t => t.name.length)),
    stocks: DB.stocks.length,
  }));
  ok('業績推移が15指標以上ある(表が縦に伸びる状態を作れる)', m.trend >= 15, m.trend);
  ok('12文字以上の指標名がある(列幅・折り返しの崩れを作れる)', m.longest >= 12, m.longest);
  ok('スナップショット指標が5件以上ある', m.snap >= 5, m.snap);

  // ---- 2. 通常・ゼロ状態・市場カードが同一fixture内に同居している ----
  // 別fixtureに分けると「多いときは見たがゼロは見ていない」が起きやすい
  const kinds = await p.evaluate(() => ({
    heavy: DB.stocks.filter(s => Object.keys(s.sections || {}).length >= 10).length,
    empty: DB.stocks.filter(s => !Object.keys(s.sections || {}).length
      && !Object.keys(s.trend || {}).length && !Object.keys(s.metrics || {}).length).length,
    partial: DB.stocks.filter(s => { const n = Object.keys(s.sections || {}).length; return n > 0 && n < 10; }).length,
    market: DB.stocks.filter(s => isMkt(s)).length,
  }));
  ok('データが揃った銘柄がある', kinds.heavy >= 1, kinds.heavy);
  ok('歯抜けの銘柄がある', kinds.partial >= 1, kinds.partial);
  ok('1件も入っていない銘柄がある(ゼロ状態が同居している)', kinds.empty >= 1, kinds.empty);
  ok('市場・業界カードもある', kinds.market >= 1, kinds.market);

  // ---- 3. 年度列が複数あり、横スクロールが起きる規模になっている ----
  await p.evaluate(() => openStock('6151'));
  await p.waitForTimeout(400);
  const tbl = await p.evaluate(() => {
    const t = document.querySelector('#view table.trend');
    const box = document.querySelector('.trend-scroll');
    return {
      cols: t.rows[0].cells.length - 1,
      rows: t.rows.length - 1,
      xScroll: box.scrollWidth > box.clientWidth + 1,
      yScroll: box.scrollHeight > box.clientHeight + 1,
    };
  });
  ok('年度が4列以上ある', tbl.cols >= 4, tbl.cols);
  ok('横スクロールが実際に発生する', tbl.xScroll);
  ok('縦スクロールが実際に発生する(5行を超えている)', tbl.yScroll, { rows: tbl.rows });

  // ---- 4. セクション名がすべてマスターに解決する ----
  // 解決しない名前を書くと、その項目は画面に出ず、埋まっているつもりの観察が空振りする
  const unresolved = await p.evaluate(() => {
    const bad = [];
    DB.stocks.forEach(s => {
      const all = []; masterFor(s).forEach(c => c.subs.forEach(x => all.push(x)));
      Object.keys(s.sections || {}).forEach(k => { if (!all.includes(k)) bad.push(s.name + ':' + k); });
    });
    return bad;
  });
  ok('全セクション名がマスターに解決する(画面に出ずに消える項目が無い)', unresolved.length === 0, unresolved);

  // ---- 5. 注目ポイント・メモ・リマインダーが積み上がった銘柄がある ----
  const stack = await p.evaluate(() => ({
    watch: hyposOf('6151').filter(h => h.kind !== 'memo').length,
    memo: hyposOf('6151').filter(h => h.kind === 'memo').length,
    rems: remOf('6151').length,
  }));
  ok('1銘柄に注目ポイントが複数ある', stack.watch >= 3, stack.watch);
  ok('1銘柄にメモが複数ある', stack.memo >= 2, stack.memo);
  ok('1銘柄にリマインダーが複数ある', stack.rems >= 2, stack.rems);

  // ---- 6. 主要画面が実データ規模でも壊れない ----
  for (const t of ['home', 'analysis', 'import', 'reminder']) {
    await p.evaluate(x => { if (STATE.stockId) backFromDetail(); go(x); }, t);
    await p.waitForTimeout(300);
  }
  ok('主要4画面を実運用規模で開いてもJSエラーが出ない', errs.length === 0, errs);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
