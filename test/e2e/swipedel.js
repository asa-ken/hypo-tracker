// メモ・注目ポイントの右→左スワイプ削除、および紐づくリマインダーの扱いを確認
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
    for (let i = 1; i <= steps; i++) {
      t = mk(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
      el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    }
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

  const sid = await p.evaluate(() => { const s = DB.stocks.find(x => x.name === 'テスト精機'); openStock(s.id); return s.id; });
  await p.waitForTimeout(300);
  const rowBox = async () => p.evaluate(() => {
    const row = document.querySelector('#view .list .swipe .list-row');
    row.scrollIntoView({ block: 'center' });
    const r = row.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  // ---- 1. 通常のタップは従来どおり編集シートを開く(スワイプ機構が邪魔しない) ----
  await p.evaluate(() => document.querySelector('#view .list .swipe .list-row').click());
  await p.waitForTimeout(200);
  ok('通常タップは編集シートを開く', await p.evaluate(() =>
    !!document.querySelector('#sheet #hy_text') && !!document.querySelector('#sheet .headbar')));
  await p.evaluate(() => closeSheet());

  // ---- 2. 右→左スワイプで削除ボタンが出る ----
  let box = await rowBox(); await p.waitForTimeout(150);
  await swipe(p, box.x, box.y, box.x - 100, box.y);
  await p.waitForTimeout(250);
  const afterSwipe = await p.evaluate(() => {
    const fg = document.querySelector('#view .list .swipe .list-row');
    const b = document.querySelector('#view .list .swipe .del-btn');
    const br = b.getBoundingClientRect(), fr = fg.getBoundingClientRect();
    return { transform: fg.style.transform, delBtnVisible: br.left >= fr.right - 5 };
  });
  ok('スワイプで行が左に動く', /translateX\(-6[0-9](\.\d+)?px\)/.test(afterSwipe.transform));
  ok('削除ボタンが露出する', afterSwipe.delBtnVisible);

  // 右にスワイプし返して閉じる(内部状態も含めてきれいに戻す)。
  // 詳細画面の戻るスワイプ(画面左40%からの右スワイプ)と領域が重なるため、
  // 一覧に戻ってしまわず、行を閉じる動作だけが起きることも確認する
  box = await rowBox();
  await swipe(p, box.x, box.y, box.x + 100, box.y);
  await p.waitForTimeout(250);
  ok('開いた行は右スワイプで閉じる', await p.evaluate(() => { const t = document.querySelector('#view .list .swipe .list-row').style.transform; return t === '' || t === 'translateX(0px)'; }));
  ok('戻るスワイプと誤って競合せず、詳細画面のまま(一覧に戻らない)', await p.evaluate(() => !!STATE.stockId));
  // リマインダーに紐づく分はまとまりのカードに畳まれ、スワイプ対象にはならない
  ok('行を閉じても他の行は消えない(単独カードは全部残る)', await p.evaluate(() => {
    const linked = new Set();
    DB.reminders.forEach(r => (r.hypoIds || []).forEach(id => linked.add(id)));
    const alone = hyposOf(STATE.stockId).filter(h => !linked.has(h.id)).length;
    return document.querySelectorAll('#view .list .swipe .list-row').length === alone;
  }));

  // 短いスワイプ(しきい値未満)では開かない
  box = await rowBox();
  await swipe(p, box.x, box.y, box.x - 10, box.y);
  await p.waitForTimeout(250);
  ok('しきい値未満のスワイプでは開かない', await p.evaluate(() => { const t = document.querySelector('#view .list .swipe .list-row').style.transform; return t === '' || t === 'translateX(0px)'; }));

  // 縦スクロールは邪魔されない
  box = await rowBox();
  await swipe(p, box.x, box.y, box.x - 5, box.y - 150);
  await p.waitForTimeout(250);
  ok('縦方向のドラッグでは開かない', await p.evaluate(() => { const t = document.querySelector('#view .list .swipe .list-row').style.transform; return t === '' || t === 'translateX(0px)'; }));

  // ---- 3. リマインダーが紐づかないメモ: 削除ボタンで即確認ダイアログ ----
  const noRemHid = await p.evaluate(() => hyposOf(STATE.stockId).find(h => !remindersOf(h.id).length && h.kind === 'memo')?.id);
  ok('リマインダー無しのメモがテストデータにある', !!noRemHid);
  await p.evaluate(hid => delHypo(hid), noRemHid);
  await p.waitForTimeout(200);
  const simpleConfirm = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok('リマインダー無しなら単純な削除確認が出る', /削除する/.test(simpleConfirm) && !/リマインダーのみ削除/.test(simpleConfirm));
  await p.evaluate(() => closeSheet());

  // ---- 4. リマインダーが紐づくメモ: 選択肢が出る ----
  const withRemHid = await p.evaluate(() => hyposOf(STATE.stockId).find(h => remindersOf(h.id).length)?.id);
  ok('リマインダー有りの注目ポイントがテストデータにある', !!withRemHid);
  const linkedCount = await p.evaluate(hid => remindersOf(hid).length, withRemHid);
  await p.evaluate(hid => delHypo(hid), withRemHid);
  await p.waitForTimeout(200);
  const choiceText = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok('紐づくリマインダー件数が表示される', new RegExp(linkedCount + '件のリマインダーが紐づいています').test(choiceText));
  ok('3つの選択肢+キャンセルが出る', /この内容だけ削除/.test(choiceText) && /リマインダーのみ削除/.test(choiceText) && /両方削除/.test(choiceText) && /キャンセル/.test(choiceText));
  await p.evaluate(() => closeSheet());

  // ---- 5. リマインダーのみ削除: 他の注目ポイントとも共有しているリマインダーは、
  //          このメモとの紐づけだけ外し、他の紐づけが残る限りリマインダー自体は消えない ----
  // テストデータの r_t1 は h_t1/h_t2/h_t3 の3件と共有されている
  const before5 = await p.evaluate(() => ({ rem: DB.reminders.length, sharedHypoIds: DB.reminders.find(r => r.id === 'r_t1').hypoIds.slice() }));
  ok('r_t1は複数の注目ポイントと共有されている(テスト前提)', before5.sharedHypoIds.length > 1);
  await p.evaluate(() => doDelRemindersOnly('h_t1'));
  await p.waitForTimeout(300);
  const after5 = await p.evaluate(() => ({ rem: DB.reminders.length, hypoExists: !!DB.hypotheses.find(h => h.id === 'h_t1'), r_t1: DB.reminders.find(r => r.id === 'r_t1') }));
  ok('共有リマインダーは消えず、このメモの紐づけだけ外れる', !!after5.r_t1 && !after5.r_t1.hypoIds.includes('h_t1') && after5.rem === before5.rem);
  ok('メモ本体(h_t1)は残る', after5.hypoExists);

  // ---- 6. 単独リンクのリマインダー(r_t3)は、リマインダーのみ削除で実際に消える ----
  const before6 = await p.evaluate(() => ({ rem: DB.reminders.length, hasR3: !!DB.reminders.find(r => r.id === 'r_t3') }));
  ok('r_t3が存在する(テスト前提)', before6.hasR3);
  await p.evaluate(() => doDelRemindersOnly('h_t8'));
  await p.waitForTimeout(300);
  const after6 = await p.evaluate(() => ({ rem: DB.reminders.length, hasR3: !!DB.reminders.find(r => r.id === 'r_t3'), hypoExists: !!DB.hypotheses.find(h => h.id === 'h_t8') }));
  ok('唯一の紐づけ先だったリマインダーは実際に削除される', !after6.hasR3 && after6.rem === before6.rem - 1);
  ok('この場合もメモ本体(h_t8)は残る', after6.hypoExists);

  // ---- 7. 両方削除 ----
  const before7 = await p.evaluate(() => ({ hasHypo: !!DB.hypotheses.find(h => h.id === 'h_t10'), hasR4: !!DB.reminders.find(r => r.id === 'r_t4') }));
  ok('h_t10/r_t4が存在する(テスト前提)', before7.hasHypo && before7.hasR4);
  await p.evaluate(() => doDelHypoAndReminders('h_t10'));
  await p.waitForTimeout(300);
  const after7 = await p.evaluate(() => ({ hasHypo: !!DB.hypotheses.find(h => h.id === 'h_t10'), hasR4: !!DB.reminders.find(r => r.id === 'r_t4') }));
  ok('両方削除するとメモもリマインダーも消える', !after7.hasHypo && !after7.hasR4);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
