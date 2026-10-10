// 銘柄詳細・市場詳細の ☰ メニューにある設定の入口の名前と、開くシートの見出し・中身が一致すること
//
// 2026-10-10(銘柄詳細の初回レビュー)で発見:
//  ・銘柄の ☰ →「⚙ 収容指標・業績分析項目の設定」。「収容」は「主要」の誤り。開くシートの中身は
//    主要指標と業績推移の指標だけで、「分析項目」(別シート)は含まない。見出しも同じ誤った名前だった
//  ・シート内の区分名は「スナップショット指標」で、銘柄詳細の区分名「主要指標」と食い違っていた
//  ・市場の ☰ →「⚙ 指標・分析項目の設定(業界用)」で開くシートの見出しは「業界の指標の設定」。こちらも
//    分析項目は含まない
// 入口・見出し・詳細画面の区分名を同じ言葉にそろえる(表示の文言のみ。設定の中身・保存は変えない)
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const rd = fs.readFileSync(__dirname + '/fixtures/realdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install({ time: new Date('2026-08-22T03:00:00Z') });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), rd);
  await p.reload(); await p.waitForTimeout(400);

  const menuThenSheet = id => p.evaluate(sid => {
    go('analysis'); openStock(sid); sheetStockMenu(sid);
    const btn = [...document.querySelectorAll('#sheet button')].find(x => /⚙/.test(x.textContent));
    const entry = btn.textContent.replace('⚙', '').trim();
    btn.click();
    const h3 = document.querySelector('#sheet h3').textContent.trim();
    const labels = [...document.querySelectorAll('#sheet .lbl, #sheet .met-help, #sheet [class*="lbl"]')].map(e => e.textContent.trim().replace(/\s+/g, ' '));
    const text = document.querySelector('#sheet').innerText;
    closeSheet();
    const detailHeads = [...document.querySelectorAll('#view .lbl.grp > span:first-child')].map(e => e.textContent.trim());
    return { entry, h3, labels, text, detailHeads };
  }, id);

  // ---- 1. 銘柄 ----
  const s = await menuThenSheet('6151');
  ok('入口の名前に「収容」の誤字が無い', !/収容/.test(s.entry + s.h3), s);
  ok('銘柄の入口は「主要指標・業績推移の設定」', s.entry === '主要指標・業績推移の設定', s.entry);
  ok('開くシートの見出しは入口と同じ名前', s.h3 === s.entry, { entry: s.entry, h3: s.h3 });
  ok('入口・見出しに、シートに無い「分析項目」を含めない', !/分析項目/.test(s.entry + s.h3), s);
  ok('シート内の区分名は銘柄詳細と同じ「主要指標」「業績推移の指標」', /主要指標 \(表示中 \d+\/\d+\)/.test(s.text) && /業績推移の指標 \(表示中 \d+\/\d+\)/.test(s.text) && !/スナップショット指標/.test(s.text), s.text.slice(0, 200));
  ok('銘柄詳細の区分名にも「主要指標」「業績推移」がある(そろえる相手の確認)', s.detailHeads.includes('主要指標') && s.detailHeads.includes('業績推移'), s.detailHeads);

  // ---- 2. 市場・業界・テーマ ----
  const m = await menuThenSheet('mkt_fa');
  ok('市場の入口は開くシートの見出しと同じ(業界の指標の設定)', m.entry === '業界の指標の設定' && m.h3 === '業界の指標の設定', { entry: m.entry, h3: m.h3 });
  ok('市場の入口にも、シートに無い「分析項目」を含めない', !/分析項目/.test(m.entry), m.entry);

  // ---- 3. 指標を1つ開いたときの説明も同じ言葉 ----
  const where = await p.evaluate(() => { go('analysis'); openStock('6151'); sheetMetricEdit('snap', DB.metricsMaster.snap[0], 'stock'); const t = document.querySelector('#sheet').innerText; closeSheet(); return t; });
  ok('指標の編集シートの説明も「主要指標」(スナップショット指標と書かない)', /主要指標/.test(where) && !/スナップショット指標/.test(where), where.slice(0, 160));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
