// シート(画面の下からせり上がる板)を、下へ引いて閉じられること。左端からの右スワイプでは閉じないこと
//
// 経緯: 以前はシートの左端30%に帯(#edgeSwipeZone)を重ね、右スワイプで閉じていた(このスイートの旧版はその検査)。
// 2026-10-15、ユーザーが「シートは右スワイプではなく下スワイプで閉じるものという感覚がある」と指摘。
// iOS・Android とも、下から出るシートは下へ引いて閉じ、左端からの右スワイプは「前の画面に戻る」の操作。
// しかもブラウザで開いていると Chrome 自身の戻るスワイプと取り合っていた。ユーザー確認のうえ(「A'で進めてください」)、
//  ・シート上端につまみを付け、下へ引くと指についてきて、一定以上で閉じる(中身が一番上までスクロールされているときだけ)
//  ・左端からの右スワイプで閉じる帯はやめる
//  ・書きかけがあるときは、今と同じく閉じる確認を出す
const { chromium } = require('playwright');
const CLOCK = new Date('2026-08-22T03:00:00Z');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v, d) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

// (x1,y1) の要素から (x2,y2) までなぞる。release=false なら指を離さずに止める(途中の見え方を見る)
async function drag(page, x1, y1, x2, y2, release = true, steps = 8) {
  await page.evaluate(([x1, y1, x2, y2, release, steps]) => {
    const el = document.elementFromPoint(x1, y1) || document.body;
    window._dragEl = el;
    const mk = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    let t = mk(x1, y1);
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    for (let i = 1; i <= steps; i++) { t = mk(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps); el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] })); }
    if (release) el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
  }, [x1, y1, x2, y2, release, steps]);
}
async function release(page, x, y) {
  await page.evaluate(([x, y]) => { const el = window._dragEl; const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y }); el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] })); }, [x, y]);
}
const shown = page => page.evaluate(() => document.querySelector('#scrim').classList.contains('show'));
// シート上端から少し下(つまみ・見出しのあたり)の座標
const sheetTop = page => page.evaluate(() => { const r = document.querySelector('#sheet').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 30), h: Math.round(r.height) }; });

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.clock.install({ time: CLOCK });
  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload();
  await page.waitForTimeout(400);

  // ---- 1. つまみ ----
  await page.evaluate(() => { go('home'); openReminder(DB.reminders[0].id); });
  await page.waitForTimeout(200);
  ok('リマインダー詳細シートが開く', await shown(page));
  const grip = await page.evaluate(() => {
    const g = document.querySelector('#sheet .sheet-grip'); if (!g) return null;
    const r = g.getBoundingClientRect(), s = document.querySelector('#sheet').getBoundingClientRect(), cs = getComputedStyle(g);
    return { w: Math.round(r.width), h: Math.round(r.height), topGap: Math.round(r.top - s.top), centered: Math.abs((r.left + r.width / 2) - (s.left + s.width / 2)) < 2, bg: cs.backgroundColor, hidden: g.getAttribute('aria-hidden') };
  });
  ok('シートの上端中央につまみがある(下へ引けることの手がかり)', !!grip && grip.centered && grip.topGap <= 10 && grip.w >= 32 && grip.h >= 4, grip);
  ok('つまみの色は既存トークン(--line2)で、読み上げ対象にしない', !!grip && grip.bg === 'rgb(203, 208, 213)' && grip.hidden === 'true', grip);

  // 上端に操作バー(.headbar)を置くシートでも、つまみがバーに隠れない(バーは上端に貼り付く・背景あり)
  await page.evaluate(() => { closeSheet(); openStock('9001'); sheetEditHypo(null, '9001', 'memo'); }); await page.waitForTimeout(200);
  const onBar = await page.evaluate(() => { const g = document.querySelector('#sheet .sheet-grip'), hb = document.querySelector('#sheet .headbar'); if (!g || !hb) return null; const gz = +getComputedStyle(g).zIndex || 0, hz = +getComputedStyle(hb).zIndex || 0; return { gz, hz }; });
  ok('操作バーのあるシートでも、つまみがバーより手前に出る', !!onBar && onBar.gz > onBar.hz, onBar);
  await page.evaluate(() => { closeSheet(); go('home'); openReminder(DB.reminders[0].id); }); await page.waitForTimeout(200);

  // ---- 2. 下へ引いている途中は、シートが指についてくる ----
  let a = await sheetTop(page);
  await drag(page, a.x, a.y, a.x, a.y + 60, false);
  const mid = await page.evaluate(() => document.querySelector('#sheet').style.transform);
  ok('下へ引いている途中、シートが指の分だけ下がる', /translateY\(60px\)/.test(mid), mid);
  await release(page, a.x, a.y + 20);
  await page.waitForTimeout(250);

  // ---- 3. 少しだけ引いて離すと元の位置に戻る ----
  await page.evaluate(() => { closeSheet(); openReminder(DB.reminders[0].id); }); await page.waitForTimeout(200);
  a = await sheetTop(page);
  await drag(page, a.x, a.y, a.x, a.y + 20);
  await page.waitForTimeout(250);
  ok('少しだけ引いて離すとシートは閉じず元の位置に戻る', await shown(page) && !(await page.evaluate(() => document.querySelector('#sheet').style.transform.replace('translateY(0px)', ''))));

  // ---- 4. 十分に下へ引くと閉じる ----
  await drag(page, a.x, a.y, a.x, a.y + 160);
  await page.waitForTimeout(300);
  ok('十分に下へ引くと閉じる(自由入力なし→即閉じ)', !(await shown(page)));
  ok('閉じた後、次に開くシートに位置のずれが残らない', await page.evaluate(() => { openReminder(DB.reminders[0].id); const t = document.querySelector('#sheet').style.transform; closeSheet(); return !t || t === 'translateY(0px)'; }));

  // ---- 5. 左端からの右スワイプでは閉じない(右スワイプは「前の画面に戻る」の操作) ----
  await page.evaluate(() => openReminder(DB.reminders[0].id)); await page.waitForTimeout(200);
  ok('左端スワイプ用の帯(#edgeSwipeZone)は無い', await page.evaluate(() => !document.querySelector('#edgeSwipeZone')));
  a = await sheetTop(page);
  await drag(page, 10, a.y + 80, 200, a.y + 80);
  await page.waitForTimeout(250);
  ok('左端からの右スワイプではシートは閉じない', await shown(page) && !(await page.evaluate(() => /translateX/.test(document.querySelector('#sheet').style.transform))));
  // 左側のボタンもふつうに押せる(帯に吸われない)
  ok('シートの左側にある要素は、帯に隠れずそのまま指で触れる', await page.evaluate(() => { const s = document.querySelector('#sheet').getBoundingClientRect(); const el = document.elementFromPoint(20, s.top + s.height / 2); return !!el && document.querySelector('#sheet').contains(el); }));
  await page.evaluate(() => closeSheet());

  // ---- 6. 中身をスクロールした状態から下へなぞるのは、スクロール(閉じない) ----
  await page.evaluate(() => { go('home'); sheetMetricsMaster(); }); await page.waitForTimeout(200);
  const tall = await page.evaluate(() => { const s = document.querySelector('#sheet'); s.scrollTop = 200; return { st: s.scrollTop, sh: s.scrollHeight, ch: s.clientHeight }; });
  ok('(前提)長いシートは中身がスクロールできる', tall.st > 0, tall);
  a = await sheetTop(page);
  await drag(page, a.x, a.y + 100, a.x, a.y + 300);
  await page.waitForTimeout(250);
  ok('中身がスクロールされているときに下へなぞっても閉じない(スクロールを邪魔しない)', await shown(page) && !(await page.evaluate(() => /translateY\([1-9]/.test(document.querySelector('#sheet').style.transform))));
  // 一番上まで戻せば、下へ引いて閉じられる
  await page.evaluate(() => { document.querySelector('#sheet').scrollTop = 0; });
  await drag(page, a.x, a.y + 100, a.x, a.y + 300);
  await page.waitForTimeout(300);
  ok('一番上までスクロールした状態なら、下へ引いて閉じられる', !(await shown(page)));

  // ---- 7. 横方向の操作(分析項目のページャー)では閉じない ----
  await page.evaluate(() => { openStock('9001'); sheetAnalysisItem('9001', '事業構造'); }); await page.waitForTimeout(200);
  a = await sheetTop(page);
  await drag(page, 300, a.y + 150, 120, a.y + 170);
  await page.waitForTimeout(250);
  ok('横方向のスワイプではシートは閉じない', await shown(page));
  await page.evaluate(() => closeSheet());

  // ---- 8. 未保存の自由入力があると、下へ引いても確認ダイアログが出る ----
  await page.evaluate(() => { openStock('9001'); sheetEditHypo(null, '9001', 'memo'); });
  await page.waitForTimeout(200);
  await page.fill('#hy_text', 'テスト中の未保存メモ');
  a = await sheetTop(page);
  await drag(page, a.x, a.y, a.x, a.y + 160);
  await page.waitForTimeout(300);
  ok('未保存の入力があると下へ引いたとき確認ダイアログが出る', await page.evaluate(() => document.querySelector('#exitConfirm').classList.contains('show')));
  ok('確認ダイアログの間、元のシートは閉じず元の位置にある', await shown(page) && await page.evaluate(() => { const t = document.querySelector('#sheet').style.transform; return !t || t === 'translateY(0px)'; }));
  ok('入力内容が保持されている', await page.evaluate(() => document.querySelector('#hy_text').value) === 'テスト中の未保存メモ');
  await page.evaluate(() => cancelCloseSheet());
  await page.waitForTimeout(150);
  const afterCancel = await page.evaluate(() => ({ confirmHidden: !document.querySelector('#exitConfirm').classList.contains('show'), sheetStillShown: document.querySelector('#scrim').classList.contains('show'), text: document.querySelector('#hy_text').value }));
  ok('「編集を続ける」でダイアログが消えてシートは残り、入力も残る', afterCancel.confirmHidden && afterCancel.sheetStillShown && afterCancel.text === 'テスト中の未保存メモ', afterCancel);
  // メモの編集シートは上端のバーに「キャンセル」を置く形(✕は出さない)
  await page.evaluate(() => [...document.querySelectorAll('#sheet .headbar button')].find(b => /キャンセル/.test(b.textContent)).click());
  await page.waitForTimeout(150);
  ok('「キャンセル」でも未保存なら確認ダイアログが出る', await page.evaluate(() => document.querySelector('#exitConfirm').classList.contains('show')));
  await page.evaluate(() => confirmCloseSheet());
  await page.waitForTimeout(150);
  ok('「破棄して閉じる」で実際にシートが閉じる', !(await shown(page)));

  // ---- 9. 保存後のcloseSheet()は確認を挟まない(既存の保存フローは変わらない) ----
  await page.evaluate(() => { openStock('9001'); sheetEditHypo(null, '9001', 'memo'); });
  await page.waitForTimeout(200);
  await page.fill('#hy_text', '保存されるメモ');
  const before = await page.evaluate(() => DB.hypotheses.filter(h => h.kind === 'memo').length);
  await page.evaluate(() => saveHypo('', '9001', 'memo'));
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ n: DB.hypotheses.filter(h => h.kind === 'memo').length, sheetClosed: !document.querySelector('#scrim').classList.contains('show'), confirmNotShown: !document.querySelector('#exitConfirm').classList.contains('show') }));
  ok('保存すると確認なしでシートが閉じる(既存挙動を維持)', after.sheetClosed && after.confirmNotShown && after.n === before + 1, after);

  // ---- 10. 選択肢だけのシート(自由入力なし)は✕で即閉じ(確認なし) ----
  await page.evaluate(() => sheetStockMenu('9001'));
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('.sheet-close').click());
  await page.waitForTimeout(150);
  ok('メニューだけのシートは確認なしで即閉じる', await page.evaluate(() => !document.querySelector('#scrim').classList.contains('show') && !document.querySelector('#exitConfirm').classList.contains('show')));

  console.log('JSエラー:', JSON.stringify(errs));
  await browser.close();
})();
