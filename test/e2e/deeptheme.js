// 「調べる項目を選ぶ」の「深掘りテーマ」欄は、以前は銘柄詳細の「注目テーマ」カード
// (DB.askPrefs.themes、タップで編集する永続設定)と保存先を共有していた。この欄に入力して
// ボタンを押すと、その銘柄の「注目テーマ」まで意図せず上書きされてしまうバグがあり、
// また前回入力した内容が次に画面を開いたときも残ってしまっていた(ユーザー指摘、2026-08-13)。
// 「深掘りテーマ」は質問文生成のためだけの一時入力(STATE._deepTheme、保存しない)に分離し、
// 画面を開き直すたびに空欄に戻るようにした。「注目テーマ」には一切影響しない
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  // ---- 1. 先に「注目テーマ」を永続設定しておく(別画面・別機能) ----
  await p.evaluate(() => { sheetTheme('9001'); document.querySelector('#th_in').value = '既存の注目テーマ'; doSaveTheme('9001'); });
  await p.waitForTimeout(300);

  // ---- 2. 「調べる項目を選ぶ」を開いても、深掘りテーマ欄は空(注目テーマを引き継がない) ----
  await p.evaluate(() => { openStock('9001'); sheetOrderNew('9001'); });
  await p.waitForTimeout(250);
  ok('深掘りテーマ欄は「注目テーマ」を引き継がず空で始まる', await p.evaluate(() =>
    document.querySelector('#ord_theme').value === ''));

  // ---- 3. 深掘りテーマに入力してボタンを押しても、「注目テーマ」は上書きされない ----
  await p.evaluate(() => {
    document.querySelector('#ord_theme').value = '一時的な深掘りテーマ';
    document.querySelectorAll('#sheet .list-row button')[0].click(); // cyclePick(選択)
  });
  await p.waitForTimeout(250);
  ok('選択操作(この画面内の再描画)では入力中の深掘りテーマを消さない', await p.evaluate(() =>
    document.querySelector('#ord_theme').value === '一時的な深掘りテーマ'));
  await p.waitForTimeout(250);
  ok('選択操作を挟んでも「注目テーマ」は上書きされない', await p.evaluate(() => DB.askPrefs.themes['9001'] === '既存の注目テーマ'));

  const gen = await p.evaluate(() => { genOrderNew('9001'); const ta = document.querySelector('#sheet textarea'); return ta ? ta.value : null; });
  await p.waitForTimeout(200);
  ok('質問文には深掘りテーマの入力内容が反映される', /■注目テーマ: 一時的な深掘りテーマ/.test(gen || ''), gen);
  ok('質問文生成後も「注目テーマ」は上書きされない', await p.evaluate(() => DB.askPrefs.themes['9001'] === '既存の注目テーマ'));
  await p.evaluate(() => closeSheet());

  // ---- 4. 画面を開き直すと、深掘りテーマは空に戻る(前回の入力を引き継がない) ----
  await p.evaluate(() => { go('home'); }); await p.waitForTimeout(200);
  await p.evaluate(() => { openStock('9001'); sheetOrderNew('9001'); });
  await p.waitForTimeout(250);
  ok('画面を開き直すと深掘りテーマは空に戻る', await p.evaluate(() => document.querySelector('#ord_theme').value === ''));
  ok('「注目テーマ」カードの表示は引き続き残る(別機能なので消えない)', await p.evaluate(() => {
    const el = document.querySelector('#view .card.tap');
    return !!el && /既存の注目テーマ/.test(el.textContent);
  }));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
