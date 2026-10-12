// 詳細画面(銘柄・市場)とブラウザの履歴を結びつけ、ブラウザの「戻る」(Chrome/Safari の戻るスワイプ・
// 戻るボタン)で一覧に戻れること。ブラウザで開いているときはアプリ独自の戻るスワイプを止めること
//
// 2026-10-11(ユーザーが iPhone の Chrome の実画面で報告): 左端から戻るスワイプすると、Chrome 自身の
// 戻るスワイプとアプリ独自の戻るスワイプが同時に動き、灰色が3層に見え、下のタブバーが縮んで見えた。
// しかもアプリは詳細を開いても履歴に記録していなかったため、指を離すと Chrome はアプリの前に開いていた
// ページ(別サイト)へ戻ってしまう恐れがあった。ユーザー確認のうえ(「それでOkです」)、
//  ・詳細を開いたら履歴に1つ記録し、ブラウザの「戻る」で一覧に戻す(見え方はブラウザ本来の戻るスワイプ)
//  ・ブラウザで開いているときはアプリ独自の戻るスワイプを止める(ホーム画面に追加したアプリ表示のときは残す)
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

// #view 上で左側から右へスワイプする(swipeback_detail.js と同じ作り)
async function swipe(page, x1, y, x2) {
  await page.evaluate(([x1, y, x2]) => {
    const el = document.elementFromPoint(x1, y) || document.body;
    const mk = x => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    let t = mk(x1);
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    for (let i = 1; i <= 8; i++) { t = mk(x1 + (x2 - x1) * i / 8); el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] })); }
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
  }, [x1, y, x2]);
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install({ time: new Date('2026-08-22T03:00:00Z') });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => {
    for (let i = 0; i < 20; i++) DB.stocks.push({ id: 'z' + i, name: '増量銘柄' + i, code: '' + (7000 + i), kind: '保有', metrics: {}, trend: {}, sections: {}, links: [] });
    save(); go('analysis'); setViewScroll(80);
  });
  await p.waitForTimeout(200);
  const st = () => p.evaluate(() => ({ sid: STATE.stockId, tab: STATE.tab, hs: history.state, len: history.length, title: document.querySelector('#topTitle').textContent, scroll: viewScroll() }));

  // ---- 1. 詳細を開くと履歴に1つ積み、ブラウザの「戻る」で一覧に戻る ----
  const s0 = await st();
  await p.evaluate(() => openStock('9001')); await p.waitForTimeout(200);
  const s1 = await st();
  ok('詳細を開くと履歴に1つ積む', s1.len === s0.len + 1 && s1.hs && s1.hs.detail === '9001', { before: s0.len, after: s1.len, state: s1.hs });
  await p.goBack(); await p.waitForTimeout(300);
  const s2 = await st();
  ok('ブラウザの「戻る」で一覧に戻る', s2.sid === null && s2.title === '市場・銘柄分析', s2);
  ok('一覧のスクロール位置が復元される', s2.scroll === 80, s2.scroll);

  // ---- 2. 「進む」で詳細に戻れる(履歴を積み直さない) ----
  await p.goForward(); await p.waitForTimeout(300);
  const s3 = await st();
  ok('ブラウザの「進む」で同じ詳細に戻る', s3.sid === '9001', s3);
  ok('「進む」では履歴を積み増さない', s3.len === s1.len, { len: s3.len, expected: s1.len });

  // ---- 3. ヘッダーの「← 戻る」も履歴と同期する(戻った後に「戻る」をもう一度押しても詳細が出ない) ----
  await p.evaluate(() => document.querySelector('#topAct').click()); await p.waitForTimeout(300);
  const s4 = await st();
  ok('ヘッダーの「← 戻る」で一覧に戻る', s4.sid === null, s4);
  ok('ヘッダーで戻った後、履歴の現在地は詳細ではない', !(s4.hs && s4.hs.detail), s4.hs);

  // ---- 4. 詳細から詳細へ(市場カードの関連銘柄など)渡っても、「戻る」1回で一覧に戻る ----
  await p.evaluate(() => { openStock('mkt_test1'); }); await p.waitForTimeout(150);
  await p.evaluate(() => { openStock('9001'); }); await p.waitForTimeout(150);
  await p.goBack(); await p.waitForTimeout(300);
  ok('詳細→詳細と渡っても「戻る」1回で一覧に戻る', (await st()).sid === null);

  // ---- 5. 詳細を開いたまま下のタブで別画面へ移っても、履歴に詳細が残らない ----
  await p.evaluate(() => openStock('9001')); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('.tabbar button[data-tab="home"]').click()); await p.waitForTimeout(400);
  const s5 = await st();
  ok('タブで移った後は、履歴の現在地は詳細ではない', s5.tab === 'home' && s5.sid === null && !(s5.hs && s5.hs.detail), s5);

  // ---- 6. シートが開いている詳細で「戻る」が来たら、まずシートを閉じる(入力中なら確認を出す) ----
  await p.evaluate(() => { go('analysis'); setViewScroll(80); openStock('9001'); setViewScroll(30); sheetTheme('9001'); }); await p.waitForTimeout(200);
  await p.goBack(); await p.waitForTimeout(300);
  const s6 = await st();
  ok('シート表示中の「戻る」ではシートが閉じ、詳細のまま', s6.sid === '9001' && !(await p.evaluate(() => document.querySelector('#scrim').classList.contains('show'))), s6);
  ok('シートを閉じただけの詳細は、見ていた位置のまま(一覧の位置を当てない)', s6.scroll === 30, s6.scroll);
  ok('その後も履歴の現在地は詳細(もう一度「戻る」で一覧へ)', s6.hs && s6.hs.detail === '9001', s6.hs);
  await p.evaluate(() => { sheetTheme('9001'); document.querySelector('#sheet textarea, #sheet input').value = '書きかけ'; }); await p.waitForTimeout(100);
  await p.goBack(); await p.waitForTimeout(300);
  ok('入力中のシートでは閉じる確認を出す(書きかけを失わない)', await p.evaluate(() => document.querySelector('#exitConfirm').classList.contains('show') && document.querySelector('#scrim').classList.contains('show')));
  await p.evaluate(() => confirmCloseSheet()); await p.waitForTimeout(150);
  await p.goBack(); await p.waitForTimeout(300);
  ok('シートを閉じた後の「戻る」で一覧へ', (await st()).sid === null);

  // ---- 7. ブラウザで開いているときは、アプリ独自の戻るスワイプは動かない(ブラウザの戻るスワイプに任せる) ----
  await p.evaluate(() => openStock('9001')); await p.waitForTimeout(200);
  const y = await p.evaluate(() => { const r = document.querySelector('#view .lbl.grp').getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
  await swipe(p, 40, y, 220); await p.waitForTimeout(350);
  ok('ブラウザ表示ではアプリ独自の戻るスワイプは動かない', await p.evaluate(() => STATE.stockId === '9001' && !document.querySelector('#view').style.transform));

  // ---- 8. 再読み込み後、前に積んだ詳細の履歴で迷子にならない ----
  await p.reload(); await p.waitForTimeout(400);
  ok('再読み込み直後は一覧/ホームで、履歴の現在地も詳細ではない', await p.evaluate(() => STATE.stockId === null && !(history.state && history.state.detail)));

  console.log('JSエラー:', JSON.stringify(errs));

  // ---- 9. ホーム画面に追加したアプリ表示(standalone)では、アプリ独自の戻るスワイプが動く ----
  const q = await b.newPage({ viewport: { width: 390, height: 844 } });
  await q.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  await q.clock.install({ time: new Date('2026-08-22T03:00:00Z') });
  await q.goto('http://127.0.0.1:8731/index.html');
  await q.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await q.reload(); await q.waitForTimeout(400);
  await q.evaluate(() => { go('analysis'); openStock('9001'); }); await q.waitForTimeout(200);
  const y2 = await q.evaluate(() => { const r = document.querySelector('#view .lbl.grp').getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
  await swipe(q, 40, y2, 220); await q.waitForTimeout(400);
  ok('アプリ表示ではアプリ独自の戻るスワイプで一覧に戻る', await q.evaluate(() => STATE.stockId === null));
  ok('アプリ表示でスワイプで戻った後も履歴の現在地は詳細ではない', await q.evaluate(() => !(history.state && history.state.detail)));
  await b.close();
})();
