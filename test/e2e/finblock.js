// バグ修正: GPTが財務指標・業績推移の生数値を「## 業績推移」「## 指標」に分けず、
// 「## 分析」の中にサマリ/詳細の文章と一緒にまとめて出力すると、既存の分析サブ項目名
// (顧客セグメント・技術力など)と一致せず「その他」扱いになっていた(ユーザー報告、実データ添付、
// 2026-08-13)。実際の報告例(日東工器 6151)を元に、財務データが正しく分類されることを確認する
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

// 実際にユーザーが報告した貼り付け文を簡略化したもの(構造は同一: ## 分析の中に
// サマリ/詳細の文章と、財務指標・業績推移の生数値が混在している)。既存のテストデータと
// 重複しない銘柄・項目名にするため、市場カードではなく専用の未登録銘柄コードを使う
const MD = `# 銘柄: 液冷テスト工業 (9099)
## 分析
- 実績財務(PL/BS/CF)(サマリ): 26年3月期は売上高27289で前期比0.1増にとどまった。 | 基準日 2026/8/13
- 実績財務(PL/BS/CF)(詳細): 売上高は25年3月期27256から26年3月期27289へほぼ横ばいだった。 | 基準日 2026/8/13
- 売上高: 25年3月期=27256 | 26年3月期=27289 | 27年3月期(予)=29190 | 単位:百万円 | 基準日 2026/8/13
- 経常利益: 25年3月期=2510 | 26年3月期=1466 | 27年3月期(予)=1890 | 単位:百万円 | 基準日 2026/8/13
- 自己資本比率: 25年3月期=87.3 | 26年3月期=88.7 | 単位:% | 基準日 2026/8/13
- 財務健全性・効率性(サマリ): 財務健全性は非常に高い。 | 基準日 2026/8/13
- 自己資本利益率: 25年3月期=2.3 | 26年3月期=3.6 | 単位:% | 基準日 2026/8/13`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  await p.evaluate(() => go('import'));
  await p.waitForTimeout(250);
  await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, MD);
  await p.waitForTimeout(400);

  // 未登録銘柄なので、まず「取り込む」を押した時点で新規登録される(PR #133の挙動)
  const blocks = await p.evaluate(() => Object.fromEntries(window._parsed.rows.map(r => [r.key, r.block])));
  const orphanCnt = await p.evaluate(() => document.querySelectorAll('#parseOut tr.orphanrow').length);

  ok('「その他」行は1つも出ない(バグ修正の核心)', orphanCnt === 0, orphanCnt);
  ok('実績財務(PL/BS/CF)(サマリ)は分析のまま', blocks['実績財務(PL/BS/CF)(サマリ)'] === '分析', blocks);
  ok('財務健全性・効率性(サマリ)は分析のまま', blocks['財務健全性・効率性(サマリ)'] === '分析', blocks);
  ok('売上高(登録済みの業績推移名)は業績推移として救い出される', blocks['売上高'] === '業績推移', blocks);
  ok('自己資本比率(登録済みの指標名)は指標として救い出される', blocks['自己資本比率'] === '指標', blocks);
  ok('経常利益(未登録の財務指標)も業績推移として救い出される', blocks['経常利益'] === '業績推移', blocks);
  ok('自己資本利益率(未登録の財務指標)も業績推移として救い出される', blocks['自己資本利益率'] === '業績推移', blocks);

  // ---- 実際に取り込むと、その他ではなく本来のデータとして反映される(新規銘柄も同時に登録される) ----
  await p.evaluate(() => commitImport());
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => ({
    registered: !!stock('9099'),
    revenue: stock('9099') && stock('9099').trend['売上高'],
    ordinary: stock('9099') && stock('9099').trend['経常利益'],
    equityRatio: stock('9099') && stock('9099').metrics['自己資本比率'],
    section: stock('9099') && stock('9099').sections['実績財務(PL/BS/CF)'],
    otherCat: (DB.sectionMaster.find(c => c.cat === 'その他') || { subs: [] }).subs,
  }));
  ok('未登録銘柄が取り込みと同時に登録される', after.registered, after);
  ok('売上高が業績推移として保存される', after.revenue && after.revenue['26年3月期'] === '27289', after.revenue);
  ok('経常利益(新規)も業績推移として保存される', after.ordinary && after.ordinary['26年3月期'] === '1466', after.ordinary);
  ok('自己資本比率が指標として保存される', !!after.equityRatio, after.equityRatio);
  ok('実績財務(PL/BS/CF)は分析セクションとして保存される', !!after.section, after.section);
  ok('「その他」カテゴリに紛れ込んでいない', !after.otherCat.includes('売上高') && !after.otherCat.includes('経常利益') && !after.otherCat.includes('自己資本比率'), after.otherCat);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
