const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload();
  await page.waitForTimeout(400);

  // ホーム
  await page.evaluate(() => go('home'));
  await page.waitForTimeout(200);
  const home = await page.evaluate(() => document.querySelector('#view').innerText);
  ok('ホームに「鮮度切れ」が出ない', !/鮮度切れ/.test(home));
  ok('ホームに「要更新」が出ない', !/要更新/.test(home));

  // 銘柄分析リスト
  await page.evaluate(() => go('analysis'));
  await page.waitForTimeout(200);
  const list = await page.evaluate(() => document.querySelector('#view').innerText);
  ok('リストに「要更新」チップが出ない', !/要更新/.test(list));
  ok('リストに「最新」チップが出ない', !/最新/.test(list));
  ok('ソートに「鮮度が古い順」が出ない', !/鮮度が古い順/.test(list));

  // 個別銘柄詳細
  await page.evaluate(() => openStock('9001'));
  await page.waitForTimeout(300);
  const detail = await page.evaluate(() => document.querySelector('#view').innerText);
  ok('詳細に「分析の要更新」が出ない', !/分析の要更新/.test(detail));
  ok('詳細に「最新」チップが出ない', !/最新/.test(detail));

  ok('staleCount関数が残っていない', await page.evaluate(() => typeof staleCount === 'undefined'));

  console.log('JSエラー:', JSON.stringify(errs));
  await page.screenshot({ path: __dirname + '/nobadge_home.png' });
  await browser.close();
})();
