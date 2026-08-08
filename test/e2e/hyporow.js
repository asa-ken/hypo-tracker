// 銘柄詳細のメモ・注目ポイントのカードから、行末の「›」を外す
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
  await p.evaluate(() => openStock('9001'));
  await p.waitForTimeout(400);
  await p.evaluate(() => { STATE.hypoAll = true; render(); });
  await p.waitForTimeout(350);

  const rows = await p.evaluate(() => [...document.querySelectorAll('#view .swipe .list-row')]);
  ok('前提: メモ・注目ポイントのカードが出ている', await p.evaluate(() =>
    document.querySelectorAll('#view .swipe .list-row').length > 0));
  ok('カードに右向きの矢尻を出さない', await p.evaluate(() =>
    document.querySelectorAll('#view .swipe .list-row .arrow').length === 0));
  ok('「›」の文字も残っていない', await p.evaluate(() =>
    ![...document.querySelectorAll('#view .swipe .list-row')].some(r => /›/.test(r.textContent))));
  ok('メモと注目の両方が出ている(テスト前提)', await p.evaluate(() => {
    const t = [...document.querySelectorAll('#view .swipe .list-row .chip')].map(c => c.textContent.trim());
    return t.includes('メモ') && t.includes('注目');
  }));

  // ---- 消したのは矢尻だけ。中身と操作は変えない ----
  ok('メモ/注目のバッジは残る', await p.evaluate(() =>
    document.querySelectorAll('#view .swipe .list-row .chip').length > 0));
  ok('本文は残る', await p.evaluate(() =>
    [...document.querySelectorAll('#view .swipe .list-row .clip2')].some(e => e.textContent.trim().length > 0)));
  ok('リマインダーの状態表示は残る', await p.evaluate(() =>
    /次回|候補/.test(document.querySelector('#view').textContent)));
  ok('タップ領域は44px以上', await p.evaluate(() =>
    [...document.querySelectorAll('#view .swipe .list-row')].every(r => r.getBoundingClientRect().height >= 44)));

  // タップで編集シートが開く
  await p.evaluate(() => document.querySelector('#view .swipe .list-row').click());
  await p.waitForTimeout(300);
  ok('タップで編集シートが開く', await p.evaluate(() => document.querySelector('#scrim').classList.contains('show')));
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(250);

  // 右→左スワイプの削除帯は残る
  ok('スワイプ削除のボタンは残る', await p.evaluate(() =>
    document.querySelectorAll('#view .swipe .del-btn').length > 0));

  // ---- ほかの画面の「›」は今回の対象外(消していないこと) ----
  await p.evaluate(() => go('reminder')); await p.waitForTimeout(350);
  ok('リマインダー一覧の「›」は残す', await p.evaluate(() =>
    document.querySelectorAll('#view .list-row .arrow').length > 0));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
