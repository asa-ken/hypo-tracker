// 2周目レビュー(2026-08-20)で発見: 確認テーブルのセル(更新前/更新後)は実際にタップで
// 展開できるが、視覚的なタップ目印(矢印)が候補カード(.candbox)には付くのに確認テーブル側には
// 付いていなかった(markClip3Truncated()のクエリが.candbox限定だったため)。
// 対象を#parseOut table .clip3にも広げ、目印を候補カードと揃える。
const { chromium } = require('playwright');
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

  await p.evaluate(() => go('import'));
  await p.waitForTimeout(250);
  const longDetail = 'これはとても長い分析の詳細文で、確認テーブルのセルの中で3行を大きく超えるように意図的に長くしてあります。'.repeat(3);
  const shortDetail = '短い詳細文。';
  const MD = `# 銘柄: テスト精機 (9001)\n## 分析\n- 事業構造(詳細): ${longDetail} | 基準日 2026/8/17\n- 収益モデル(詳細): ${shortDetail} | 基準日 2026/8/17`;
  await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, MD);
  await p.waitForTimeout(400);

  // ---- 1. 実際に3行を超えて切り詰められているセルには、タップ目印(矢印)が付く ----
  const longCellInfo = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#parseOut table tr')];
    const row = rows.find(r => /大きく超える/.test(r.textContent));
    const clip = row.children[2].querySelector('.clip3');
    const mark = clip.querySelector('.tapmark');
    return { hasMark: !!mark, shown: mark ? mark.classList.contains('show') : false };
  });
  ok('長文セルにタップ目印(.tapmark)が付く', longCellInfo.hasMark, longCellInfo);
  ok('実際に切り詰められている場合は.showが付く(矢印が見える)', longCellInfo.shown, longCellInfo);

  // ---- 2. 切り詰められていない短いセルには、目印は付くが.showは付かない(矢印は見えない) ----
  const shortCellInfo = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#parseOut table tr')];
    const row = rows.find(r => /短い詳細文/.test(r.textContent));
    const clip = row.children[2].querySelector('.clip3');
    const mark = clip.querySelector('.tapmark');
    return { hasMark: !!mark, shown: mark ? mark.classList.contains('show') : false };
  });
  ok('切り詰められていない短いセルは矢印が見えない(誤って「続きがある」と思わせない)', shortCellInfo.hasMark && !shortCellInfo.shown, shortCellInfo);

  // ---- 3. タップで展開する動作自体は変わらず機能する ----
  await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#parseOut table tr')];
    const row = rows.find(r => /大きく超える/.test(r.textContent));
    row.children[2].click();
  });
  await p.waitForTimeout(150);
  const opened = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#parseOut table tr')];
    const row = rows.find(r => /大きく超える/.test(r.textContent));
    return row.children[2].querySelector('.clip3').classList.contains('open');
  });
  ok('タップすると引き続き全文展開される', opened);

  // ---- 4. 候補カード側(.candbox)の目印は従来どおり付く(横断比較・回帰確認) ----
  await p.evaluate(() => { clearPaste(); });
  await p.waitForTimeout(200);
  const longFree = 'これは見出しにも箇条書きにも当てはまらない自由文で、メモ候補として拾われる想定のとても長い文章です。'.repeat(3);
  await p.evaluate(t => { document.querySelector('#mdIn').value = `# 銘柄: テスト精機 (9001)\n${t}`; parseAndPreview(); }, longFree);
  await p.waitForTimeout(400);
  const candboxInfo = await p.evaluate(() => {
    const el = document.querySelector('.candbox .ttl.clip3');
    const mark = el ? el.querySelector('.tapmark') : null;
    return { hasMark: !!mark, shown: mark ? mark.classList.contains('show') : false };
  });
  ok('候補カード側の目印は従来どおり機能する(回帰確認)', candboxInfo.hasMark && candboxInfo.shown, candboxInfo);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
