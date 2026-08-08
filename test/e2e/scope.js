const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

const MD_IND = `# テーマ: DC業界テスト

## 指標
- 市場規模: 42000 | 単位:億円 | 2026/7/31
- 稼働率: 91.2 | 単位:% | 2026/7/31

## 分析
- 産業構造(サマリ): 用地・電力・冷却がボトルネックで、上流の希少資源に収益が集まる。 | 2026/7/31
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

  // ---- 1. 移行 ----
  const mig = await page.evaluate(() => ({
    existing: DB.stocks.filter(s => s.kind === '市場').map(s => s.scope),
    stockHasNoScope: DB.stocks.filter(s => s.kind !== '市場').every(s => !s.scope),
    masters: ['marketMetricsMaster','industryMetricsMaster','themeMetricsMaster','industrySectionMaster','themeSectionMaster'].every(k => !!DB[k]),
  }));
  ok('既存の市場カードは「市場」扱いになる', mig.existing.every(x => x === '市場'));
  ok('銘柄には粒度が付かない', mig.stockHasNoScope);
  ok('粒度ごとのマスターが揃う', mig.masters);

  // ---- 2. 追加シートで種別を選ぶと既定値が切り替わる ----
  await page.evaluate(() => sheetAddMarket());
  await page.waitForTimeout(200);
  const t1 = await page.evaluate(() => document.querySelector('#sheet').innerText);
  ok('既定は「市場」で、市場の指標が出る', /為替\(USD\/JPY\)/.test(t1) && /長期金利/.test(t1));
  ok('項目が後から変更できる案内がある', /後からいつでも追加・削除できます/.test(t1));

  await page.evaluate(() => sheetAddMarket('業界'));
  await page.waitForTimeout(200);
  const t2 = await page.evaluate(() => document.querySelector('#sheet').innerText);
  ok('「業界」を選ぶと業界の指標に変わる', /指標: PER \/ PBR/.test(t2) && !/長期金利/.test(t2));
  ok('「業界」の分析項目が出る', /産業構造/.test(t2));

  await page.evaluate(() => sheetAddMarket('テーマ'));
  await page.waitForTimeout(200);
  const t3 = await page.evaluate(() => document.querySelector('#sheet').innerText);
  ok('「テーマ」は指標なしと案内される', /なし\(取り込むと自動で増えます\)/.test(t3));
  ok('「テーマ」の分析項目が出る', /テーマの中身/.test(t3));

  // ---- 3. 業界カードを作ると業界の語彙で開く ----
  await page.evaluate(() => {
    sheetAddMarket('業界');
    document.querySelector('#am_mname').value = 'DC業界テスト';
    doAddMarket();
  });
  await page.waitForTimeout(400);
  const det = await page.evaluate(() => {
    const s = DB.stocks.find(x => x.name === 'DC業界テスト');
    return { scope: s.scope, sub: document.querySelector('#topSub').textContent, txt: document.querySelector('#view').innerText };
  });
  ok('作成した業界カードの粒度が「業界」', det.scope === '業界');
  ok('ヘッダーに「業界」と出る', det.sub === '業界');
  ok('見出しが「業界の水準(代表値)」', /業界の水準/.test(det.txt));
  ok('業界の分析項目が出る', /産業構造/.test(det.txt));
  ok('市場専用の項目は出ない', !/金融環境/.test(det.txt));
  ok('リマインダーの文言が粒度に沿う', /この業界のリマインダー/.test(det.txt));

  // ---- 4. 業界カードへの取り込みは業界マスターに登録される ----
  await page.evaluate(() => go('import'));
  await page.waitForTimeout(200);
  await page.evaluate(md => { document.querySelector('#mdIn').value = md; parseAndPreview(); }, MD_IND);
  await page.waitForTimeout(400);
  await page.evaluate(() => commitImport());
  await page.waitForTimeout(500);
  const imp = await page.evaluate(() => {
    const s = DB.stocks.find(x => x.name === 'DC業界テスト');
    return {
      metrics: Object.keys(s.metrics),
      sec: !!s.sections['産業構造'],
      inIndustry: DB.industryMetricsMaster.snap.includes('稼働率'),
      notInMarket: !DB.marketMetricsMaster.snap.includes('稼働率'),
      notInStock: !DB.metricsMaster.snap.includes('稼働率'),
    };
  });
  ok('業界カードに指標が入る', imp.metrics.includes('市場規模') && imp.metrics.includes('稼働率'));
  ok('業界固有の分析項目が解決される', imp.sec);
  ok('未知の指標は業界マスターに登録される', imp.inIndustry);
  ok('市場マスターは汚染されない', imp.notInMarket);
  ok('銘柄マスターは汚染されない', imp.notInStock);

  // ---- 5. 後から粒度を変更できる ----
  await page.evaluate(() => { const s = DB.stocks.find(x => x.name === 'DC業界テスト'); openStock(s.id); setScope(s.id, 'テーマ'); });
  await page.waitForTimeout(400);
  const chg = await page.evaluate(() => {
    const s = DB.stocks.find(x => x.name === 'DC業界テスト');
    return { scope: s.scope, keptMetrics: Object.keys(s.metrics).length, keptSec: !!s.sections['産業構造'] };
  });
  ok('粒度を変更できる', chg.scope === 'テーマ');
  ok('変更しても入力済みデータは残る', chg.keptMetrics >= 2 && chg.keptSec);

  // ---- 6. 説明書に3種の語彙が載る ----
  const brief = await page.evaluate(() => briefingText());
  ok('説明書に市場全体の項目が載る', /市場全体\(日本株市場・米国株市場など\)の話のときは下記/.test(brief));
  ok('説明書に業界の項目が載る', /業界\(半導体・データセンターなど\)の話のときは下記/.test(brief));
  ok('説明書にテーマの項目が載る', /テーマ\(AI・脱炭素など/.test(brief));
  ok('説明書に業界の指標名が載る', /業界の話のときの指標名/.test(brief));

  console.log('JSエラー:', JSON.stringify(errs));
  await page.evaluate(() => { closeSheet(); go('analysis'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: __dirname + '/scope_list.png', fullPage: true });
  await browser.close();
})();
