const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload();
  await page.waitForTimeout(400);

  // ホームの「今週の予定」からリマインダーを開く実際の操作を再現
  await page.evaluate(() => go('home'));
  await page.waitForTimeout(200);
  const cardSel = await page.evaluate(() => {
    // 「対応が必要」の分割コピー行も同じ .list-row かつ似た文言なので、
    // 「今週の予定」の見出し以降だけを対象にする
    // 見出しは「今週の予定 (3)」のように件数が付き、開閉のキャレットも入るので前方一致で探す
    const lbl = [...document.querySelectorAll('#view .lbl')].find(x => x.textContent.trim().startsWith('今週の予定'));
    if (!lbl) return null;
    let el = lbl.nextElementSibling, c = null;
    while (el && !c) { if (el.matches('.list-row')) c = el; else c = el.querySelector && el.querySelector('.list-row'); el = el.nextElementSibling; }
    if (!c) return null;
    c.setAttribute('data-test-target', '1');
    return true;
  });
  ok('ホームに予定カードがある', !!cardSel);
  await page.click('[data-test-target="1"]');
  await page.waitForTimeout(250);

  const hasCloseBtn = await page.evaluate(() => !!document.querySelector('.sheet-close'));
  ok('シートに✕閉じるボタンが出る', hasCloseBtn);

  // ✕ボタンを実際にクリック
  await page.click('.sheet-close');
  await page.waitForTimeout(200);
  const closed1 = await page.evaluate(() => !document.querySelector('#scrim').classList.contains('show'));
  ok('✕クリックで閉じる', closed1);
  const backHome = await page.evaluate(() => STATE.tab === 'home' && document.querySelector('#topTitle').textContent === 'ホーム');
  ok('元のホーム画面に戻っている', backHome);

  // 再度開いて、今度は他のシート(sheetMetricsMaster)でも✕があるか確認
  await page.evaluate(() => { openStock('9001'); sheetMetricsMaster(); });
  await page.waitForTimeout(200);
  const hasCloseBtn2 = await page.evaluate(() => !!document.querySelector('.sheet-close'));
  ok('sheetMetricsMasterにも✕がある', hasCloseBtn2);
  const h3Ok = await page.evaluate(() => !!document.querySelector('#sheet h3'));
  ok('タイトル(h3)は引き続き表示される', h3Ok);

  console.log('JSエラー:', JSON.stringify(errs));
  await page.screenshot({ path: __dirname + '/closebtn.png' });
  await browser.close();
})();
