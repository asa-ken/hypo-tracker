const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');

const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload();
  await page.waitForTimeout(400);

  // ---- 1. migrate: eventDate → remindHint ----
  const mig = await page.evaluate(() => {
    const h4 = DB.hypotheses.find(h => h.id === 'h_t4');
    const h1 = DB.hypotheses.find(h => h.id === 'h_t1');
    return {
      h4hint: h4.remindHint,
      h4hasEventDate: 'eventDate' in h4,
      h1hint: h1.remindHint,               // r_t1 に紐づき済みなので候補は作らない
      anyEventDate: DB.hypotheses.some(h => 'eventDate' in h || 'eventType' in h || 'eventNote' in h),
    };
  });
  ok('日付つき未登録の注目ポイント → remindHint に移った', !!(mig.h4hint && mig.h4hint.date === '2026/9/12' && mig.h4hint.note === '設備投資計画の発表'));
  ok('eventDate は消えている', mig.h4hasEventDate === false);
  ok('リマインダー登録済みには候補日を作らない', mig.h1hint === undefined);
  ok('全カードから event* フィールドが消えている', mig.anyEventDate === false);

  // ---- 2. ホーム: 予定はリマインダーのみ ----
  await page.evaluate(() => go('home'));
  await page.waitForTimeout(250);
  const home = await page.evaluate(() => {
    const txt = document.querySelector('#view').innerText;
    return {
      hasEventLabel: /注目イベント/.test(txt),
      allNext: [...document.querySelectorAll('#view .list-row')].length,
      pendCard: /リマインド未登録/.test(txt),
      pendCount: pendingHints().length,
    };
  });
  ok('予定に「注目イベント」が並ばない', home.hasEventLabel === false);
  ok('予定はリマインダーのみ(次回の通知)', home.allNext > 0);
  ok('「リマインド未登録」カードが出る', home.pendCard === true);
  ok('未登録件数が pendingHints と一致', home.pendCount > 0);

  // ---- 3. 注目ポイント編集シートに日付欄がない ----
  await page.evaluate(() => { openStock('9001'); });
  await page.waitForTimeout(300);
  await page.evaluate(() => sheetEditHypo('h_t4'));
  await page.waitForTimeout(250);
  const edit = await page.evaluate(() => ({
    hasDate: !!document.querySelector('#hy_edate'),
    hasNote: !!document.querySelector('#hy_enote'),
    hasThenRemind: /リマインダーを登録|リマインダーを追加/.test(document.querySelector('#sheet').innerText),
  }));
  ok('編集シートにイベント日欄がない', edit.hasDate === false);
  ok('編集シートにイベント名欄がない', edit.hasNote === false);
  // 全幅ボタンではなく、状態が読める行から登録画面へ渡すようにした
  ok('リマインダーへの導線がある', edit.hasThenRemind === true);

  // ---- 4. 保存してリマインダーを登録 → 登録シートが開き日付が入っている ----
  await page.evaluate(() => saveHypo('h_t4', '9001', 'watch', true));
  await page.waitForTimeout(300);
  const reg = await page.evaluate(() => ({
    title: document.querySelector('#sheet h3') ? document.querySelector('#sheet h3').innerText : '',
    qdate: document.querySelector('#rm_qdate') ? document.querySelector('#rm_qdate').value : null,
    qtitle: document.querySelector('#rm_qtitle') ? document.querySelector('#rm_qtitle').value : null,
    hypo: document.querySelector('#rm_hypo') ? document.querySelector('#rm_hypo').value : null,
  }));
  ok('リマインダー登録シートが開く', /リマインダー登録/.test(reg.title));
  ok('候補日が日付欄に入っている', reg.qdate === '2026-09-12');
  ok('タイトルにイベント名が入っている', reg.qtitle === '設備投資計画の発表');
  ok('対象の注目ポイントが紐づいている', reg.hypo === 'h_t4');

  // ---- 5. かんたん登録 → 単発リマインダーが作られ、候補日が消える ----
  const before = await page.evaluate(() => DB.reminders.length);
  await page.evaluate(() => quickAddReminder());
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => {
    const r = DB.reminders[DB.reminders.length - 1];
    const h4 = DB.hypotheses.find(h => h.id === 'h_t4');
    return {
      n: DB.reminders.length,
      start: r.startDate, end: r.endDate, times: r.times, hypoIds: r.hypoIds, title: r.title,
      nextFire: r.nextFire,
      hintCleared: h4.remindHint === undefined,
      sheetOpen: document.querySelector('#sheet').classList.contains('open'),
    };
  });
  ok('リマインダーが1件増えた', after.n === before + 1);
  ok('その日1回だけ(開始日=終了日)', after.start === '2026/9/12' && after.end === '2026/9/12');
  ok('次回通知がイベント当日', /2026\/9\/12/.test(after.nextFire || ''));
  ok('注目ポイントに紐づいている', JSON.stringify(after.hypoIds) === '["h_t4"]');
  ok('登録済みなので候補日が消えた', after.hintCleared === true);
  ok('登録後にシートが閉じる', after.sheetOpen === false);

  // ---- 6. 注目ポイントカードにリマインダーが表示される ----
  await page.evaluate(() => openStock('9001'));
  await page.waitForTimeout(300);
  const card = await page.evaluate(() => {
    const t = document.querySelector('#view').innerText;
    return { hasBell: /次回\s*2026\//.test(t), hasPend: /リマインド未登録/.test(t) };
  });
  ok('カードに紐づくリマインダーが表示される', card.hasBell === true);
  ok('登録済みなので「未登録」表示は消えた', card.hasPend === false);

  // ---- 7. ホームの予定にその日が現れる ----
  const inTimeline = await page.evaluate(() => { go('home'); return document.querySelector('#view').innerText; });
  ok('ホームの予定にリマインダーとして現れる', /設備投資計画の発表/.test(inTimeline));

  console.log('JSエラー:', JSON.stringify(errs));
  await page.screenshot({ path: __dirname + '/unify_home.png', fullPage: true });
  await browser.close();
})();
