// 貼り付け結果(#parseOut)は、以前は 似た指標→リマインダー候補→該当セクション不明→
// プレビュー→メモ候補 の順にフラットに並んでおり、画面が縦長になるうえ「何をすればいいか」が
// 並び順から読み取れなかった(ユーザー指摘: 「画面が縦長すぎる且つセクションの並びに意図見えない」)。
//
// ユーザー指定の3区分・作業順に整理する。
//   1. 取り込み前に確認してください … 似た指標 / 読めなかった行
//   2. 取り込むリマインダー/メモを選択してください … リマインダー / メモ候補
//   3. 読み込み内容を確認してください … 読み込みプレビュー(該当セクション不明の行も含む)
// 各区分は開閉でき(困ったときは等と同じ .sec)、中身が無い区分は出さない。
// 区分2(メモ候補は「＋追加」が常にあるため)だけは常に表示する
//
// 追記(2026-08-10、ユーザー指摘): 該当セクション不明はチェックボックスで選んで取り込む
// 保留項目だったが、「その他」として常に取り込んだ上で読み込みプレビュー(区分3)に赤地行として
// 出す形に変更した。区分1からは該当セクション不明の表示が無くなった
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

  const paste = async md => {
    await p.evaluate(() => go('import')); await p.waitForTimeout(150);
    await p.evaluate(text => { document.querySelector('#mdIn').value = text; parseAndPreview(); }, md);
    await p.waitForTimeout(300);
  };
  const heads = () => p.evaluate(() => [...document.querySelectorAll('#parseOut .sec > .h')].map(h => h.textContent.trim().replace(/\s+/g, ' ')));

  // ---- 1. 全パターンがある貼り付け: 3区分がこの順で出る ----
  await paste(`# 銘柄: テスト精機 (9001)
## 指標
- 配当利回り: 2.3 | 単位:% | 基準日:2026/8/10
## 分析
- 謎のカテゴリ(サマリ): 該当なしのテスト | 基準日:2026/8/10
## 注目ポイント
- 本文: イベントの確認
- イベント日: 2026/9/10
## メモ
- 本文: メモの本文`);
  const h1 = await heads();
  ok('3区分がこの順で出る', JSON.stringify(h1) === JSON.stringify([
    '取り込み前に確認してください', '取り込むリマインダー/メモを選択してください', '読み込み内容を確認してください',
  ]), h1);

  // ---- 2. 区分1の中身: 似た指標が入っている。該当セクション不明はもう区分1に出ない ----
  const grp1 = await p.evaluate(() => {
    const head = [...document.querySelectorAll('#parseOut .sec > .h')].find(x => /取り込み前に確認してください/.test(x.textContent));
    const body = head.closest('.sec').querySelector(':scope > .b');
    return {
      hasFailbox: body.querySelectorAll('.failbox').length,
      text: body.textContent,
    };
  });
  ok('区分1に該当セクション不明の行はもう入らない', !/該当セクションが見つからない/.test(grp1.text), grp1);
  ok('区分1には似た指標の警告が入る', /似た名前の指標があります/.test(grp1.text), grp1);

  // ---- 2b. 該当セクション不明は区分3のプレビュー表に赤地行として入る ----
  const orphanRow = await p.evaluate(() => {
    const head = [...document.querySelectorAll('#parseOut .sec > .h')].find(x => /読み込み内容を確認してください/.test(x.textContent));
    const body = head.closest('.sec').querySelector(':scope > .b');
    const tr = body.querySelector('tr.orphanrow');
    return {
      hasOrphanRow: !!tr,
      text: tr ? tr.textContent.replace(/\s+/g, ' ').trim() : '',
      hasLegend: /既存指標に該当せず/.test(body.textContent),
    };
  });
  ok('区分3に該当セクション不明の行が赤地行として入る', orphanRow.hasOrphanRow, orphanRow);
  ok('凡例に「既存指標に該当せず」が出る', orphanRow.hasLegend, orphanRow);

  // ---- 3. 区分2の中身: リマインダー候補・メモ候補が入っている ----
  const grp2 = await p.evaluate(() => {
    const head = [...document.querySelectorAll('#parseOut .sec > .h')].find(x => /取り込むリマインダー\/メモを選択してください/.test(x.textContent));
    const body = head.closest('.sec').querySelector(':scope > .b');
    return { hasRembox: !!body.querySelector('.rembox'), hasMemoHeading: /メモ候補/.test(body.textContent), hasAddBtn: !!body.querySelector('#memoCandList') };
  });
  ok('区分2に日付つきの注目ポイント(リマインダー候補)が入っている', grp2.hasRembox, grp2);
  ok('区分2にメモ候補が入っている', grp2.hasMemoHeading && grp2.hasAddBtn, grp2);

  // ---- 4. 区分3の中身: 読み込みプレビューの表が入っている ----
  const grp3 = await p.evaluate(() => {
    const head = [...document.querySelectorAll('#parseOut .sec > .h')].find(x => /読み込み内容を確認してください/.test(x.textContent));
    const body = head.closest('.sec').querySelector(':scope > .b');
    return { hasTable: !!body.querySelector('table') };
  });
  ok('区分3に読み込みプレビューの表が入っている', grp3.hasTable, grp3);

  // ---- 5. 読み込むボタンはどの区分にも属さず、最後に独立している ----
  const btnPos = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('#parseOut button')].find(b => /読み込む/.test(b.textContent));
    return { insideSec: !!btn.closest('.sec'), isLast: btn === document.querySelector('#parseOut').lastElementChild };
  });
  ok('読み込むボタンはどの区分の中にも無い(全体に効く操作のため)', !btnPos.insideSec, btnPos);

  // ---- 6. 区分は開閉でき、畳むと画面が縮む ----
  const heightOpen = await p.evaluate(() => document.querySelector('#view').scrollHeight);
  await p.evaluate(() => document.querySelectorAll('#parseOut .sec > .h').forEach(h => h.click()));
  await p.waitForTimeout(250);
  const heightClosed = await p.evaluate(() => document.querySelector('#view').scrollHeight);
  ok('3区分とも畳める', await p.evaluate(() => [...document.querySelectorAll('#parseOut .sec')].every(s => !s.classList.contains('open'))));
  ok('畳むと画面が縮む', heightClosed < heightOpen, { heightOpen, heightClosed });
  await p.evaluate(() => document.querySelectorAll('#parseOut .sec > .h').forEach(h => h.click())); // 元に戻す

  // ---- 7. タップ領域は44px以上 ----
  const small = await p.evaluate(() => [...document.querySelectorAll('#parseOut .sec > .h')]
    .map(e => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height) }; }).filter(x => x.h < 44));
  ok('区分見出しのタップ領域は44px以上', small.length === 0, small);

  // ---- 8. 似た指標・該当セクション不明・リマインダー候補・メモ候補のいずれも無いとき ----
  // 区分1は出ない、区分2は常に出る(メモ追加ボタンのため)、区分3は行があれば出る
  await paste(`# 銘柄: テスト精機 (9001)
## ざっくりまとめ
- 本文: シンプルな内容のみ | 基準日:2026/8/10`);
  const h2 = await heads();
  ok('区分1(取り込み前に確認してください)が無い場合は出ない', !h2.includes('取り込み前に確認してください'), h2);
  ok('区分2(選択してください)は常に出る', h2.includes('取り込むリマインダー/メモを選択してください'), h2);
  ok('区分3(確認してください)は行があるので出る', h2.includes('読み込み内容を確認してください'), h2);

  // ---- 9. 貼り付けが空のとき、#parseOutごと空になる(回帰) ----
  await p.evaluate(() => { document.querySelector('#mdIn').value = ''; parseAndPreview(); });
  await p.waitForTimeout(150);
  ok('貼り付けが空なら#parseOutも空になる(回帰)', await p.evaluate(() => document.querySelector('#parseOut').innerHTML === ''));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
