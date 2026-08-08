const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

const MD = `# 銘柄: フジクラ (5803)

## 注目ポイント
- 本文: 1Q決算で情報通信セグメントの利益率が改善しているか
- イベント日: 2026/8/7

## 注目ポイント
- 本文: 同じ決算で受注残の積み上がりを確認する
- イベント日: 2026/8/7

## 注目ポイント
- 本文: 日付のない観点。ここは候補日を持たない
`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(() => { localStorage.removeItem('hypo_tracker_proto_v1'); });
  await page.reload();
  await page.waitForTimeout(400);

  // 取り込み
  await page.evaluate(() => go('import'));
  await page.waitForTimeout(250);
  await page.evaluate(md => { document.querySelector('#mdIn').value = md; parseAndPreview(); }, MD);
  await page.waitForTimeout(300);
  const prev = await page.evaluate(() => document.querySelector('#parseOut').innerText);
  ok('プレビューが「リマインド候補」と表示する', /リマインド候補: 2026\/8\/7/.test(prev));
  ok('プレビューに「イベント日:」という表記が残っていない', !/^イベント日:/m.test(prev));

  // 日付つきの注目ポイントは、取り込みプレビューの中でリマインダーにするか決める
  // (以前は読み込み後に確認シートを出していた)
  const box = await page.evaluate(() => {
    const e = document.querySelector('#parseOut .rembox');
    return e ? { rows: e.querySelectorAll('.rrow').length, on: e.querySelectorAll('.sw.on').length } : null;
  });
  ok('プレビューにリマインダー欄が出る', !!box);
  ok('日付つきの2件が並ぶ', box.rows === 2);
  ok('既定はオン', box.on === 2);

  await page.evaluate(() => commitImport());
  await page.waitForTimeout(500);

  const st = await page.evaluate(() => {
    const hs = DB.hypotheses.filter(h => h.kind === 'watch' && /情報通信セグメントの利益率が改善|受注残の積み上がり|日付のない観点/.test(h.text));
    const r = DB.reminders.filter(x => x.src === '取り込み');
    return { hints: hs.map(h => h.remindHint ? h.remindHint.date : null),
             made: r.length, ids: r.length ? (r[0].hypoIds || []).length : 0,
             date: r.length ? r[0].startDate : null,
             prompt: r.length ? (r[0].prompt || '') : '',
             sheetOpen: document.querySelector('#scrim').classList.contains('show'),
             remaining: pendingHints().filter(h => /情報通信セグメントの利益率が改善|受注残の積み上がり/.test(h.text)).length };
  });
  ok('読み込みと同時にリマインダーができる', st.made === 1);
  ok('同じ日の2件が1つにまとまる', st.ids === 2);
  ok('日付が引き継がれる', st.date === '2026/8/7');
  ok('実行プロンプトに2件の注目ポイントが入る', /利益率が改善/.test(st.prompt) && /受注残/.test(st.prompt));
  ok('登録した分の候補日は消える', st.remaining === 0);
  ok('日付なしの1件は候補日を持たない', st.hints.includes(null));
  ok('読み込み後に確認シートを出さない', st.sheetOpen === false);

  console.log('JSエラー:', JSON.stringify(errs));
  await browser.close();
})();
