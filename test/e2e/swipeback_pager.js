const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

async function swipe(page, x1, y1, x2, y2, steps=6) {
  await page.evaluate(([x1,y1]) => {
    const el = document.elementFromPoint(x1, y1);
    const t = new Touch({identifier: 1, target: el, clientX: x1, clientY: y1});
    el.dispatchEvent(new TouchEvent('touchstart', {bubbles:true, cancelable:true, touches:[t], targetTouches:[t], changedTouches:[t]}));
  }, [x1, y1]);
  for (let i=1;i<=steps;i++){
    const x = x1 + (x2-x1)*i/steps, y = y1 + (y2-y1)*i/steps;
    await page.evaluate(([x,y,x1,y1]) => {
      const el = document.elementFromPoint(x1, y1) || document.body;
      const t = new Touch({identifier: 1, target: el, clientX: x, clientY: y});
      document.getElementById('edgeSwipeZone').dispatchEvent(new TouchEvent('touchmove', {bubbles:true, cancelable:true, touches:[t], targetTouches:[t], changedTouches:[t]}));
    }, [x, y, x1, y1]);
    await page.waitForTimeout(15);
  }
  await page.evaluate(([x2,y2,x1,y1]) => {
    const el = document.elementFromPoint(x1, y1) || document.body;
    const t = new Touch({identifier: 1, target: el, clientX: x2, clientY: y2});
    document.getElementById('edgeSwipeZone').dispatchEvent(new TouchEvent('touchend', {bubbles:true, cancelable:true, touches:[], targetTouches:[], changedTouches:[t]}));
  }, [x2, y2, x1, y1]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload();
  await page.waitForTimeout(400);

  await page.evaluate(() => { openStock('9001'); sheetAnalysisItem('9001', '事業構造'); });
  await page.waitForTimeout(200);
  const pagerExists = await page.evaluate(() => !!document.querySelector('#sheet .pager-nav'));
  ok('ページャーが存在する', pagerExists);

  // ページャー中央付近から右スワイプ(通常のページ送り操作)→ シートは閉じない
  await swipe(page, 195, 450, 320, 450);
  await page.waitForTimeout(250);
  const stillShown = await page.evaluate(() => document.querySelector('#scrim').classList.contains('show'));
  ok('ページャー中央からの右スワイプではシートが閉じない', stillShown);

  // 左端(x<24)からの右スワイプ → シートが閉じる(自由入力なしのケース)
  await swipe(page, 10, 450, 150, 450);
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => !document.querySelector('#scrim').classList.contains('show'));
  ok('左端からの右スワイプではシートが閉じる', closed);

  await browser.close();
})();
