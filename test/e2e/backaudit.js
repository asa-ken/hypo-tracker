const { chromium } = require('playwright');
// 時刻を固定する(2026-09-25追記)。固定していないと、実行日がフィクスチャの日付から離れるにつれ
// 期限切れ・今週の予定などの判定が変わって落ちる(9/24に8スイート、9/25にcloseBtnが実際に失敗)。
// 他のスイートと同じ日付に揃える
const CLOCK = new Date('2026-08-22T03:00:00Z');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.clock.install({ time: CLOCK });
  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload();
  await page.waitForTimeout(400);

  // ---- 1. 銘柄詳細: 戻るボタンの存在と動作 ----
  await page.evaluate(() => go('analysis'));
  await page.waitForTimeout(200);
  await page.evaluate(() => openStock('9001'));
  await page.waitForTimeout(200);
  const backBtn = await page.evaluate(() => document.querySelector('#topAct').textContent);
  ok('銘柄詳細に「← 戻る」がある', backBtn.includes('戻る'));
  await page.evaluate(() => document.querySelector('#topAct').click());
  await page.waitForTimeout(200);
  const afterBack = await page.evaluate(() => STATE.stockId);
  ok('戻るを押すと銘柄詳細を抜ける', afterBack === null);

  // ---- 1b. 「＋ 追加」から進む2つのシートは、どちらも1つ前(銘柄か市場かを選ぶ画面)へ戻れる ----
  // 2026-10-04: 「市場・業界・テーマを追加」には「← 戻る」があったが、「銘柄を追加」には無かった
  // (2026-10-01に提示した課題G、ユーザー指示で追加)。同じ見た目・同じ位置(最下部)にそろえる
  const backOf = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('#sheet button')].find(x => x.textContent.trim() === '← 戻る');
    const all = [...document.querySelectorAll('#sheet button')];
    return b ? { cls: b.className, last: all[all.length - 1] === b, mt: b.style.marginTop } : null;
  });
  await page.evaluate(() => { closeSheet(); sheetAddMarket(); }); await page.waitForTimeout(150);
  const mBack = await backOf();
  await page.evaluate(() => { closeSheet(); sheetAddStock2(); }); await page.waitForTimeout(150);
  const sBack = await backOf();
  ok('銘柄を追加シートに「← 戻る」がある', !!sBack);
  ok('「← 戻る」は最下部にある', !!sBack && sBack.last);
  ok('市場を追加シートの「← 戻る」と同じ見た目', !!sBack && !!mBack && sBack.cls === mBack.cls && sBack.mt === mBack.mt);
  if (sBack) {
    await page.evaluate(() => [...document.querySelectorAll('#sheet button')].find(x => x.textContent.trim() === '← 戻る').click());
    await page.waitForTimeout(150);
  }
  ok('押すと「追加」(銘柄か市場かを選ぶ画面)に戻る', await page.evaluate(() =>
    document.querySelector('#scrim').classList.contains('show') && (document.querySelector('#sheet h3') || {}).textContent === '追加'));
  // 2026-10-04: 「追加」の選択画面の見出しの頭の「●」「◆」は外した(ユーザー指示)。
  // 一覧の市場の行から「◆」を外したのに合わせ、記号でなく見出しの言葉と説明文で区別する
  const choice = await page.evaluate(() => [...document.querySelectorAll('#sheet .card.tap')].map(c => c.firstElementChild.textContent.trim()));
  ok('「追加」の選択画面の見出しに「●」「◆」を付けない', choice.length === 2 && choice.every(t => !/[●◆]/.test(t)), choice);
  ok('見出しの言葉はそのまま(銘柄を追加 / 市場・業界・テーマを追加)', choice[0] === '銘柄を追加' && choice[1] === '市場・業界・テーマを追加', choice);
  await page.evaluate(() => closeSheet());

  // ---- 2. 各シートを開いて、scrim(背景)タップで閉じるか確認 ----
  const sheetTests = [
    { name: 'sheetStockMenu', code: "sheetStockMenu('9001')" },
    { name: 'sheetTheme', code: "sheetTheme('9001')" },
    { name: 'openReminder', code: "openReminder(DB.reminders[0].id)" },
    { name: 'sheetEditReminder', code: "sheetEditReminder(DB.reminders[0].id)" },
    { name: 'sheetEditHypo(新規メモ)', code: "sheetEditHypo(null, '9001', 'memo')" },
    { name: 'sheetEditHypo(新規注目)', code: "sheetEditHypo(null, '9001', 'watch')" },
    { name: 'sheetAddStock', code: "sheetAddStock()" },
    { name: 'sheetAddMarket', code: "sheetAddMarket()" },
    { name: 'sheetAddStock2', code: "sheetAddStock2()" },
    { name: 'sheetAddDetail', code: "sheetAddDetail('9001', null)" },
    { name: 'sheetOrderNew', code: "sheetOrderNew('9001')" },
    { name: 'sheetSectionMaster', code: "sheetSectionMaster('9001')" },
    { name: 'sheetAddReminder', code: "sheetAddReminder('9001', [])" },
    { name: 'sheetMetricsMaster', code: "sheetMetricsMaster()" },
    { name: 'sheetBackup', code: "sheetBackup()" },
    { name: 'askConfirm', code: "askConfirm({title:'t', body:'b', onOk:()=>{}})" },
  ];

  for (const t of sheetTests) {
    await page.evaluate(() => { closeSheet(); });
    await page.waitForTimeout(80);
    let threw = null;
    try {
      await page.evaluate((src) => { (0, eval)(src); }, t.code);
    } catch (e) { threw = String(e); }
    await page.waitForTimeout(120);
    if (threw) { ok(t.name + ': エラーなく開く', false); console.log('  ' + threw); continue; }
    const state = await page.evaluate(() => ({
      shown: document.querySelector('#scrim').classList.contains('show'),
      html: document.querySelector('#sheet').innerHTML.length,
    }));
    if (!state.shown || state.html === 0) { ok(t.name + ': シートが開く', false); continue; }
    // scrim自身(背景)をクリック — sheet内部ではなく scrim 要素そのものにイベントを飛ばす
    await page.evaluate(() => {
      const scrim = document.querySelector('#scrim');
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'target', { value: scrim, enumerable: true });
      scrim.dispatchEvent(ev);
    });
    await page.waitForTimeout(120);
    const closed = await page.evaluate(() => !document.querySelector('#scrim').classList.contains('show'));
    ok(t.name + ': 背景タップで閉じる', closed);
  }

  console.log('JSエラー:', JSON.stringify(errs));
  await browser.close();
})();
