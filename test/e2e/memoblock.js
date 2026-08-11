// 「## メモ」で本人の発言を拾う / 見出しの「#」が落ちても読める
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

  const feed = async md => {
    await p.evaluate(() => go('import')); await p.waitForTimeout(220);
    await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, md);
    await p.waitForTimeout(320);
  };
  // 2026-08-10: メモ候補は表示専用(.clip3)になった(スワイプ削除・タップで全文表示に変更、
  // 個別銘柄のメモ・注目ポイントと同じ見せ方に揃えたため)。旧来の編集用テキストエリア(.mc-text)は
  // 解析結果には使われなくなり、「＋追加」で書き足す分だけに残る
  const memos = () => p.evaluate(() =>
    [...document.querySelectorAll('#memoCandList .clip3')].map(t => t.textContent));

  // ---- 説明書にメモの定義が入る ----
  const brief = await p.evaluate(() => briefingText());
  ok('説明書に「## メモ」がある', /## メモ/.test(brief));
  ok('本人の発言だと明示する', /私自身が会話の中で述べた考え/.test(brief));
  ok('AIの分析を入れないと書く', /あなた\(AI\)の説明・要約・補足/.test(brief));
  ok('残り物の受け皿ではないと書く', /受け皿ではありません/.test(brief));
  ok('注目ポイントとの線引きを書く', /検証したい・気にかけたい」観点。これは「## 注目ポイント」/.test(brief));
  ok('無ければ省くと書く', /該当する発言が無ければ、この見出しごと省いて/.test(brief));
  ok('冒頭の「残りはメモ」という説明は残っている', /「メモ」として記録します/.test(brief));

  // ---- 質問文ジェネレータ側にも入る ----
  await p.evaluate(() => { DB.askPrefs.picks = { '収益モデル': 'sum' }; save(); });
  const order = await p.evaluate(() => {
    let got = null; const orig = window.showPrompt;
    window.showPrompt = t => { got = t; }; genOrderNew('9001'); window.showPrompt = orig; return got;
  });
  ok('質問文にもメモの指示が入る', /## メモ」に「- 本文: ◯◯」で残す/.test(order || ''));

  // ---- 取り込み: メモ欄を拾う ----
  await feed(`# 銘柄: テスト精機 (9001)
## メモ
- 本文: 保守で稼ぐ形に変わりつつある気がする
- 本文: 自分は配当より成長を優先して見ている
## 指標
- PBR: 2.5 | 単位:倍 | 2026/8/7`);
  const m1 = await memos();
  ok('メモ欄の本文が候補に入る', m1.includes('保守で稼ぐ形に変わりつつある気がする'));
  ok('複数の本文をそれぞれ拾う', m1.includes('自分は配当より成長を優先して見ている'));
  ok('メモは差分表の行にはしない', await p.evaluate(() =>
    ![...document.querySelectorAll('#parseOut table tr')].some(tr => /保守で稼ぐ形/.test(tr.textContent))));
  ok('読めなかった行にはならない', await p.evaluate(() => window._parsed.failed.length === 0));

  // ---- ラベル無しでも受ける ----
  await feed('# 銘柄: テスト精機 (9001)\n## メモ\n- 決算の説明が去年より慎重に聞こえた');
  ok('「本文:」が無くても拾う', (await memos()).some(t => /去年より慎重/.test(t)));
  ok('その場合も読めなかった行にしない', await p.evaluate(() => window._parsed.failed.length === 0));

  // ---- メモ欄は自由文より前に並ぶ ----
  await feed('# 銘柄: テスト精機 (9001)\nこれは地の文です。\n\n## メモ\n- 本文: これは本人の考え');
  const m3 = await memos();
  ok('メモ欄が自由文より先に並ぶ', m3[0] === 'これは本人の考え');
  ok('自由文も候補には残る', m3.some(t => /地の文/.test(t)));

  // ---- 実際にメモとして保存される ----
  await p.evaluate(() => commitImport()); await p.waitForTimeout(500);
  ok('メモとして保存される', await p.evaluate(() =>
    DB.hypotheses.some(h => h.stockId === '9001' && h.kind === 'memo' && h.text === 'これは本人の考え')));

  // ---- 「#」が落ちた貼り付けでも読める ----
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  await feed(`銘柄: テスト精機 (9001)
指標
- PBR: 2.5 | 単位:倍 | 2026/8/7
業績推移
- 売上高: 25年3月期=468300 | 単位:百万円 | 2026/8/7
注目ポイント
- 本文: 受注残を見たい
メモ
- 本文: 本人の考え`);
  ok('銘柄を特定できる', await p.evaluate(() =>
    /銘柄: テスト精機 を検出/.test(document.querySelector('#parseOut').textContent)));
  ok('銘柄のプルダウンは出ない', await p.evaluate(() => !document.querySelector('#importStockPick')));
  const m4 = await memos();
  ok('見出し語がメモ候補に混ざらない', !m4.some(t => /^(指標|業績推移|注目ポイント|メモ)$/.test(t.trim())));
  ok('「銘柄: …」の行も混ざらない', !m4.some(t => /^銘柄[:：]/.test(t.trim())));
  ok('メモ欄は拾える', m4.includes('本人の考え'));
  ok('指標が正しい見出しに入る', await p.evaluate(() =>
    window._parsed.rows.find(r => r.key === 'PBR').block === '指標'));
  ok('業績推移も正しい見出しに入る', await p.evaluate(() =>
    window._parsed.rows.find(r => r.key === '売上高').block === '業績推移'));
  ok('注目ポイントも1件だけ拾う', await p.evaluate(() =>
    window._parsed.rows.filter(r => r.block === '注目ポイント').length === 1));
  ok('更新前も出る(銘柄が特定できているため)', await p.evaluate(() =>
    [...document.querySelectorAll('#parseOut table tr')].some(tr => /2\.31/.test(tr.textContent))));

  // ---- 見出し語で始まるだけの文章は巻き込まない ----
  await feed('# 銘柄: テスト精機 (9001)\n分析すると、来期は厳しそうだと思った。');
  ok('「分析すると…」は見出し扱いしない', (await memos()).some(t => /来期は厳しそう/.test(t)));

  // ---- タップの目印(tapmark): メモ候補も長文だけ出す(ユーザー指摘、2026-08-11) ----
  await feed(`# 銘柄: テスト精機 (9001)
## メモ
- 本文: 短いメモ
- 本文: IRで受注残について聞かれた時の答え方が去年より慎重だった気がする。気のせいかもしれないが一応記録しておく。次の決算説明会でも同じ質問が出るか注視したい。`);
  const memoMarks = await p.evaluate(() => [...document.querySelectorAll('#memoCandList .ttl.clip3')].map(el => ({
    short: el.textContent.length < 20,
    show: !!el.querySelector('.tapmark.show'),
  })));
  ok('短いメモ候補にはタップの目印を出さない', memoMarks.some(m => m.short && !m.show), memoMarks);
  ok('長いメモ候補にはタップの目印を出す', memoMarks.some(m => !m.short && m.show), memoMarks);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
