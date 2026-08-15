// シート内のタップ領域44px。
// design.js の観点Dは home/analysis/import/reminder の4画面・4セレクタしか見ておらず、
// シート(注目ポイント編集・指標の管理・指標編集)は検査の外にあった。
// 実測すると指標の管理のバッジが36px、指標編集のselectが43pxだった。
const { chromium } = require('playwright');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, pass, detail) =>
  console.log((pass ? '✅' : '❌') + ' ' + label + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)));

// シートの中で押せるもの。<label>や<span>は押せないので入れない。
const SEL = '#sheet button, #sheet select, #sheet [onclick], #sheet .list-row, #sheet .sub-row, #sheet .chip, #sheet a';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload(); await page.waitForTimeout(400);

  // 開いたシートの中から44px未満を拾う。表示されていないものは対象外。
  const scan = async (open) => page.evaluate(({ open, SEL }) => {
    closeSheet();
    // eslint-disable-next-line no-eval
    eval(open);
    const out = [];
    document.querySelectorAll(SEL).forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.width && r.height && r.height < 44) {
        out.push(((e.className && e.className.baseVal !== undefined ? e.tagName : e.className) || e.tagName) + ':' + Math.round(r.height));
      }
    });
    return out;
  }, { open, SEL });

  const hypo = await scan("openStock(DB.stocks.find(x=>x.name==='テスト精機').id); sheetEditHypo(hyposOf(STATE.stockId)[0].id)");
  ok('注目ポイント編集シートに44px未満がない', hypo.length === 0, hypo);

  const master = await scan('sheetMetricsMaster()');
  ok('指標の管理シートに44px未満がない', master.length === 0, master);

  const snap = await scan("sheetMetricEdit('snap', DB.metricsMaster.snap[0], undefined)");
  ok('指標編集シート(主要指標)に44px未満がない', snap.length === 0, snap);

  const trend = await scan("sheetMetricEdit('trend', DB.metricsMaster.trend[0].name, undefined)");
  ok('指標編集シート(業績推移)に44px未満がない', trend.length === 0, trend);

  const rem = await scan('sheetAddReminder(STATE.stockId)');
  ok('リマインダー追加シートに44px未満がない', rem.length === 0, rem);

  // 個別に高さを確かめる。閾値そのものが緩められていないかの歯止め。
  const box = await page.evaluate(() => {
    closeSheet(); sheetMetricsMaster();
    const s = document.querySelector('#sheet .swtap[data-role="disp"]').getBoundingClientRect();
    return { stat: Math.round(s.height) };
  });
  ok('表示中/非表示中スイッチのタップ域は44px以上', box.stat >= 44, box.stat);

  const selH = await page.evaluate(() => {
    closeSheet(); sheetMetricEdit('snap', DB.metricsMaster.snap[0], undefined);
    const el = document.querySelector('#sheet select');
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  });
  ok('シート内のselectは44px以上', selH === null || selH >= 44, selH);

  console.log('JSエラー:', JSON.stringify(errs));
  await browser.close();
})();
