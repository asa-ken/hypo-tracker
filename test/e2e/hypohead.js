// メモ・注目ポイント: 折りたたみボタンを廃止 / 追加は見出しの文字ボタン /
// リマインダーの日時はカードに出すが、共有の注記は付けない
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

const headOf = (p, name) => p.evaluate(n => {
  const e = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.textContent.includes(n));
  if (!e) return null;
  const edit = e.querySelector('.grp-edit');
  return { label: e.querySelector('span').textContent.trim(), edit: edit ? edit.textContent.trim() : null,
           caret: !!e.querySelector('.grp-caret svg'),
           editRight: edit ? Math.round(e.getBoundingClientRect().right - edit.getBoundingClientRect().right) : null };
}, name);

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => openStock('9001')); await p.waitForTimeout(450);

  // ---- 1. 折りたたみボタンを出さない ----
  ok('前提: 7件ある(3件の上限を超える)', await p.evaluate(() =>
    DB.hypotheses.filter(h => h.stockId === '9001').length === 7));
  ok('「残りN件を表示」ボタンを出さない', await p.evaluate(() =>
    !/残り\s*\d+件を表示/.test(document.querySelector('#view').innerText)));
  // 紐づく3件はリマインダーのカードに畳まれるので、単独カード4枚＋まとまり1枚
  ok('最初から全件が並ぶ(畳まれた分はまとまりに入る)', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards > .swipe').length === 4 &&
    document.querySelectorAll('#view .list.cards > .rgrp').length === 1));
  ok('hypoAll の状態を持たなくなった', await p.evaluate(() => STATE.hypoAll === undefined));

  // ---- 2. 追加は見出しの文字ボタン ----
  const memo = await headOf(p, 'メモ・注目ポイント');
  const trend = await headOf(p, '業績推移');
  ok('見出しに「追加」が出る', memo && memo.edit === '追加');
  ok('業績推移は「編集」のまま', trend && trend.edit === '編集');
  ok('見出しは開閉できる(矢尻がある)', memo && memo.caret);
  ok('「追加」の位置は業績推移の「編集」と揃う', memo && trend && memo.editRight === trend.editRight);
  ok('画面内の「＋」ボタンは無くなった', await p.evaluate(() =>
    ![...document.querySelectorAll('#view button')].some(x => x.textContent.trim() === '＋')));

  // 押すと追加シートが開く(見出しは開閉しない)
  const openBefore = await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards .swipe').length > 0);
  await p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')]
    .find(x => x.textContent.includes('メモ・注目ポイント')).querySelector('.grp-edit').click());
  await p.waitForTimeout(350);
  ok('「追加」で作成シートが開く', await p.evaluate(() => document.querySelector('#scrim').classList.contains('show')));
  ok('新規作成として開く(既存の編集ではない)', await p.evaluate(() =>
    /メモ|注目/.test(document.querySelector('#sheet').textContent) &&
    [...document.querySelectorAll('#sheet textarea')].every(t => !t.value)));
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(300);
  ok('「追加」を押しても見出しは畳まれない', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards .swipe').length > 0) === openBefore);

  // 見出し本体を押せば従来どおり畳める
  await p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')]
    .find(x => x.textContent.includes('メモ・注目ポイント')).click());
  await p.waitForTimeout(350);
  ok('見出しを押すと畳める', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards').length === 0));
  await p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')]
    .find(x => x.textContent.includes('メモ・注目ポイント')).click());
  await p.waitForTimeout(350);
  ok('もう一度押すと開く', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards > .swipe').length === 4 &&
    document.querySelectorAll('#view .list.cards > .rgrp').length === 1));

  // ---- 3. 紐づく注目ポイントは1枚にまとまり、日時は見出しに1つだけ ----
  const share = await p.evaluate(() => {
    const rs = DB.reminders.filter(r => r.stockId === '9001');
    const cards = [...document.querySelectorAll('#view .list.cards .swipe')].map(e => e.textContent.replace(/\s+/g, ' '));
    return { reminders: rs.length,
             linked: rs.map(r => (r.hypoIds || []).length),
             withNext: cards.filter(t => /次回/.test(t)).length,
             chips: cards.filter(t => /他\d+件と同じ/.test(t)).length };
  });
  ok('前提: リマインダーは2件', share.reminders === 2);
  ok('前提: そのうち1件が3つの注目ポイントに紐づく', share.linked.includes(3));
  ok('「他N件と同じ」のバッジは出さない', share.chips === 0);
  // 紐づく3件は1枚にまとまり、日時はその見出しに1つだけ出る
  ok('日時はまとまりの見出しに1つだけ出る', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards .rgrp .rgrp-h').length === 1 &&
    (document.querySelector('#view .list.cards').textContent.match(/次回 2026\/8\/28/g) || []).length === 1));
  ok('まとまりのカードに本文を並べない', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards .rgrp .swipe').length === 0));

  // ---- 0件のときは案内文と「追加」だけ ----
  await p.evaluate(() => { DB.hypotheses = DB.hypotheses.filter(h => h.stockId !== '9001'); save(); render(); });
  await p.waitForTimeout(350);
  const empty = await headOf(p, 'メモ・注目ポイント');
  ok('0件でも見出しと「追加」は出る', empty && empty.edit === '追加');
  ok('0件のときは書き分けの案内が出る', await p.evaluate(() =>
    /思ったことはメモに/.test(document.querySelector('#view').innerText)));
  ok('0件でも折りたたみボタンは出ない', await p.evaluate(() =>
    !/残り\s*\d+件を表示/.test(document.querySelector('#view').innerText)));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
