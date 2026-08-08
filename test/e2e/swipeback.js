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
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload();
  await page.waitForTimeout(400);

  // ---- 1. リマインダー詳細(自由入力なし)をエッジスワイプで閉じる ----
  await page.evaluate(() => { go('home'); openReminder(DB.reminders[0].id); });
  await page.waitForTimeout(200);
  let shown = await page.evaluate(() => document.querySelector('#scrim').classList.contains('show'));
  ok('リマインダー詳細シートが開く', shown);
  await swipe(page, 10, 400, 120, 400);
  await page.waitForTimeout(250);
  let closed = await page.evaluate(() => !document.querySelector('#scrim').classList.contains('show'));
  ok('左端から右スワイプで閉じる(自由入力なし→即閉じ)', closed);

  // ---- 2. 分析項目のページャー(横スワイプ)と誤反応しないこと ----
  await page.evaluate(() => { openStock('9001'); sheetAnalysisItem('9001', DB.sectionMaster[0].subs[0]); });
  await page.waitForTimeout(200);
  const pagerExists = await page.evaluate(() => !!document.querySelector('#sheet .pager, #sheet .pager-nav'));
  if (pagerExists) {
    // ページャー中央からのスワイプ(端からではない)ではシートが閉じないことを確認
    await swipe(page, 195, 500, 320, 500);
    await page.waitForTimeout(250);
    const stillShown = await page.evaluate(() => document.querySelector('#scrim').classList.contains('show'));
    ok('ページャー中央からのスワイプではシートは閉じない(誤反応なし)', stillShown);
  } else {
    console.log('  (このデータではsheetAnalysisItemにページャーなし。スキップ)');
  }
  await page.evaluate(() => closeSheet());

  // ---- 3. 未保存の自由入力があるとエッジスワイプで確認ダイアログが出る ----
  await page.evaluate(() => { openStock('9001'); sheetEditHypo(null, '9001', 'memo'); });
  await page.waitForTimeout(200);
  await page.fill('#hy_text', 'テスト中の未保存メモ');
  await swipe(page, 10, 400, 120, 400);
  await page.waitForTimeout(250);
  const confirmShown = await page.evaluate(() => document.querySelector('#exitConfirm').classList.contains('show'));
  ok('未保存の入力があるとエッジスワイプで確認ダイアログが出る', confirmShown);
  const stillOpen = await page.evaluate(() => document.querySelector('#scrim').classList.contains('show'));
  ok('確認ダイアログの間、元のシートは閉じていない', stillOpen);
  const textPreserved = await page.evaluate(() => document.querySelector('#hy_text').value);
  ok('入力内容が保持されている', textPreserved === 'テスト中の未保存メモ');

  // 「編集を続ける」→ ダイアログが閉じてシートに戻る
  await page.evaluate(() => cancelCloseSheet());
  await page.waitForTimeout(150);
  const afterCancel = await page.evaluate(() => ({
    confirmHidden: !document.querySelector('#exitConfirm').classList.contains('show'),
    sheetStillShown: document.querySelector('#scrim').classList.contains('show'),
    text: document.querySelector('#hy_text').value,
  }));
  ok('「編集を続ける」でダイアログが消えてシートは残る', afterCancel.confirmHidden && afterCancel.sheetStillShown);
  ok('「編集を続ける」後も入力内容が残っている', afterCancel.text === 'テスト中の未保存メモ');

  // 同じ未保存状態から✕ボタンでも確認が出ることを確認
  await page.evaluate(() => document.querySelector('.sheet-close').click());
  await page.waitForTimeout(150);
  const confirmShown2 = await page.evaluate(() => document.querySelector('#exitConfirm').classList.contains('show'));
  ok('✕ボタンでも未保存なら確認ダイアログが出る', confirmShown2);

  // 「破棄して閉じる」→ 実際に閉じる
  await page.evaluate(() => confirmCloseSheet());
  await page.waitForTimeout(150);
  const afterDiscard = await page.evaluate(() => !document.querySelector('#scrim').classList.contains('show'));
  ok('「破棄して閉じる」で実際にシートが閉じる', afterDiscard);

  // ---- 4. 保存後のcloseSheet()は確認を挟まない(既存の保存フローは変わらない) ----
  await page.evaluate(() => { openStock('9001'); sheetEditHypo(null, '9001', 'memo'); });
  await page.waitForTimeout(200);
  await page.fill('#hy_text', '保存されるメモ');
  const before = await page.evaluate(() => DB.hypotheses.filter(h=>h.kind==='memo').length);
  await page.evaluate(() => saveHypo('', '9001', 'memo'));
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    n: DB.hypotheses.filter(h=>h.kind==='memo').length,
    sheetClosed: !document.querySelector('#scrim').classList.contains('show'),
    confirmNotShown: !document.querySelector('#exitConfirm').classList.contains('show'),
  }));
  ok('保存すると確認なしでシートが閉じる(既存挙動を維持)', after.sheetClosed && after.confirmNotShown && after.n === before + 1);

  // ---- 5. 選択肢だけのシート(自由入力なし)は背景タップ/✕で即閉じ(確認なし) ----
  await page.evaluate(() => sheetStockMenu('9001'));
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('.sheet-close').click());
  await page.waitForTimeout(150);
  const noConfirmForMenu = await page.evaluate(() => !document.querySelector('#scrim').classList.contains('show') && !document.querySelector('#exitConfirm').classList.contains('show'));
  ok('メニューだけのシートは確認なしで即閉じる', noConfirmForMenu);

  console.log('JSエラー:', JSON.stringify(errs));
  await browser.close();
})();
