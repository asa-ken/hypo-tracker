// 注目ポイントを既定・先頭にする変更と、ベルアイコンのSVG化を確認
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

  const sid = await p.evaluate(() => { const s = DB.stocks.find(x => x.name === 'テスト精機'); openStock(s.id); return s.id; });
  await p.waitForTimeout(300);

  // ---- 1. 新規作成の既定は注目ポイント ----
  await p.evaluate(() => { const b = [...document.querySelectorAll('#view button')].find(x => x.textContent.trim() === '＋'); b.click(); });
  await p.waitForTimeout(200);
  const sheetInfo = await p.evaluate(() => ({
    title: document.querySelector('#sheet h3').textContent,
    segBtns: [...document.querySelectorAll('#sheet .seg button')].map(b => ({ t: b.textContent.trim(), on: b.classList.contains('on') })),
  }));
  ok('タイトルは「注目ポイントを作成」', sheetInfo.title === '注目ポイントを作成');
  ok('セグメントの並びは 注目ポイント→メモ', sheetInfo.segBtns[0].t === '注目ポイント' && sheetInfo.segBtns[1].t === 'メモ');
  ok('既定は注目ポイントが選択されている', sheetInfo.segBtns[0].on && !sheetInfo.segBtns[1].on);

  // 保存すると実際にwatchとして登録される
  await p.evaluate(() => { document.querySelector('#hy_text').value = '既定確認用のテキスト'; });
  await p.evaluate(() => document.querySelector('#sheet .btn.pri').click());
  await p.waitForTimeout(300);
  const created = await p.evaluate(() => DB.hypotheses.find(h => h.text === '既定確認用のテキスト'));
  ok('保存すると注目ポイント(watch)として登録される', created && created.kind === 'watch');

  // 既存メモを編集で開いた場合は、その項目自身のkindに従う(全体の既定に引きずられない)
  const memoId = await p.evaluate(() => DB.hypotheses.find(h => h.kind === 'memo' && h.stockId === STATE.stockId).id);
  await p.evaluate(hid => sheetEditHypo(hid), memoId);
  await p.waitForTimeout(200);
  ok('既存メモの編集はメモのまま開く(全体既定に引きずられない)', await p.evaluate(() => document.querySelector('#sheet h3').textContent) === 'メモを編集');
  await p.evaluate(() => closeSheet());

  // ---- 2. ベルアイコンがSVG化されている(絵文字が残っていない) ----
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id));
  await p.waitForTimeout(300);
  const bodyText = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('画面テキストに🔔の絵文字が残っていない', !/🔔/.test(bodyText));
  const bellSvgCount = await p.evaluate(() => document.querySelectorAll('#view svg path[d^="M18 8a6 6 0"]').length);
  ok('ベル型のSVGが描画されている', bellSvgCount > 0);
  const bellColor = await p.evaluate(() => {
    const meta = [...document.querySelectorAll('#view .meta')].find(e => /次回/.test(e.textContent));
    const svg = meta && meta.querySelector('svg');
    return svg ? getComputedStyle(svg).color : null;
  });
  ok('リマインダー登録済みのベルは周りの文字色(navy系)を継承する', bellColor && bellColor !== 'rgb(0, 0, 0)');

  // 編集シート内のリマインダー一覧、取り込みプレビューにも絵文字が無いこと
  const hypoWithRem = await p.evaluate(() => DB.hypotheses.find(h => remindersOf(h.id).length)?.id);
  await p.evaluate(hid => sheetEditHypo(hid), hypoWithRem);
  await p.waitForTimeout(200);
  const sheetText = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok('編集シートのリマインダー一覧にも絵文字が残っていない', !/🔔/.test(sheetText));
  ok('編集シートにもベルSVGが出る', await p.evaluate(() => document.querySelectorAll('#sheet svg path[d^="M18 8a6 6 0"]').length) > 0);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
