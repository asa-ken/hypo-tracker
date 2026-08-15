// 表示に選んだ指標は、数値を持っていなくても枠ごと出して「データなし」と書く
//  ・主要指標のカードは常に出る(値の代わりに「データなし」)
//  ・業績推移のグラフは、グラフ表示に選んだ指標の分だけ必ず出る(空なら一面に「データなし」)
//  ・業績推移の表は、空の指標も行を残し、年度のセルをまとめて1つの「データなし」にする
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

  // ============ 1. 何も取り込んでいない銘柄 ============
  await p.evaluate(() => {
    DB.stocks.push({ id: '9997', name: 'まだ空の銘柄', code: '9997', kind: '保有', metrics: {}, trend: {}, sections: {}, links: [] });
    save(); openStock('9997');
  });
  await p.waitForTimeout(400);

  const empty = await p.evaluate(() => {
    const v = document.querySelector('#view');
    const cells = [...v.querySelectorAll('.metric .m')];
    const table = v.querySelector('table');
    return {
      // 2026-08-13: ROE・営業利益率が非表示中の指標として存在しうるため、生のsnap.length
      // ではなく表示対象(snapKeys、非表示分を除く)の件数と比べる
      cellCount: cells.length, snapCount: snapKeys(DB.metricsMaster).length,
      cellNames: cells.map(c => c.querySelector('.k').textContent),
      cellValues: cells.map(c => c.querySelector('.v').textContent),
      charts: v.querySelectorAll('.nodata').length,
      hasTable: !!table,
      rows: table ? [...table.querySelectorAll('tr')].slice(1).map(r => r.textContent.trim().replace(/\s+/g, ' ')) : [],
      trendInds: DB.metricsMaster.trend.map(t => t.name),
      headers: table ? [...table.querySelectorAll('th')].map(t => t.textContent.trim()) : [],
      hint: v.innerText.includes('年度つきで取り込むと'),
    };
  });
  ok('主要指標のカードは選んだ指標の分だけ全部出る', empty.cellCount === empty.snapCount && empty.cellCount > 0);
  ok('カードの表示順・名前はマスターどおり', JSON.stringify(empty.cellNames) === JSON.stringify(await p.evaluate(() => snapKeys(DB.metricsMaster))));
  ok('値が無いカードは「データなし」と書く', empty.cellValues.every(v => v === 'データなし'));
  ok('業績推移の表も出る(消えない)', empty.hasTable);
  ok('表の行は業績推移の指標の分だけある', empty.rows.length === empty.trendInds.length);
  ok('空の行はすべて「データなし」', empty.rows.length > 0 && empty.rows.every(r => /データなし$/.test(r)));
  ok('年度が1つも無いときは見出しを「年度」にする', JSON.stringify(empty.headers) === JSON.stringify(['指標', '年度']));
  ok('グラフは常に1枚(タップした指標)で、データが無ければ枠が出る', empty.charts === 1);
  ok('埋め方の案内も残る', empty.hint);

  // 「データなし」は記号ではなく言葉で書く(—だけだと意味が読み取れない)
  const wording = await p.evaluate(() => {
    const t = document.querySelector('#view').innerText;
    return { nodata: (t.match(/データなし/g) || []).length, dash: (t.match(/^—$/gm) || []).length };
  });
  ok('画面に「データなし」が複数出る', wording.nodata >= 3);
  ok('「—」だけの表示は残っていない', wording.dash === 0);

  // ============ 2. 一部だけ欠けている銘柄 ============
  await p.evaluate(() => {
    backFromDetail();
    const s = DB.stocks.find(x => x.name === 'テスト精機');
    delete s.trend['EPS'];                    // 指標まるごと欠け
    delete s.trend['営業利益']['25年3月期'];   // 年度単位の欠け
    delete s.metrics[DB.metricsMaster.snap[1]]; // 主要指標の一部欠け
    save(); openStock(s.id);
  });
  await p.waitForTimeout(400);

  const mixed = await p.evaluate(() => {
    const v = document.querySelector('#view');
    const table = v.querySelector('table');
    const rows = [...table.querySelectorAll('tr')].slice(1);
    const cells = [...v.querySelectorAll('.metric .m')];
    return {
      // 2026-08-13: ROE・営業利益率が非表示中の指標として存在しうるため、生のsnap配列
      // ではなく表示対象(snapKeys、非表示分を除く)で数える
      cellCount: cells.length, snapCount: snapKeys(DB.metricsMaster).length,
      nodataCells: cells.filter(c => c.querySelector('.v').textContent === 'データなし').map(c => c.querySelector('.k').textContent),
      missingSnap: snapKeys(DB.metricsMaster).filter(k => !stock(STATE.stockId).metrics[k]),
      rows: rows.map(r => ({
        name: r.querySelector('td').textContent.trim(),
        empty: r.classList.contains('empty-row'),
        span: r.querySelector('.nodata-cell') ? +r.querySelector('.nodata-cell').getAttribute('colspan') : 0,
        text: r.textContent.trim().replace(/\s+/g, ' '),
      })),
      years: [...table.querySelectorAll('th')].length - 1,
      charts: v.querySelectorAll('.nodata').length,
    };
  });
  ok('欠けている指標があってもカードの枚数は変わらない', mixed.cellCount === mixed.snapCount);
  ok('欠けている主要指標だけが「データなし」になる', JSON.stringify(mixed.nodataCells) === JSON.stringify(mixed.missingSnap) && mixed.nodataCells.length > 0);

  const salesRow = mixed.rows.find(r => r.name === '売上高');
  const opRow = mixed.rows.find(r => r.name === '営業利益');
  const epsRow = mixed.rows.find(r => r.name === 'EPS');
  ok('数値のある行はそのまま年度ごとに並ぶ', salesRow && !salesRow.empty && salesRow.span === 0);
  ok('年度単位の欠けは「—」のまま(行ごと空とは区別する)', opRow && !opRow.empty && /—/.test(opRow.text));
  ok('まるごと空の行は残る', !!epsRow);
  ok('まるごと空の行は年度のセルを1つにまとめる(セル結合)', epsRow && epsRow.span === mixed.years && mixed.years > 1);
  ok('まるごと空の行は「データなし」と書く', epsRow && /データなし$/.test(epsRow.text));
  ok('空の指標だけ薄く表示される', epsRow && epsRow.empty && !salesRow.empty);

  // EPSの行をタップして、空の指標のグラフに切り替える
  await p.evaluate(() => trendChartTo('EPS'));
  await p.waitForTimeout(200);
  const chartLabel = await p.evaluate(() => {
    const nd = document.querySelector('#view .nodata');
    // 見出しはグラフの上に移ったので、直前の要素を見る
    return { box: nd ? Math.round(nd.getBoundingClientRect().height) : null, label: nd ? nd.previousElementSibling.textContent.trim() : null };
  });
  ok('空の指標をタップすると、空のグラフが1枚出る(EPS)', !!chartLabel.box);
  ok('空のグラフも通常のグラフと同じ高さの枠を取る', chartLabel.box >= 100);
  ok('どの指標が空なのか名前で分かる', /^EPS/.test(chartLabel.label));

  // ============ 3. 市場カードの指標も同じ扱い ============
  await p.evaluate(() => {
    backFromDetail();
    const m = DB.stocks.find(x => x.kind === '市場');
    m.metrics = {}; save(); openStock(m.id);
  });
  await p.waitForTimeout(400);
  const mkt = await p.evaluate(() => {
    const cells = [...document.querySelectorAll('#view .metric .m')];
    return { n: cells.length, keys: metricsMasterFor(stock(STATE.stockId)).snap.length,
             all: cells.every(c => c.querySelector('.v').textContent === 'データなし') };
  });
  ok('市場カードの指標も選んだ分だけ出る', mkt.n === mkt.keys && mkt.n > 0);
  ok('市場カードの空の指標も「データなし」', mkt.all);
  ok('市場カードに業績推移の表は出ない(元の仕様どおり)', await p.evaluate(() => !document.querySelector('#view table')));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
