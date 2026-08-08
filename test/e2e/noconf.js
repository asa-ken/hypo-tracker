const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

// 新フォーマット: 出典も確信度も無い
const MD = `# 銘柄: テスト精機 (9001)

## 指標
- ROE: 12.8 | 単位:% | 2026/7/31

## 業績推移
- 純利益: 24年3月期=31000 | 25年3月期=35500 | 26年3月期(予)=41000 | 単位:百万円 | 2026/7/31

## 分析
- 事業構造(サマリ): 半導体製造装置の設計・製造・保守を一貫して手がける。 | 2026/7/31
`;

// 旧フォーマット(出典・確信度つき)でも壊れないこと。
// テストデータに無い指標名を使い、新規書き込みの経路を通す
const MD_OLD = `# 銘柄: テスト精機 (9001)

## 指標
- 流動比率: 212.5 | 単位:% | 2026/7/31 | 会社四季報 | 高
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

  // ---- 1. 説明書 ----
  const brief = await page.evaluate(() => briefingText());
  ok('説明書のフォーマットに「| 確信度」が無い', !/\|\s*確信度/.test(brief));
  ok('説明書のフォーマットに「| 出典」が無い', !/\|\s*出典/.test(brief));
  ok('「出典・URL・確信度は書かない」の指示がある', /出典・URL・確信度は書かないでください/.test(brief));
  ok('「分からない項目は省く」の指示がある', /分からない項目は省いてください/.test(brief));
  ok('平易な日本語の指示は残っている', /専門用語はできるだけ避け/.test(brief));
  ok('基準日は残っている', /基準日/.test(brief));

  // ---- 2. 質問文 ----
  const prompt = await page.evaluate(() => {
    DB.askPrefs.picks = { '事業構造': 'sum' };
    genOrderNew('9001');
    const ta = document.querySelector('#sheet textarea');
    return ta ? ta.value : null;
  });
  await page.evaluate(() => closeSheet());
  ok('質問文が生成される', !!prompt);
  ok('質問文に「| 確信度」が無い', prompt && !/\|\s*確信度/.test(prompt));
  ok('質問文のルールに「出典・URL・確信度は書かない」がある', prompt && /出典・URL・確信度は書かない/.test(prompt));
  ok('質問文の出力ルールは基準日のみ要求', prompt && /各値に 基準日\(YYYY\/M\/D\) を付す/.test(prompt));

  // ---- 3. 新フォーマットの取り込み ----
  await page.evaluate(() => go('import'));
  await page.waitForTimeout(200);
  await page.evaluate(md => { document.querySelector('#mdIn').value = md; parseAndPreview(); }, MD);
  await page.waitForTimeout(400);
  await page.evaluate(() => commitImport());
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => {
    const s = DB.stocks.find(x => x.id === '9001');
    return { roe: s.metrics['ROE'] || null, tr: s.trend['純利益'] || null, sec: s.sections['事業構造'] || null };
  });
  ok('確信度なしで指標が取り込める', a.roe && a.roe.v === '12.8' && a.roe.unit === '%');
  ok('指標に conf を保存しない', a.roe && !('conf' in a.roe));
  ok('指標に src を保存しない', a.roe && !('src' in a.roe));
  ok('確信度なしで業績推移が取り込める', a.tr && a.tr['26年3月期(予)'] === '41000');
  ok('確信度なしで分析が取り込める', a.sec && /半導体製造装置/.test(a.sec.t));
  ok('分析に conf を保存しない', a.sec && !('conf' in a.sec));
  ok('分析に src を保存しない', a.sec && !('src' in a.sec));

  // ---- 4. 旧フォーマットでも壊れない ----
  await page.evaluate(() => go('import'));
  await page.waitForTimeout(250);
  await page.evaluate(md => { document.querySelector('#mdIn').value = md; parseAndPreview(); }, MD_OLD);
  await page.waitForTimeout(400);
  await page.evaluate(() => commitImport());
  await page.waitForTimeout(500);
  const b = await page.evaluate(() => {
    const s = DB.stocks.find(x => x.id === '9001');
    return s.metrics['流動比率'] || null;
  });
  ok('旧フォーマットでも値が正しい', b && b.v === '212.5');
  ok('旧フォーマットでも単位が正しい', b && b.unit === '%');
  ok('旧フォーマットの出典・確信度は捨てられる', b && !('src' in b) && !('conf' in b));

  // ---- 5. 表示 ----
  await page.evaluate(() => { openStock('9001'); sheetAnalysisItem('9001', '事業構造'); });
  await page.waitForTimeout(300);
  const sheet = await page.evaluate(() => document.querySelector('#sheet').innerText);
  ok('分析シートに「確信度」が出ない', !/確信度/.test(sheet));
  ok('分析シートに「出典」が出ない', !/出典/.test(sheet));
  ok('分析シートに基準日は出る', /基準日:/.test(sheet));

  // ---- 6. seed も新しい形 ----
  const seedShape = await page.evaluate(() => {
    const s = seed();
    const m = s.stocks[0].metrics['PER(予想)'];
    const sec = s.stocks[0].sections['事業構造'];
    return { mKeys: Object.keys(m), secKeys: Object.keys(sec) };
  });
  ok('seedの指標に src/conf が無い', !seedShape.mKeys.includes('src') && !seedShape.mKeys.includes('conf'));
  ok('seedの分析に src が無い', !seedShape.secKeys.includes('src'));

  console.log('JSエラー:', JSON.stringify(errs));
  await browser.close();
})();
