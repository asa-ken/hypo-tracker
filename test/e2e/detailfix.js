// swipecapの位置修正、詳細削除の永続化、注目バッジの文言明確化を確認
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

const MD_DUP_DETAIL = `# 銘柄: テスト精機 (9001)

## 分析
- ビジネスモデル(詳細): 自動化装置は受注から売上計上まで6〜9か月かかるため、受注残が先行指標になる。部品事業は補修需要があり相対的に安定。装置の稼働率が上がるほど部品の交換需要も増える構造で、両輪が噛み合うと利益率が跳ねる。 | 2026/7/25
`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  const sid = await p.evaluate(() => { const s = DB.stocks.find(x => x.name === 'テスト精機'); openStock(s.id); return s.id; });
  await p.waitForTimeout(300);

  // ---- 1. swipecapの位置: 指標グリッド(tight)は重ねたまま、分析項目(非tight)は独立行に ----
  const metricsCap = await p.evaluate(() => {
    const cap = document.querySelector('#metrics_cap');
    return { pos: getComputedStyle(cap).position, insidePagerNav: cap.closest('.pager-nav') !== null };
  });
  ok('指標グリッドのキャプションは従来どおり重ねたまま(position:absolute)', metricsCap.pos === 'absolute');
  ok('指標グリッドのキャプションはpager-navの中', metricsCap.insidePagerNav);

  // 分析項目シートを開いてキャプション位置を確認
  const anCap = await p.evaluate(() => {
    const s = stock(STATE.stockId);
    // details(詳細)が1件以上あって2ページ以上になる項目を選ぶ。1ページしかないとpager-nav自体が出ない
    let su = null;
    for (const k in s.sections) { if (s.sections[k].details && s.sections[k].details.length) { su = k; break; } }
    sheetAnalysisItem(s.id, su);
    return su;
  });
  await p.waitForTimeout(250);
  const anCapInfo = await p.evaluate(() => {
    const cap = document.querySelector('#an_cap');
    if (!cap) return null;
    return {
      pos: getComputedStyle(cap).position,
      insidePagerNav: cap.closest('.pager-nav') !== null,
      textAlign: getComputedStyle(cap).textAlign,
      rect: cap.getBoundingClientRect(),
    };
  });
  ok('分析項目のキャプションが存在する', !!anCapInfo);
  ok('分析項目のキャプションは独立行(position:staticまたはrelative、absoluteではない)', anCapInfo && anCapInfo.pos !== 'absolute');
  ok('分析項目のキャプションはpager-navの外', anCapInfo && !anCapInfo.insidePagerNav);
  ok('分析項目のキャプションは中央揃え', anCapInfo && anCapInfo.textAlign === 'center');
  // 画面幅いっぱいに使える(左端に張り付いて欠けていない)
  ok('キャプションが画面内に収まっている(はみ出ていない)', anCapInfo && anCapInfo.rect.left >= 0 && anCapInfo.rect.right <= 390);
  await p.evaluate(() => closeSheet());

  // ---- 2. 詳細メモの削除が「取り込みで復活しない」こと ----
  // ビジネスモデルの「事業構造」に詳細を1件手動追加してから、同内容を取り込み経由でも試す
  const secKey = anCap;
  ok('詳細つきの分析項目がテストデータにある', !!secKey);
  await p.evaluate(() => closeSheet());
  const beforeDel = await p.evaluate(su => stock(STATE.stockId).sections[su].details.length, secKey);
  const delText = await p.evaluate(su => stock(STATE.stockId).sections[su].details[0].t, secKey);
  await p.evaluate(([sid2, su]) => delDetail(sid2, su, 0), [sid, secKey]);
  await p.waitForTimeout(200);
  // askConfirmのOKボタンを押す
  await p.evaluate(() => runConfirm());
  await p.waitForTimeout(300);
  const afterDel = await p.evaluate(su => ({
    count: stock(STATE.stockId).sections[su].details.length,
    delSig: (stock(STATE.stockId).sections[su].delSig || []).slice(),
  }), secKey);
  ok('削除すると件数が減る', afterDel.count === beforeDel - 1);
  ok('削除した文章がdelSigに記録される', afterDel.delSig.includes(delText));

  // 同じ内容を取り込みで再度貼り付けても復活しないことを確認
  const md = `# 銘柄: テスト精機 (9001)\n\n## 分析\n- ${secKey}(詳細): ${delText} | 2026/7/25\n`;
  await p.evaluate(() => go('import'));
  await p.waitForTimeout(200);
  await p.evaluate(m => { document.querySelector('#mdIn').value = m; parseAndPreview(); }, md);
  await p.waitForTimeout(300);
  const preview = await p.evaluate(() => document.querySelector('#parseOut').innerText);
  ok('削除済みの内容の再取り込みは「削除済み・スキップ」と分かる', /削除済み・スキップ/.test(preview));
  await p.evaluate(() => commitImport());
  await p.waitForTimeout(400);
  const afterReimport = await p.evaluate(su => stock(DB.stocks.find(s => s.name === 'テスト精機').id).sections[su].details.length, secKey);
  ok('削除した詳細は取り込みで復活しない', afterReimport === afterDel.count);

  // ---- 3. 注目バッジの文言(候補日を明示) ----
  await p.evaluate(() => { openStock(DB.stocks.find(s => s.name === 'テスト精機').id); STATE.hypoAll = true; render(); });
  await p.waitForTimeout(300);
  const badgeText = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('候補日つきの注目ポイントは日付そのものを表示する(「リマインド未登録」だけではない)', /候補 \d{4}\/\d{1,2}\/\d{1,2}.*未登録/.test(badgeText.replace(/\n/g, ' ')));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
