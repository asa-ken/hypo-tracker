// 取り込み画面: 2026-08-15の課題抽出(realdata.jsonでの新方式レビュー)で見つかった2件の修正
//  ・貼り付け後、プレビューまで自動でスクロールする(空→非空の遷移時だけ)
//  ・注目ポイントは「本文:」ラベルが無くても読めなかった行に落ちない(メモと同じ扱いに揃える)
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

  // ---- 1. 貼り付け直後、プレビューまで自動スクロールする ----
  await p.evaluate(() => go('import'));
  await p.waitForTimeout(250);
  const beforePaste = await p.evaluate(() => window.pageYOffset);
  ok('貼り付け前は画面上部', beforePaste === 0, beforePaste);

  await p.evaluate(() => {
    document.querySelector('#mdIn').value = '# 銘柄: テスト精機 (9001)\n## メモ\n- 本文: 決算を確認したい';
    parseAndPreview();
  });
  await p.waitForTimeout(500);
  const afterPaste = await p.evaluate(() => ({
    scrollY: window.pageYOffset,
    outVisible: (() => { const r = document.querySelector('#parseOut').getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; })(),
  }));
  // 2026-08-22: ①(説明書をAIに渡す)が既定で畳まれるようになり(ユーザー指摘、使用頻度が低い)、
  // 貼り付け前のページがその分短くなった。この短いテキストの貼り付けでは、スクロールしなくても
  // プレビューが最初から画面内に収まる(scrollIntoViewが実際には動かない)。求めたいのは
  // 「スクロールしたこと」自体ではなく「プレビューが見えていること」なので、outVisibleを主とする
  ok('プレビューが画面内に入る(見えていれば、実際にスクロールしたかは問わない)', afterPaste.outVisible, afterPaste);

  // ---- 2. 手で編集し続けている間は、そのたびにスクロールし直さない ----
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(200);
  await p.evaluate(() => {
    document.querySelector('#mdIn').value += '\n- 本文: もうひとつ';
    parseAndPreview();
  });
  await p.waitForTimeout(400);
  const afterEdit = await p.evaluate(() => window.pageYOffset);
  ok('非空→非空の編集では勝手にスクロールしない(ユーザーが手で0へ戻した位置を尊重)', afterEdit === 0, afterEdit);

  // ---- 3. クリアすると次の貼り付けでまた自動スクロールする ----
  await p.evaluate(() => { clearPaste(); window.scrollTo(0, 0); });
  await p.waitForTimeout(200);
  await p.evaluate(() => {
    document.querySelector('#mdIn').value = '# 銘柄: テスト精機 (9001)\n## メモ\n- 本文: 3回目';
    parseAndPreview();
  });
  await p.waitForTimeout(500);
  const afterClearThenPaste = await p.evaluate(() => ({
    scrollY: window.pageYOffset,
    outVisible: (() => { const r = document.querySelector('#parseOut').getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; })(),
  }));
  // 上と同じ理由(①が既定で畳まれ、ページが短くなった)でoutVisibleを主とする
  ok('クリア後の貼り付けでも、プレビューが画面内に入る', afterClearThenPaste.outVisible, afterClearThenPaste);

  // ---- 4. 注目ポイント: 「本文:」ラベルが無くても読めなかった行にしない ----
  await p.evaluate(() => { clearPaste(); });
  await p.waitForTimeout(200);
  await p.evaluate(() => {
    document.querySelector('#mdIn').value = '# 銘柄: テスト精機 (9001)\n## 注目ポイント\n- 出来高が急増したら要警戒\n- 受注残の推移も見ておきたい';
    parseAndPreview();
  });
  await p.waitForTimeout(400);
  const watchResult = await p.evaluate(() => ({
    failed: window._parsed.failed,
    watchRows: window._parsed.rows.filter(r => r.block === '注目ポイント').map(r => r.value),
  }));
  ok('ラベル無しの注目ポイントは読めなかった行に落ちない', watchResult.failed.length === 0, watchResult);
  ok('2件とも別々の注目ポイントとして拾われる', watchResult.watchRows.length === 2, watchResult.watchRows);

  // ---- 5. 実際に取り込むと、2件の注目ポイントとして登録される ----
  await p.evaluate(() => commitImport());
  await p.waitForTimeout(400);
  const afterCommit = await p.evaluate(() => hyposOf('9001').filter(h => h.kind !== 'memo' && /急増したら要警戒|受注残の推移/.test(h.text)).length);
  ok('取り込むと2件とも注目ポイントとして登録される', afterCommit === 2, afterCommit);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
