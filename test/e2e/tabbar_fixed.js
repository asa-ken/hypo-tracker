// 下部タブバーが position:fixed でビューポートに直結していること(iOSのバウンススクロールで
// sticky が一緒にずれてしまう問題への対処)を確認する
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

  const style = () => p.evaluate(() => getComputedStyle(document.querySelector('.tabbar')).position);
  ok('タブバーは position:fixed', await style() === 'fixed');

  // 十分な件数を入れて縦に長くする
  await p.evaluate(() => {
    for (let i = 0; i < 20; i++) DB.stocks.push({ id: 'q' + i, name: '増量' + i, code: '' + (7000 + i), kind: '保有', metrics: {}, trend: {}, sections: {}, links: [] });
    save(); go('analysis');
  });
  await p.waitForTimeout(300);
  const rectTop = await p.evaluate(() => document.querySelector('.tabbar').getBoundingClientRect());
  await p.evaluate(() => document.scrollingElement.scrollTop = 1000);
  await p.waitForTimeout(200);
  const rectScrolled = await p.evaluate(() => document.querySelector('.tabbar').getBoundingClientRect());
  ok('スクロールしても座標(top/bottom)が変わらない', rectTop.top === rectScrolled.top && rectTop.bottom === rectScrolled.bottom);
  ok('ビューポート最下部に接している', Math.round(rectScrolled.bottom) === 844);

  // .phone の中央寄せ幅(max-width:430px)を fixed 側でも再現できているか
  const centered = await p.evaluate(() => {
    const phone = document.querySelector('.phone').getBoundingClientRect();
    const bar = document.querySelector('.tabbar').getBoundingClientRect();
    return Math.abs(phone.left - bar.left) < 1 && Math.abs(phone.right - bar.right) < 1;
  });
  ok('.phone と同じ横幅・位置に揃っている', centered);

  // 本文の最後のカードがタブバーの下に隠れていないか
  await p.evaluate(() => document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight);
  await p.waitForTimeout(200);
  const overlap = await p.evaluate(() => {
    const rows = document.querySelectorAll('#view .list-row');
    const last = rows[rows.length - 1].getBoundingClientRect();
    const bar = document.querySelector('.tabbar').getBoundingClientRect();
    return last.bottom > bar.top;
  });
  ok('最後まで送っても本文がタブバーに隠れない', !overlap);

  // 銘柄詳細でも同様に固定されている
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id));
  await p.waitForTimeout(300);
  const detailRect1 = await p.evaluate(() => document.querySelector('.tabbar').getBoundingClientRect());
  await p.evaluate(() => document.scrollingElement.scrollTop = 500);
  await p.waitForTimeout(200);
  const detailRect2 = await p.evaluate(() => document.querySelector('.tabbar').getBoundingClientRect());
  ok('銘柄詳細でもスクロールで座標が変わらない', detailRect1.top === detailRect2.top);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
