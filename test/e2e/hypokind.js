// +メモ/+注目ポイントの統合、種別を作成画面で選ぶ、編集画面でのメモ⇄注目切り替えを確認
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

  // ---- 1. ボタンは1つだけ、「＋」のみ ----
  // 追加は画面内の「＋」ボタンではなく、見出しの右の文字ボタンに移した
  const addBtns = await p.evaluate(() => [...document.querySelectorAll('#view button')].filter(b => b.textContent.trim().startsWith('＋')).map(b => b.textContent.trim()));
  const heads = await p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')]
    .filter(e => e.textContent.includes('メモ・注目ポイント'))
    .map(e => (e.querySelector('.grp-edit') || {}).textContent));
  ok('画面内に「＋」ボタンは置かない', addBtns.length === 0);
  ok('追加は見出しの文字ボタン1つだけ', heads.length === 1 && heads[0].trim() === '追加');

  // ---- 2. タップすると種別セグメント付きの作成画面が開く ----
  await p.evaluate(() => { const b = [...document.querySelectorAll('#view button')].find(x => x.textContent.trim() === '＋'); b.click(); });
  await p.waitForTimeout(200);
  const sheetInfo = await p.evaluate(() => {
    const segBtns = [...document.querySelectorAll('#sheet .seg button')].map(b => ({ t: b.textContent.trim(), on: b.classList.contains('on') }));
    return { title: document.querySelector('#sheet h3').textContent, segBtns };
  });
  // 種別の既定・セグメントの並びは注目ポイント優位に変更済み(watchdefault.jsで詳しく検証)。
  // ここでは「1ボタンに統合され、作成画面のセグメントで種別を選ぶ・切り替えても入力が保たれる」
  // という統合の骨組み自体を確認する
  ok('タイトルは「注目ポイントを作成」(既定は注目ポイント)', sheetInfo.title === '注目ポイントを作成');
  ok('セグメントに 注目ポイント/メモ がある', sheetInfo.segBtns.length === 2 && sheetInfo.segBtns[0].t === '注目ポイント' && sheetInfo.segBtns[1].t === 'メモ');
  ok('既定は注目ポイントが選択されている', sheetInfo.segBtns[0].on && !sheetInfo.segBtns[1].on);

  // ---- 3. 入力途中の文章を保ったままセグメントで切り替えられる ----
  await p.evaluate(() => { document.querySelector('#hy_text').value = '書きかけのテキスト'; });
  await p.evaluate(() => { const b = [...document.querySelectorAll('#sheet .seg button')].find(x => x.textContent.trim() === 'メモ'); b.click(); });
  await p.waitForTimeout(200);
  const afterSwitch = await p.evaluate(() => ({
    title: document.querySelector('#sheet h3').textContent,
    text: document.querySelector('#hy_text').value,
    segOn: [...document.querySelectorAll('#sheet .seg button')].map(b => b.classList.contains('on')),
  }));
  ok('切り替えるとタイトルが「メモを作成」になる', afterSwitch.title === 'メモを作成');
  ok('入力していた文章が保たれる', afterSwitch.text === '書きかけのテキスト');
  ok('セグメントの選択状態も切り替わる', !afterSwitch.segOn[0] && afterSwitch.segOn[1]);

  // ---- 4. 保存するとメモとして登録される ----
  await p.evaluate(() => saveHypo('', STATE.stockId, 'memo'));
  await p.waitForTimeout(300);
  const newHypo = await p.evaluate(() => DB.hypotheses.find(h => h.text === '書きかけのテキスト'));
  ok('メモとして保存される', newHypo && newHypo.kind === 'memo');

  // ---- 5. 既存の項目を編集画面で メモ⇄注目 に切り替えられる(実際に保存されること含む) ----
  const memoId = await p.evaluate(() => DB.hypotheses.find(h => h.kind === 'memo' && h.stockId === STATE.stockId).id);
  await p.evaluate(hid => sheetEditHypo(hid), memoId);
  await p.waitForTimeout(200);
  const editSheet1 = await p.evaluate(() => ({
    title: document.querySelector('#sheet h3').textContent,
    segOn: [...document.querySelectorAll('#sheet .seg button')].map(b => b.classList.contains('on')),
  }));
  // セグメントの並びは 注目ポイント→メモ なので、メモが選択されているのは segOn[1]
  ok('既存メモの編集画面はメモが選択されている(全体の既定に引きずられない)', editSheet1.title === 'メモを編集' && !editSheet1.segOn[0] && editSheet1.segOn[1]);
  await p.evaluate(() => { const b = [...document.querySelectorAll('#sheet .seg button')].find(x => x.textContent.trim() === '注目ポイント'); b.click(); });
  await p.waitForTimeout(200);
  ok('編集中でも注目ポイントに切り替わる', await p.evaluate(() => document.querySelector('#sheet h3').textContent) === '注目ポイントを編集');
  await p.evaluate(() => { document.querySelector('#sheet .btn.pri').click(); });
  await p.waitForTimeout(300);
  const afterKindSave = await p.evaluate(id => DB.hypotheses.find(h => h.id === id).kind, memoId);
  ok('保存すると実際に種別(kind)が変わる', afterKindSave === 'watch');

  // ---- 6. 元々「注目ポイント」だった項目を「メモ」に変更した場合も保存が反映される ----
  const watchId = await p.evaluate(() => DB.hypotheses.find(h => h.kind === 'watch' && h.stockId === STATE.stockId && remindersOf(h.id).length === 0)?.id);
  ok('リマインダー無しの注目ポイントがある(テスト前提)', !!watchId);
  await p.evaluate(hid => sheetEditHypo(hid), watchId);
  await p.waitForTimeout(200);
  await p.evaluate(() => { const b = [...document.querySelectorAll('#sheet .seg button')].find(x => x.textContent.trim() === 'メモ'); b.click(); });
  await p.waitForTimeout(200);
  await p.evaluate(() => { document.querySelector('#sheet .btn.pri').click(); });
  await p.waitForTimeout(300);
  const afterKindSave2 = await p.evaluate(id => DB.hypotheses.find(h => h.id === id).kind, watchId);
  ok('注目→メモへの変更も保存される', afterKindSave2 === 'memo');

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
