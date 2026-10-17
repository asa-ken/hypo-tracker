// 会話を取り込んだ後は「市場・銘柄分析」タブの中で銘柄の詳細を出し、「← 戻る」(ブラウザの「戻る」も)で
// 市場・銘柄分析の一覧に戻ること
//
// 2026-10-10(銘柄詳細の初回レビュー)で発見: 銘柄詳細 →「会話を取り込む」→ 取り込む、と進むと詳細が出るが、
// 下のタブは「会話を取り込む」のままで、「← 戻る」を押すと一覧ではなく空の取り込み画面に戻っていた。
// 取り込み画面の上には「対象: ◯◯(銘柄詳細から開いたため自動で設定されています)」も古いまま残っていた。
// ユーザー判断(2026-10-17)「会話取り込んだら『銘柄分析』タブ移動でいいと思う。戻るは銘柄トップにすれば自然」
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const rd = fs.readFileSync(__dirname + '/fixtures/realdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));
const MD = t => `# 銘柄: 日東工器 (6151)\n## メモ\n- 本文: ${t}`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install({ time: new Date('2026-08-22T03:00:00Z') });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), rd);
  await p.reload(); await p.waitForTimeout(400);
  const st = () => p.evaluate(() => ({
    tab: STATE.tab, sid: STATE.stockId, title: document.querySelector('#topTitle').textContent,
    on: document.querySelector('.tabbar button.on').dataset.tab, scroll: viewScroll(), inApp: true,
  }));
  const paste = (t) => p.evaluate(m => { document.querySelector('#mdIn').value = m; parseAndPreview(); }, MD(t));

  // 一覧がスクロールできる長さになるよう銘柄を足す(realdata の一覧は1画面に収まる)
  await p.evaluate(() => { for (let i = 0; i < 20; i++) DB.stocks.push({ id: 'z' + i, name: '増量銘柄' + i, code: '' + (7000 + i), kind: 'ウォッチ', metrics: {}, trend: {}, sections: {}, links: [] }); save(); });

  // ---- 1. 銘柄詳細から始めた取り込み ----
  await p.evaluate(() => { go('analysis'); setViewScroll(120); }); await p.waitForTimeout(150);
  ok('(前提)一覧を120pxスクロールしてから銘柄詳細を開く', await p.evaluate(() => viewScroll()) === 120);
  await p.evaluate(() => openStock('6151')); await p.waitForTimeout(200);
  await p.evaluate(() => [...document.querySelectorAll('#view button')].find(x => /会話を取り込む/.test(x.textContent)).click()); await p.waitForTimeout(250);
  ok('(前提)取り込み画面に移り、下のタブは「会話を取り込む」', (await st()).tab === 'import');
  await paste('取り込み後の行き先の確認1'); await p.waitForTimeout(200);
  await p.evaluate(() => commitImport()); await p.waitForTimeout(400);
  const a1 = await st();
  ok('取り込むと、市場・銘柄分析タブの中で銘柄の詳細が出る', a1.tab === 'analysis' && a1.sid === '6151' && a1.title === '日東工器', a1);
  ok('下のタブも「市場・銘柄分析」に切り替わる', a1.on === 'analysis', a1.on);
  ok('取り込んだ内容は保存されている', await p.evaluate(() => DB.hypotheses.some(h => h.stockId === '6151' && h.text === '取り込み後の行き先の確認1')));
  await p.evaluate(() => document.querySelector('#topAct').click()); await p.waitForTimeout(300);
  const a2 = await st();
  ok('「← 戻る」で市場・銘柄分析の一覧に戻る(空の取り込み画面ではない)', a2.tab === 'analysis' && a2.sid === null && a2.title === '市場・銘柄分析', a2);
  ok('一覧は、銘柄詳細を開く前に見ていた位置に戻る', a2.scroll === 120, a2.scroll);

  // ---- 2. ブラウザの「戻る」でも同じ ----
  await p.evaluate(() => openStock('6151')); await p.waitForTimeout(200);
  await p.evaluate(() => [...document.querySelectorAll('#view button')].find(x => /会話を取り込む/.test(x.textContent)).click()); await p.waitForTimeout(250);
  await paste('取り込み後の行き先の確認2'); await p.waitForTimeout(200);
  await p.evaluate(() => commitImport()); await p.waitForTimeout(400);
  await p.goBack(); await p.waitForTimeout(400);
  const a3 = await p.evaluate(() => typeof STATE === 'undefined' ? { inApp: false } : { inApp: true, tab: STATE.tab, sid: STATE.stockId, title: document.querySelector('#topTitle').textContent });
  ok('ブラウザの「戻る」でも市場・銘柄分析の一覧に戻る(アプリの外へ出ない)', a3.inApp && a3.tab === 'analysis' && a3.sid === null, a3);

  // ---- 3. 下のタブから直接開いた取り込みでも、取り込み後は市場・銘柄分析タブへ ----
  await p.evaluate(() => go('import')); await p.waitForTimeout(250);
  ok('タブから開いた取り込み画面には、古い「銘柄詳細から開いた」対象の表示が残っていない', await p.evaluate(() => !/銘柄詳細から開いた/.test(document.querySelector('#view').innerText)));
  await p.selectOption('#importStockPick', '6151').catch(() => {});
  await paste('取り込み後の行き先の確認3'); await p.waitForTimeout(200);
  await p.evaluate(() => commitImport()); await p.waitForTimeout(400);
  const c1 = await st();
  ok('タブから始めた取り込みでも、市場・銘柄分析タブの中で詳細が出る', c1.tab === 'analysis' && c1.on === 'analysis' && c1.sid === '6151', c1);
  await p.evaluate(() => document.querySelector('#topAct').click()); await p.waitForTimeout(300);
  const c2 = await st();
  ok('「← 戻る」で市場・銘柄分析の一覧の先頭に戻る', c2.tab === 'analysis' && c2.sid === null && c2.scroll === 0, c2);

  // ---- 4. 取り込み後にもう一度タブから取り込み画面を開いても、前の対象は持ち越さない ----
  await p.evaluate(() => go('import')); await p.waitForTimeout(250);
  ok('取り込み後にタブから開き直した取り込み画面は空(前の対象・貼り付けを持ち越さない)', await p.evaluate(() => STATE.askStockId === null && document.querySelector('#mdIn').value === '' && !/銘柄詳細から開いた/.test(document.querySelector('#view').innerText)));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
