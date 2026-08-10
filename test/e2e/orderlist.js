// 「調べる項目を選ぶ」シート(sheetOrderNew)の項目一覧は、以前は独自の .row(枠線・余白が
// トークン外)を使っていた。リマインダー一覧・市場銘柄分析など他画面と同じ「.lbl見出し + .list」の
// 階層デザインに揃える(ユーザー指摘、2026-08-10)。機能(選択サイクル)自体は変えていない。
//
// 追記(同日、ユーザー指摘): カテゴリ数が多いと項目も多くなるため、見出しに矢尻の展開ボタンを付けて
// 畳めるようにした。銘柄詳細の分析カテゴリの「+/×」とは別の意味(タップで編集シートを開くわけではない
// 単なる選択一覧)なので、①・困ったときはと同じ矢尻(caretSvg)を使う。既定は展開状態
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

  await p.evaluate(() => sheetOrderNew('9001'));
  await p.waitForTimeout(250);

  // ---- 1. 見出し+.listの階層になっている(他画面と同じ組み立て) ----
  const struct = await p.evaluate(() => {
    const lists = [...document.querySelectorAll('#sheet .list.flat')];
    const oldRows = document.querySelectorAll('#sheet .row[style*="border-bottom"]').length;
    return {
      listCount: lists.length,
      rowCount: [...document.querySelectorAll('#sheet .list.flat .list-row')].length,
      oldStyleRows: oldRows,
      firstRowHtml: lists[0] ? lists[0].querySelector('.list-row').outerHTML.replace(/\s+/g, ' ').slice(0, 160) : null,
    };
  });
  ok('カテゴリごとに.list.flatがある(テスト前提)', struct.listCount > 0, struct);
  ok('行は.list-rowで構成される', struct.rowCount > 0, struct);
  ok('旧来の独自.row(border-bottom直書き)は残っていない', struct.oldStyleRows === 0, struct);
  ok('行はラベル(.ttl)+ボタンの組み立て', /class="ttl"/.test(struct.firstRowHtml || ''), struct.firstRowHtml);

  // ---- 2. タップ領域は44px以上 ----
  const small = await p.evaluate(() => [...document.querySelectorAll('#sheet .list.flat .list-row, #sheet .list.flat button')]
    .map(e => { const r = e.getBoundingClientRect(); return { c: e.className, h: Math.round(r.height), w: Math.round(r.width) }; })
    .filter(x => x.w > 0 && x.h < 44));
  ok('項目行・選択ボタンとも44px未満がない', small.length === 0, small);

  // ---- 3. 機能(選択サイクル)は変えていない ----
  const before = await p.evaluate(() => document.querySelector('#sheet .list.flat .list-row button').textContent.trim());
  await p.evaluate(() => document.querySelector('#sheet .list.flat .list-row button').click());
  await p.waitForTimeout(150);
  const after = await p.evaluate(() => document.querySelector('#sheet .list.flat .list-row button').textContent.trim());
  ok('ボタンを押すと選択状態がサイクルする(回帰)', before === '選択' && after === '要点のみ', { before, after });

  // ---- 4. カテゴリ見出しに矢尻の展開ボタンが付いている ----
  const caretInfo = await p.evaluate(() => {
    const secs = [...document.querySelectorAll('#sheet .sec')];
    return {
      secCount: secs.length,
      allHaveCaret: secs.every(s => !!s.querySelector(':scope > .h svg.caret')),
      allInitiallyOpen: secs.every(s => s.classList.contains('open')
        && getComputedStyle(s.querySelector(':scope > .b')).display !== 'none'),
    };
  });
  ok('カテゴリごとに.secがある(テスト前提)', caretInfo.secCount > 0, caretInfo);
  ok('カテゴリ見出しに矢尻(caret)が付いている', caretInfo.allHaveCaret, caretInfo);
  ok('既定ではすべて展開されている', caretInfo.allInitiallyOpen, caretInfo);

  // ---- 5. 矢尻をタップすると畳める・再タップで開く ----
  await p.evaluate(() => document.querySelectorAll('#sheet .sec > .h')[0].click());
  await p.waitForTimeout(150);
  const closed = await p.evaluate(() => {
    const sec = document.querySelectorAll('#sheet .sec')[0];
    return { open: sec.classList.contains('open'), bodyVisible: getComputedStyle(sec.querySelector(':scope > .b')).display !== 'none' };
  });
  ok('タップで畳める', !closed.open && !closed.bodyVisible, closed);
  await p.evaluate(() => document.querySelectorAll('#sheet .sec > .h')[0].click());
  await p.waitForTimeout(150);
  const reopened = await p.evaluate(() => {
    const sec = document.querySelectorAll('#sheet .sec')[0];
    return { open: sec.classList.contains('open'), bodyVisible: getComputedStyle(sec.querySelector(':scope > .b')).display !== 'none' };
  });
  ok('再タップで開く', reopened.open && reopened.bodyVisible, reopened);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
