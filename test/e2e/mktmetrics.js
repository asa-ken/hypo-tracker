const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));
(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  const snap = await p.evaluate(() => DB.marketMetricsMaster.snap);
  ok('市場既定は3項目', JSON.stringify(snap) === JSON.stringify(['予想PER(市場全体)','長期金利(10年)','為替(USD/JPY)']));
  ok('日次で動くものは含まれない', !snap.some(x => /日経平均|TOPIX|移動平均|S&P|VIX|騰落レシオ/.test(x)));

  const mkt = await p.evaluate(() => { const m = DB.stocks.find(s => s.kind === '市場'); openStock(m.id); return document.querySelector('#view').innerText; });
  await p.waitForTimeout(300);
  const txt = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('市場ページに為替が出る', /為替\(USD\/JPY\)/.test(txt));
  ok('市場ページに長期金利が出る', /長期金利\(10年\)/.test(txt));
  ok('VIX・騰落レシオは既定から消えた', !/VIX指数/.test(txt) && !/騰落レシオ/.test(txt));

  const brief = await p.evaluate(() => briefingText());
  ok('説明書が市場は定性主体だと伝える', /市場の話は数値より「今どういう地合いか」の説明が主役/.test(brief));
  ok('説明書が株価指数を書かないよう指示', /株価指数の値・移動平均・日々のボラティリティは書かないでください/.test(brief));
  ok('CPI等はイベント日つき注目ポイントへ誘導', /発表日が決まっているものは、指標にするより/.test(brief));
  ok('説明書に新しい市場指標が載る', /為替\(USD\/JPY\)/.test(brief) && /長期金利\(10年\)/.test(brief));

  console.log('JSエラー:', JSON.stringify(errs));
  await p.screenshot({ path: __dirname + '/mktmetrics.png', fullPage: true });
  await b.close();
})();
