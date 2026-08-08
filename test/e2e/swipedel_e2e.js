// スワイプ→del-btnタップ→削除選択シートまでを実際の指操作で通す
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));
async function swipe(page, x1, y1, x2, y2, steps = 8) {
  await page.evaluate(([x1, y1, x2, y2, steps]) => {
    const el = document.elementFromPoint(x1, y1) || document.body;
    const mk = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    let t = mk(x1, y1);
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    for (let i = 1; i <= steps; i++) { t = mk(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps); el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] })); }
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
  }, [x1, y1, x2, y2, steps]);
}
(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id));
  await p.waitForTimeout(300);
  const box = await p.evaluate(() => { const row = document.querySelector('#view .list .swipe .list-row'); row.scrollIntoView({ block: 'center' }); const r = row.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.waitForTimeout(150);
  await swipe(p, box.x, box.y, box.x - 100, box.y);
  await p.waitForTimeout(250);
  const delBtnBox = await p.evaluate(() => { const b = document.querySelector('#view .list .swipe .del-btn'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.tap(`#view .list .swipe .del-btn`);
  await p.waitForTimeout(250);
  const sheetOpen = await p.evaluate(() => document.querySelector('#scrim').classList.contains('show'));
  ok('del-btnタップで削除シートが開く', sheetOpen);
  const sheetText = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok('削除の見出しが出る', /削除/.test(sheetText));
  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
