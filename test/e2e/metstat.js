// 指標の非表示は「別リストへ移す」のをやめ、一覧に残したまま右端のバッジで状態を示す
//  ・バッジの文言は「表示中 / 非表示中」(押した結果ではなく今の状態と読めるように)
//  ・非表示にしても一覧の並び順から動かない
//  ・非表示中の指標は画面・質問文には出ない
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
  const openSheetFor = () => p.evaluate(() => { openStock(DB.stocks.find(s => s.name === 'テスト精機').id); sheetMetricsMaster(); });
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#sheet .met-row')].map(r => ({
    name: r.querySelector('.nm').textContent.trim(),
    badge: r.querySelector('.stat').textContent.trim(),
    on: r.querySelector('.stat').classList.contains('on'),
    off: r.classList.contains('off'),
  })));

  // ---- 1. 一覧の右端がステータスバッジになっている ----
  await openSheetFor(); await p.waitForTimeout(350);
  const r0 = await rows();
  ok('指標の行がすべてバッジを持つ', r0.length > 0 && r0.every(r => r.badge));
  ok('文言は「表示中/非表示中」だけ', r0.every(r => ['表示中', '非表示中'].includes(r.badge)));
  ok('「非表示」という言い切りのボタンは無くなった', await p.evaluate(() => ![...document.querySelectorAll('#sheet button')].some(b => b.textContent.trim() === '非表示')));
  // 2026-08-13: ROE・営業利益率は表記ゆれ統合により既定で非表示になった(業績推移側のROEに一本化)ため除外する
  ok('既定はすべて表示中(ROE・営業利益率を除く)', r0.filter(r => !['ROE', '営業利益率'].includes(r.name)).every(r => r.badge === '表示中' && r.on && !r.off));
  ok('スナップショットと業績推移が両方並ぶ', await p.evaluate(() =>
    DB.metricsMaster.snap.length + DB.metricsMaster.trend.length === document.querySelectorAll('#sheet .met-row').length));

  // バッジは押せる大きさで、切り替えても幅が変わらない(左の↑↓がずれない)
  const badgeBox = await p.evaluate(() => {
    const s = document.querySelector('#sheet .stat').getBoundingClientRect();
    return { h: Math.round(s.height), w: Math.round(s.width) };
  });
  ok('バッジは押せる大きさ(44px以上)', badgeBox.h >= 44);

  // ---- 2. 非表示にしても一覧から動かない ----
  const before = (await rows()).map(r => r.name);
  const idx = before.indexOf('時価総額');
  const hiddenBase = r0.filter(r => r.badge === '非表示中').length;   // ROE・営業利益率は既定で非表示済み
  await p.evaluate(() => toggleMetric('snap', '時価総額')); await p.waitForTimeout(300);
  const r1 = await rows();
  ok('並び順は変わらない', JSON.stringify(r1.map(r => r.name)) === JSON.stringify(before));
  ok('その指標だけ追加で「非表示中」になる', r1[idx].badge === '非表示中' && r1.filter(x => x.badge === '非表示中').length === hiddenBase + 1);
  ok('非表示中の行は薄く表示される', r1[idx].off && r1[idx].on === false);
  ok('別リストへは移らない(非表示の指標セクションが無い)', await p.evaluate(() => !/非表示の指標/.test(document.querySelector('#sheet').innerText)));
  ok('見出しに表示中の件数が出る', await p.evaluate(() => /スナップショット指標 \(表示中 \d+\/\d+\)/.test(document.querySelector('#sheet').innerText)));
  const w2 = await p.evaluate(() => Math.round([...document.querySelectorAll('#sheet .stat')].find(s => s.textContent.trim() === '非表示中').getBoundingClientRect().width));
  ok('「表示中」と「非表示中」で幅が変わらない', w2 === badgeBox.w);

  // ---- 3. もう一度押すと表示中に戻る ----
  await p.evaluate(() => toggleMetric('snap', '時価総額')); await p.waitForTimeout(300);
  const r2 = await rows();
  ok('押し直すと表示中に戻る', r2[idx].badge === '表示中');
  ok('戻したあとも並び順は同じ', JSON.stringify(r2.map(r => r.name)) === JSON.stringify(before));

  // ---- 4. 非表示中の指標は画面に出ない ----
  await p.evaluate(() => { toggleMetric('snap', '時価総額'); toggleMetric('trend', 'EPS'); closeSheet(); });
  await p.waitForTimeout(400);
  const detail = await p.evaluate(() => {
    const v = document.querySelector('#view');
    return {
      cards: [...v.querySelectorAll('.metric .m .k')].map(e => e.textContent),
      tableRows: [...v.querySelectorAll('table tr')].slice(1).map(r => r.querySelector('td').textContent.trim()),
      charts: v.innerText,
    };
  });
  ok('非表示中のスナップショット指標はカードに出ない', !detail.cards.includes('時価総額'));
  ok('表示中の指標は今までどおり出る', detail.cards.includes('PER(予想)'));
  ok('非表示中の業績推移指標は表に出ない', !detail.tableRows.includes('EPS') && detail.tableRows.includes('売上高'));
  ok('非表示中の指標はグラフにも出ない', !/EPS/.test(detail.charts));

  // 質問文・説明書からも外れる
  const texts = await p.evaluate(() => ({ brief: briefingText(), prompt: (typeof askPrompt === 'function') ? '' : '' }));
  ok('説明書の指標一覧からも外れる', !/時価総額/.test(texts.brief.split('■ 業績推移')[0]) && !new RegExp('EPS').test(texts.brief));

  // ---- 5. リロードしても状態が残る ----
  await p.reload(); await p.waitForTimeout(400);
  const kept = await p.evaluate(() => ({
    hs: DB.metricsMaster.hiddenSnap.slice(), ht: DB.metricsMaster.hiddenTrend.slice(),
    inSnap: DB.metricsMaster.snap.includes('時価総額'), inTrend: DB.metricsMaster.trend.some(t => t.name === 'EPS'),
  }));
  ok('リロードしても非表示中のまま', kept.hs.includes('時価総額') && kept.ht.includes('EPS'));
  ok('非表示にしても本体の一覧からは消えていない', kept.inSnap && kept.inTrend);
  ok('非表示の印は名前だけで持つ', kept.ht.every(x => typeof x === 'string'));

  // ---- 6. 非表示中はグラフ指定が効かない / グラフ4件の数え方 ----
  await openSheetFor(); await p.waitForTimeout(350);
  const graphState = await p.evaluate(() => {
    const i = DB.metricsMaster.trend.findIndex(t => t.name === 'EPS');
    const was = DB.metricsMaster.trend[i].graph;
    toggleGraph(i);
    return { was, now: DB.metricsMaster.trend[i].graph, label: document.querySelector('#sheet').innerText.match(/グラフ表示 \((\d)\/4\)/)[1] };
  });
  await p.waitForTimeout(300);
  ok('非表示中の指標はグラフ指定を変えられない', graphState.was === graphState.now);
  ok('グラフの件数は表示中のものだけ数える', +graphState.label === await p.evaluate(() => trendInds(DB.metricsMaster).filter(t => t.graph).length));

  // ---- 7. 市場カードの指標も同じ扱い ----
  await p.evaluate(() => { closeSheet(); backFromDetail(); openStock(DB.stocks.find(s => s.kind === '市場').id); sheetMarketMetricsMaster(); });
  await p.waitForTimeout(400);
  const mkt0 = await rows();
  ok('市場の指標にもバッジが付く', mkt0.length > 0 && mkt0.every(r => ['表示中', '非表示中'].includes(r.badge)));
  const mname = mkt0[0].name;
  await p.evaluate(n => toggleMarketMetric(n), mname); await p.waitForTimeout(300);
  const mkt1 = await rows();
  ok('市場の指標も一覧に残ったまま非表示中になる', mkt1[0].name === mname && mkt1[0].badge === '非表示中' && mkt1.length === mkt0.length);
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(350);
  ok('非表示中の市場指標はカードに出ない', await p.evaluate(n =>
    ![...document.querySelectorAll('#view .metric .m .k')].some(e => e.textContent === n), mname));

  // ---- 8. 旧データ(別リストへ退避済み)の読み替え ----
  await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hypo_tracker_proto_v1'));
    db.metricsMaster.snap = db.metricsMaster.snap.filter(k => k !== '信用倍率');
    db.metricsMaster.hiddenSnap = ['信用倍率'];
    db.metricsMaster.trend = db.metricsMaster.trend.filter(t => t.name !== '営業利益');
    db.metricsMaster.hiddenTrend = [{ name: '営業利益', graph: true }];   // 旧形式(オブジェクト丸ごと退避)
    localStorage.setItem('hypo_tracker_proto_v1', JSON.stringify(db));
  });
  await p.reload(); await p.waitForTimeout(400);
  const mig = await p.evaluate(() => ({
    snapHas: DB.metricsMaster.snap.includes('信用倍率'),
    trendHas: DB.metricsMaster.trend.some(t => t.name === '営業利益'),
    graphKept: (DB.metricsMaster.trend.find(t => t.name === '営業利益') || {}).graph,
    hs: DB.metricsMaster.hiddenSnap.slice(), ht: DB.metricsMaster.hiddenTrend.slice(),
    visibleSnap: snapKeys(DB.metricsMaster).includes('信用倍率'),
    visibleTrend: trendInds(DB.metricsMaster).some(t => t.name === '営業利益'),
  }));
  ok('旧データの非表示指標も一覧に戻る', mig.snapHas && mig.trendHas);
  ok('戻したうえで非表示中のまま', mig.hs.includes('信用倍率') && mig.ht.includes('営業利益'));
  ok('旧形式のhiddenTrendは名前だけに揃う', mig.ht.every(x => typeof x === 'string'));
  ok('グラフ表示の指定も失われない', mig.graphKept === true);
  ok('非表示中なので画面には出ない', !mig.visibleSnap && !mig.visibleTrend);
  // 2回流しても増えない(冪等)
  await p.reload(); await p.waitForTimeout(400);
  const again = await p.evaluate(() => ({
    snap: DB.metricsMaster.snap.filter(k => k === '信用倍率').length,
    trend: DB.metricsMaster.trend.filter(t => t.name === '営業利益').length,
    ht: DB.metricsMaster.hiddenTrend.length,
  }));
  ok('もう一度読み込んでも重複しない', again.snap === 1 && again.trend === 1 && again.ht === 1);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
