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

  // テーマカードを作る
  await p.evaluate(() => { sheetAddMarket('テーマ'); document.querySelector('#am_mname').value='AIテーマ'; doAddMarket(); });
  await p.waitForTimeout(400);
  const id = await p.evaluate(() => DB.stocks.find(s=>s.name==='AIテーマ').id);

  const before = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('テーマカードに代表指数の欄が出る', /代表指数・ETF/.test(before));
  ok('未設定の案内が出る', /未設定\(決めるとAIの答える数値がぶれません\)/.test(before));

  // 編集シートに欄がある
  await p.evaluate(i => sheetTheme(i), id); await p.waitForTimeout(250);
  const sh = await p.evaluate(() => ({ txt: document.querySelector('#sheet').innerText, has: !!document.querySelector('#th_bm'),
    ph: document.querySelector('#th_bm') ? document.querySelector('#th_bm').placeholder : null }));
  ok('編集シートに代表指数の入力欄がある', sh.has);
  ok('テーマ向けのプレースホルダが出る', /グローバルX/.test(sh.ph||''));
  ok('見出しが「注目テーマ・代表指数」', /注目テーマ・代表指数/.test(sh.txt));

  // 保存
  await p.evaluate(i => { document.querySelector('#th_in').value='生成AIの実装普及';
    document.querySelector('#th_bm').value='グローバルX AI&ビッグデータETF (2638)'; doSaveTheme(i); }, id);
  await p.waitForTimeout(400);
  const saved = await p.evaluate(i => ({ bm: stock(i).benchmark, theme: DB.askPrefs.themes[i] }), id);
  ok('代表指数が保存される', saved.bm === 'グローバルX AI&ビッグデータETF (2638)');
  ok('テーマも同時に保存される', saved.theme === '生成AIの実装普及');

  await p.evaluate(i => openStock(i), id); await p.waitForTimeout(300);
  const after = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('カードに代表指数が表示される', /グローバルX AI&ビッグデータETF/.test(after));
  ok('指標欄のヒントにも基準が出る', /基準: グローバルX/.test(after));

  // 質問文に載る
  const prompt = await p.evaluate(i => { DB.askPrefs.picks={'何が起きているか':'sum'}; genOrderNew(i);
    const ta=document.querySelector('#sheet textarea'); return ta?ta.value:null; }, id);
  await p.evaluate(() => closeSheet());
  ok('質問文に基準指数が載る', /■基準とする指数・ETF: グローバルX AI&ビッグデータETF \(2638\)/.test(prompt||''));
  ok('質問文に基準の使い方が書かれる', /指標や水準は、これを基準に答えてください/.test(prompt||''));

  // 銘柄カードには出ない
  await p.evaluate(() => sheetTheme('9001')); await p.waitForTimeout(250);
  const stk = await p.evaluate(() => ({ has: !!document.querySelector('#th_bm'), txt: document.querySelector('#sheet').innerText }));
  ok('銘柄には代表指数の欄を出さない', stk.has === false);
  ok('銘柄の見出しは従来どおり', /注目テーマ/.test(stk.txt) && !/代表指数/.test(stk.txt));
  await p.evaluate(() => closeSheet());

  // 空にすると消える
  await p.evaluate(i => { sheetTheme(i); }, id); await p.waitForTimeout(200);
  await p.evaluate(i => { document.querySelector('#th_bm').value=''; doSaveTheme(i); }, id);
  await p.waitForTimeout(300);
  ok('空欄で保存すると代表指数が消える', await p.evaluate(i => stock(i).benchmark === undefined, id));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
