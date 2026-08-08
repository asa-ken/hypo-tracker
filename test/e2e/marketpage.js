const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

// 既存の市場カード宛て(新規テーマの登録は別フロー = addStockFromImport)
const MD = `# テーマ: テスト市場・AIサイクル

## 指標
- 予想PER(市場全体): 16.4 | 単位:倍 | 2026/7/31 | 日経 | 高
- 騰落レシオ(25日): 118.2 | 単位:% | 2026/7/31 | 株探 | 中
- 空売り比率: 41.5 | 単位:% | 2026/7/31 | 東証 | 中

## 分析
- 何が起きているか(サマリ): 円安一服と国内金利上昇で、輸出主導から内需・金融へ物色が移りつつある。 | 2026/7/31 | 日経 | 中
`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload();
  await page.waitForTimeout(400);

  // ---- 1. migrate で市場用マスターが入る ----
  const mm = await page.evaluate(() => ({
    snap: DB.marketMetricsMaster.snap,
    hidden: DB.marketMetricsMaster.hiddenSnap,
    separate: JSON.stringify(DB.marketMetricsMaster.snap) !== JSON.stringify(DB.metricsMaster.snap),
  }));
  ok('市場用の指標マスターが補完される', mm.snap.length > 0);
  ok('銘柄用マスターとは独立している', mm.separate);

  // ---- 2. 市場カードが専用ページで開く ----
  const mktId = await page.evaluate(() => (DB.stocks.find(s => s.kind === '市場') || {}).id);
  ok('テストデータに市場カードがある', !!mktId);
  await page.evaluate(id => openStock(id), mktId);
  await page.waitForTimeout(300);
  const mkt = await page.evaluate(() => ({
    sub: document.querySelector('#topSub').textContent,
    txt: document.querySelector('#view').innerText,
  }));
  ok('粒度名(市場)がヘッダーに出る', mkt.sub === '市場');
  ok('「市場の水準」セクションが出る', /市場の水準/.test(mkt.txt));
  ok('市場指標の名前が表示される', /予想PER\(市場全体\)|騰落レシオ/.test(mkt.txt));
  ok('業績推移は出ない(市場には無い)', !/業績推移/.test(mkt.txt));
  ok('分析セクションは出る', /分析/.test(mkt.txt));
  ok('自分の銘柄への導線が出る', /自分の銘柄を確認/.test(mkt.txt));
  ok('リマインダーの文言が市場向け', /この市場のリマインダー/.test(mkt.txt));

  // ---- 3. 銘柄ページは従来どおり ----
  await page.evaluate(() => openStock('9001'));
  await page.waitForTimeout(300);
  const stk = await page.evaluate(() => ({
    sub: document.querySelector('#topSub').textContent,
    txt: document.querySelector('#view').innerText,
  }));
  ok('銘柄は従来どおり主要指標が出る', /主要指標/.test(stk.txt));
  ok('銘柄は業績推移が出る', /業績推移/.test(stk.txt));
  ok('銘柄に「市場の水準」は出ない', !/市場の水準/.test(stk.txt));
  ok('銘柄のサブタイトルは従来どおり', /9001/.test(stk.sub));

  // ---- 4. 市場カードへの指標取り込みが通る(以前は弾かれていた) ----
  await page.evaluate(() => go('import'));
  await page.waitForTimeout(200);
  await page.evaluate(md => { document.querySelector('#mdIn').value = md; parseAndPreview(); }, MD);
  await page.waitForTimeout(400);
  const prev = await page.evaluate(() => document.querySelector('#parseOut').innerText);
  ok('指標が「該当セクションなし」に落ちない', !/該当セクションが見つからない/.test(prev) || !/予想PER/.test(prev.split('該当セクションが見つからない')[1] || ''));

  await page.evaluate(() => commitImport());
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const m = DB.stocks.find(s => s.kind === '市場' && s.name === 'テスト市場・AIサイクル');
    return {
      found: !!m,
      metrics: m ? Object.keys(m.metrics) : [],
      per: m && m.metrics['予想PER(市場全体)'] ? m.metrics['予想PER(市場全体)'].v : null,
      autoAdded: DB.marketMetricsMaster.snap.includes('空売り比率'),
      notInStockMaster: !DB.metricsMaster.snap.includes('空売り比率'),
    };
  });
  ok('市場カードに指標が保存される', after.metrics.length >= 3);
  ok('値が正しく入る', after.per === '16.4');
  ok('未知の市場指標が市場用マスターに自動登録される', after.autoAdded);
  ok('銘柄用マスターは汚染されない', after.notInStockMaster);

  // ---- 5. 説明書に市場用の指標名が載る ----
  const brief = await page.evaluate(() => briefingText());
  ok('説明書に市場用の指標名が載る', /市場全体の話のときの指標名/.test(brief));
  ok('説明書に騰落レシオが含まれる', /騰落レシオ/.test(brief));

  console.log('JSエラー:', JSON.stringify(errs));
  await page.evaluate(() => { const m = DB.stocks.find(s => s.kind === '市場' && s.name === 'テスト市場・AIサイクル'); openStock(m.id); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: __dirname + '/marketpage.png', fullPage: true });
  await browser.close();
})();
