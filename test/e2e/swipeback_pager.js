// 分析項目シートのページャー(横スワイプでページ送り)と、シートを下へ引いて閉じる操作が取り合わないこと
//
// 経緯: 旧版は左端30%の帯で右スワイプして閉じる方式の検査だった。2026-10-15 にシートは下へ引いて閉じる方式に
// 変えた(swipeback.js)。ページャーの上で横になぞってもシートは動かず、縦に下へ引いたときだけ閉じることを見る
const { chromium } = require('playwright');
const CLOCK = new Date('2026-08-22T03:00:00Z');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v, d) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

async function drag(page, x1, y1, x2, y2, steps = 8) {
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
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.clock.install({ time: CLOCK });
  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload();
  await page.waitForTimeout(400);

  await page.evaluate(() => { openStock('9001'); sheetAnalysisItem('9001', '事業構造'); });
  await page.waitForTimeout(200);
  const pg = await page.evaluate(() => { const e = document.querySelector('#sheet .pages') || document.querySelector('#sheet .pager-nav'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 60)) }; });
  ok('ページャーが存在する', !!pg, pg);

  // ページャーの上で左右になぞる(ページ送りの操作)→ シートは閉じず、動きもしない
  await drag(page, pg.x + 100, pg.y, pg.x - 100, pg.y);
  await page.waitForTimeout(250);
  ok('ページャーの上で左へなぞってもシートは閉じない', await page.evaluate(() => document.querySelector('#scrim').classList.contains('show')));
  await drag(page, pg.x - 100, pg.y, pg.x + 100, pg.y);
  await page.waitForTimeout(250);
  ok('ページャーの上で右へなぞってもシートは閉じない', await page.evaluate(() => document.querySelector('#scrim').classList.contains('show') && !/translate[XY]\([1-9]/.test(document.querySelector('#sheet').style.transform)));

  // 同じ場所から下へ引く → 閉じる(シートの中身が一番上のとき)
  await page.evaluate(() => { document.querySelector('#sheet').scrollTop = 0; });
  await drag(page, pg.x, pg.y, pg.x, pg.y + 200);
  await page.waitForTimeout(300);
  ok('ページャーの上からでも、下へ引けばシートは閉じる', await page.evaluate(() => !document.querySelector('#scrim').classList.contains('show')));

  console.log('JSエラー:', JSON.stringify(errs));
  await browser.close();
})();
