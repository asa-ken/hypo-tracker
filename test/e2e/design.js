// デザインブラッシュアップ(観点A〜F)の回帰テスト
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload(); await page.waitForTimeout(400);

  // ---- A. 文字サイズは6段階だけ ----
  const src = fs.readFileSync(__dirname + '/../../../../../../home/user/hypo-tracker/index.html', 'utf8');
  const sizes = [...new Set((src.match(/font-size:[\d.]+px/g) || []).map(x => parseFloat(x.split(':')[1])))].sort((a, b) => a - b);
  ok('文字サイズは6種類以内', sizes.length <= 6);
  ok('11px未満を使っていない', sizes[0] >= 11);
  ok('入力欄は16px(iOSの自動ズーム回避)', /padding:10px 12px; font-size:16px/.test(src));
  const cols = await page.evaluate(() => { openStock(DB.stocks.find(s => s.name === 'テスト精機').id);
    return getComputedStyle(document.querySelector('.metric')).gridTemplateColumns.split(' ').length; });
  ok('指標グリッドは2列', cols === 2);

  // ---- B. 一覧はリスト構造・「対応が必要」だけ地色が変わる ----
  const home = await page.evaluate(() => { go('home');
    return { rows: document.querySelectorAll('#view .list .list-row').length,
             attn: document.querySelectorAll('#view .card.attn').length,
             looseCards: [...document.querySelectorAll('#view > .card')].filter(c => !c.classList.contains('attn')).length }; });
  await page.waitForTimeout(200);
  ok('今週の予定が1枚の枠の行になる', home.rows > 0);
  ok('「対応が必要」だけ地色が変わる', home.attn > 0);
  ok('ホーム直下に素の白カードが残っていない', home.looseCards === 0);
  const list = await page.evaluate(() => { go('analysis'); return document.querySelectorAll('#view .list .list-row').length; });
  ok('市場・銘柄分析も行構造', list >= 5);
  const rem = await page.evaluate(() => { go('reminder'); return document.querySelectorAll('#view .list .list-row').length; });
  ok('リマインダー一覧も行構造', rem >= 4);

  // ---- C. 銘柄詳細の長さ ----
  // メモ・注目ポイントは「残りN件を表示」で畳む作りをやめ、常に全件を並べる。
  // 畳む手段は見出しの開閉に一本化したので、画面の長さもそちらで測る
  const detail = await page.evaluate(() => { openStock(DB.stocks.find(s => s.name === 'テスト精機').id);
    const key = 'detail:' + STATE.stockId + ':メモ・注目ポイント';
    // リマインダーに紐づく分はリマインダー1枚のカードに畳まれるので、
    // 画面に出る塊は「単独カード＋まとまり」で数える
    const open = { h: document.querySelector('#view').scrollHeight,
                   hypoRows: document.querySelectorAll('#view .list.cards > .swipe').length,
                   grouped: document.querySelectorAll('#view .list.cards > .rgrp').length,
                   linked: DB.reminders.filter(r => r.stockId === STATE.stockId)
                             .reduce((n, r) => n + (r.hypoIds || []).length, 0),
                   hypoTotal: hyposOf(STATE.stockId).length,
                   more: /残り \d+件を表示/.test(document.querySelector('#view').innerText) };
    toggleGroup(key);
    const closedH = document.querySelector('#view').scrollHeight;
    const closedRows = document.querySelectorAll('#view .list.cards').length;
    toggleGroup(key);
    return { ...open, closedH, closedRows };
  });
  ok('メモ・注目は最初から全件出る(畳まれた分はまとまりに入る)',
    detail.hypoTotal === 7 && detail.hypoRows + detail.linked === 7 && detail.grouped === 1);
  ok('「残りN件を表示」ボタンは出さない', !detail.more);
  ok('メモ・注目を畳めば詳細画面は2200px以内', detail.closedH < 2200);
  ok('見出しを畳むと一覧ごと消える', detail.closedRows === 0);
  const sheet = await page.evaluate(() => { sheetEditHypo(hyposOf(STATE.stockId)[0].id); return document.querySelector('#sheet').innerText; });
  ok('編集シートに削除がある', /削除/.test(sheet));
  ok('編集シートから登録済みリマインダーへ行ける', /次回/.test(sheet));

  // ---- D. タップ領域44px ----
  const small = await page.evaluate(() => {
    closeSheet(); const out = [];
    ['home', 'analysis', 'import', 'reminder'].forEach(t => { go(t);
      document.querySelectorAll('#view button,#view .list-row,#view .sub-row,#view .sec .h').forEach(e => {
        const r = e.getBoundingClientRect(); if (r.width && r.height < 44) out.push(e.className + ':' + Math.round(r.height)); }); });
    return out; });
  ok('主要4画面に44px未満のタップ要素がない', small.length === 0);

  // ---- E. ゼロ状態 ----
  const empty = await page.evaluate(() => {
    DB.stocks.push({ id: '9999', name: '新規テスト', code: '9999', kind: 'ウォッチ', metrics: {}, trend: {}, sections: {}, links: [] });
    save(); openStock('9999'); return document.querySelector('#view').innerText; });
  ok('新規カードに「未取得」が出ない', !/未取得/.test(empty));
  ok('指標の埋め方は1行だけ案内される', (empty.match(/会話を取り込むと、ここに数字が入ります/g) || []).length === 1);
  // 表示に選んだ指標は、数値が無くても枠ごと出す(選んだのに出てこない状態を作らない)。
  // 空欄のままにせず「データなし」と言葉で書くので、ゼロ状態でも意味は読み取れる
  ok('業績推移は空でも表が出る', await page.evaluate(() => !!document.querySelector('#view table')));
  ok('空の指標は「データなし」と書かれる', /データなし/.test(empty));
  ok('業績推移の埋め方も1行だけ案内される', (empty.match(/ここにグラフと数字が入ります/g) || []).length === 1);
  ok('メモ0件のときだけ書き分けの説明が出る', /思ったことはメモに/.test(empty));

  // ---- F. 余白は4段階 ----
  const gaps = [...new Set((src.match(/gap:\d+px/g) || []).map(x => parseInt(x.split(':')[1])))].sort((a, b) => a - b);
  ok('余白は4/8/12/16のみ', gaps.every(g => [4, 8, 12, 16].includes(g)));

  console.log('JSエラー:', JSON.stringify(errs));
  await browser.close();
})();
