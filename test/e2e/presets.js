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
  // ① 素の状態(新規インストール相当)= seed の既定がそのまま出る
  await p.evaluate(() => localStorage.removeItem('hypo_tracker_proto_v1'));
  await p.reload(); await p.waitForTimeout(400);

  const m = await p.evaluate(() => ({
    stock: DB.metricsMaster.snap, mkt: DB.marketMetricsMaster.snap, ind: DB.industryMetricsMaster.snap,
    stockHidden: DB.metricsMaster.hiddenSnap, mktHidden: DB.marketMetricsMaster.hiddenSnap,
  }));
  // 2026-08-13: ROE・営業利益率は、指標(単年)と業績推移(複数年)で同じ意味の別名が
  // 登録されうるため既定の指標一覧から外した(ROEは業績推移側の既定に置く)
  ok('銘柄=4項目(自己資本比率入り。ROE/営業利益率は業績推移側)', JSON.stringify(m.stock)===JSON.stringify(['PER(予想)','PBR','自己資本比率','配当利回り(予想)']));
  ok('市場=3項目', JSON.stringify(m.mkt)===JSON.stringify(['予想PER(市場全体)','長期金利(10年)','為替(USD/JPY)']));
  ok('業界=PER/PBRのみ', JSON.stringify(m.ind)===JSON.stringify(['PER','PBR']));
  // ② 旧既定ちょうどの既存データ = 差し替わり、外れた項目は非表示へ退避される
  const mig = await p.evaluate(() => {
    // seed は save() されるまで localStorage に無いので、メモリ上のDBを書き換えて保存する
    DB.metricsMaster.snap = ['PER(予想)','PBR','時価総額','配当利回り(予想)','信用倍率','目標株価コンセンサス'];
    DB.metricsMaster.hiddenSnap = [];
    DB.marketMetricsMaster.snap = ['予想PER(市場全体)','PBR(市場全体)','長期金利(10年)','為替(USD/JPY)','騰落レシオ(25日)','VIX指数'];
    DB.marketMetricsMaster.hiddenSnap = [];
    save();
    return true;
  });
  await p.reload(); await p.waitForTimeout(400);
  // 非表示は一覧から取り除かず名前で印を付けるだけなので、画面に出るのは snap - hiddenSnap
  const m2 = await p.evaluate(() => ({
    stock: snapKeys(DB.metricsMaster), stockAll: DB.metricsMaster.snap, stockHidden: DB.metricsMaster.hiddenSnap,
    mkt: snapKeys(DB.marketMetricsMaster), mktAll: DB.marketMetricsMaster.snap, mktHidden: DB.marketMetricsMaster.hiddenSnap,
  }));
  ok('旧既定の銘柄マスターが差し替わる', JSON.stringify(m2.stock)===JSON.stringify(['PER(予想)','PBR','自己資本比率','配当利回り(予想)']));
  ok('外れた銘柄指標は非表示中になる(消えない)', ['時価総額','信用倍率','目標株価コンセンサス'].every(x=>m2.stockHidden.includes(x)));
  ok('外れた銘柄指標も一覧には残る', ['時価総額','信用倍率','目標株価コンセンサス'].every(x=>m2.stockAll.includes(x)));
  ok('1世代前の市場マスターも差し替わる', JSON.stringify(m2.mkt)===JSON.stringify(['予想PER(市場全体)','長期金利(10年)','為替(USD/JPY)']));
  ok('外れた市場指標も非表示中になる', m2.mktHidden.includes('VIX指数') && m2.mktHidden.includes('騰落レシオ(25日)'));
  ok('外れた市場指標も一覧には残る', m2.mktAll.includes('VIX指数') && m2.mktAll.includes('騰落レシオ(25日)'));

  // ③ 画面表示(seedのフジクラで確認)
  await p.evaluate(() => openStock('5803')); await p.waitForTimeout(300);
  const stk = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('銘柄画面にROEが出る(業績推移側、既定でグラフではなく表)', /ROE/.test(stk));
  // 2026-08-13: 営業利益率は指標の既定一覧から外し、業績推移側の既定にも追加していない
  // (取り込みで実際に使われたときだけ「売上高営業利益率」として業績推移に登録される)
  ok('銘柄画面に営業利益率は出ない(既定一覧から外れた)', !/営業利益率/.test(stk));
  ok('銘柄画面から信用倍率が消えた', !/信用倍率/.test(stk));
  ok('業績推移は従来どおり残る', /業績推移/.test(stk));

  await p.evaluate(() => { sheetAddMarket('市場'); document.querySelector('#am_mname').value='市場テスト'; doAddMarket(); });
  await p.waitForTimeout(400);
  const mk = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('市場画面は3指標', /為替\(USD\/JPY\)/.test(mk) && !/VIX/.test(mk) && !/騰落レシオ/.test(mk));

  await p.evaluate(() => sheetAddMarket('業界')); await p.waitForTimeout(250);
  const add = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok('業界の既定はPER/PBRのみと表示', /指標: PER \/ PBR/.test(add));

  const brief = await p.evaluate(() => briefingText());
  ok('説明書: 業界は公表値だけと指示', /公表されている業種別の数値/.test(brief));
  ok('説明書: 自力算出の中央値は書かせない', /中央値を自分で算出する必要があるもの/.test(brief));
  ok('説明書: 水準は分析に文章で書く誘導', /文章で書いてください/.test(brief));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
