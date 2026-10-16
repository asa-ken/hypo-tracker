// 注目ポイントを既定・先頭にする変更と、ベルアイコンのSVG化を確認
const { chromium } = require('playwright');
// 時刻を固定する(2026-09-25追記)。固定していないと、実行日がフィクスチャの日付から離れるにつれ
// 期限切れ・今週の予定などの判定が変わって落ちる(9/24に8スイート、9/25にcloseBtnが実際に失敗)。
// 他のスイートと同じ日付に揃える
const CLOCK = new Date('2026-08-22T03:00:00Z');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install({ time: CLOCK });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  const sid = await p.evaluate(() => { const s = DB.stocks.find(x => x.name === 'テスト精機'); openStock(s.id); return s.id; });
  await p.waitForTimeout(300);

  // ---- 1. 新規作成の既定は注目ポイント ----
  // 追加の入口は「メモ・注目ポイント」見出しの「追加」(画面内の「＋」ボタンは廃止済み。2026-10-15、旧版はここで止まっていた)
  await p.evaluate(() => { const h = [...document.querySelectorAll('#view .lbl.grp')].find(e => e.textContent.includes('メモ・注目ポイント')); h.querySelector('.grp-edit').click(); });
  await p.waitForTimeout(200);
  const sheetInfo = await p.evaluate(() => ({
    title: document.querySelector('#sheet .headbar .t').textContent,
    segBtns: [...document.querySelectorAll('#sheet .seg button')].map(b => ({ t: b.textContent.trim(), on: b.classList.contains('on') })),
  }));
  ok('タイトルは「注目ポイントを作成」', sheetInfo.title === '注目ポイントを作成');
  ok('セグメントの並びは 注目ポイント→メモ', sheetInfo.segBtns[0].t === '注目ポイント' && sheetInfo.segBtns[1].t === 'メモ');
  ok('既定は注目ポイントが選択されている', sheetInfo.segBtns[0].on && !sheetInfo.segBtns[1].on);

  // 保存すると実際にwatchとして登録される
  await p.evaluate(() => { document.querySelector('#hy_text').value = '既定確認用のテキスト'; });
  await p.evaluate(() => document.querySelector('#sheet .headbar .act').click());
  await p.waitForTimeout(300);
  const created = await p.evaluate(() => DB.hypotheses.find(h => h.text === '既定確認用のテキスト'));
  ok('保存すると注目ポイント(watch)として登録される', created && created.kind === 'watch');

  // 既存メモを編集で開いた場合は、その項目自身のkindに従う(全体の既定に引きずられない)
  const memoId = await p.evaluate(() => DB.hypotheses.find(h => h.kind === 'memo' && h.stockId === STATE.stockId).id);
  await p.evaluate(hid => sheetEditHypo(hid), memoId);
  await p.waitForTimeout(200);
  ok('既存メモの編集はメモのまま開く(全体既定に引きずられない)', await p.evaluate(() => document.querySelector('#sheet .headbar .t').textContent) === 'メモ');
  await p.evaluate(() => closeSheet());

  // ---- 2. ベルアイコンがSVG化されている(絵文字が残っていない) ----
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id));
  await p.waitForTimeout(300);
  const bodyText = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('画面テキストに🔔の絵文字が残っていない', !/🔔/.test(bodyText));
  // ベルが出るのは「日付の候補があるのに未登録」の注目ポイントのチップ(リマインダーに紐づいた項目は、
  // 2026-08 以降リマインダー1件=1枚のカード(remGroupCard)にまとめて出し、ベルは付けない。
  // 旧版は紐づいた項目の「次回」にベルがある前提で、その手前で止まっていた。2026-10-15)
  const hintId = await p.evaluate(() => {
    const h = DB.hypotheses.find(x => x.kind === 'watch' && x.stockId === STATE.stockId && remindersOf(x.id).length === 0);
    h.remindHint = { date: '2026-09-30' }; save(); render(); return h.id;
  });
  await p.waitForTimeout(200);
  const bell = await p.evaluate(() => {
    const chip = [...document.querySelectorAll('#view .chip.amber')].find(e => /候補/.test(e.textContent));
    const svg = chip && chip.querySelector('svg path[d^="M18 8a6 6 0"]');
    return { found: !!svg, color: svg ? getComputedStyle(svg.closest('svg')).color : null, chipColor: chip ? getComputedStyle(chip).color : null };
  });
  ok('候補日のある未登録の注目ポイントには、ベル型のSVGが出る', bell.found, bell);
  ok('ベルは周りの文字色(チップの色)を継承する', !!bell.color && bell.color === bell.chipColor, bell);
  ok('リマインダーに紐づいた項目は、リマインダーのカードとして「次回」を出す', await p.evaluate(() => [...document.querySelectorAll('#view .rgrp .meta')].some(e => /次回|休止中/.test(e.textContent))));

  // 編集シートのリマインダー一覧にも絵文字が無いこと
  const hypoWithRem = await p.evaluate(() => DB.hypotheses.find(h => remindersOf(h.id).length)?.id);
  await p.evaluate(hid => sheetEditHypo(hid), hypoWithRem);
  await p.waitForTimeout(200);
  const sheetText = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok('編集シートのリマインダー一覧にも絵文字が残っていない', !/🔔/.test(sheetText));
  ok('編集シートのリマインダー一覧に「次回」が出る', /次回/.test(sheetText));
  await p.evaluate(() => closeSheet());

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
