// 市場・銘柄分析の並び替え(保有優先/名前順)を、再読込しても覚えていること
//
// 2026-09-25(市場・銘柄分析の初回レビュー)で発見: 並び替えは画面内の変数(anaSort)にだけ持っており、
// 再読込のたびに「保有優先」へ戻っていた。一方、同じ画面の区分の開閉は DB.uiPrefs に保存されていて
// 再読込後も覚えている(実測)。ユーザー確認のうえ(2026-09-26「覚える、でお願い」)、
// 並び替えも DB.uiPrefs.anaSort に保存する。
// 値が無い・知らない値のときは「保有優先」として扱う(既存データの変換は要らない)
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install({ time: new Date('2026-08-22T03:00:00Z') });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  const state = () => p.evaluate(() => ({
    on: (document.querySelector('#view .seg button.on') || {}).textContent,
    heads: [...document.querySelectorAll('#view .lbl.grp')].map(h => h.textContent.trim().replace(/\s+/g, ' ')),
    saved: (JSON.parse(localStorage.getItem('hypo_tracker_proto_v1')).uiPrefs || {}).anaSort,
  }));
  const clickSort = label => p.evaluate(l => [...document.querySelectorAll('#view .seg button')].find(b => b.textContent.trim() === l).click(), label);
  const reloadToAnalysis = async () => { await p.reload(); await p.waitForTimeout(400); await p.evaluate(() => go('analysis')); await p.waitForTimeout(250); };

  // ---- 1. 保存された値が無いときは保有優先 ----
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(250);
  const s0 = await state();
  ok('保存された値が無いときは「保有優先」', s0.on === '保有優先' && s0.heads.some(h => /^保有 \(/.test(h)), s0);

  // ---- 2. 名前順を選ぶと保存され、再読込しても名前順のまま ----
  await clickSort('名前順'); await p.waitForTimeout(250);
  const s1 = await state();
  ok('名前順を選ぶと保存される', s1.on === '名前順' && s1.saved === '名前順', s1);
  await reloadToAnalysis();
  const s2 = await state();
  ok('再読込しても名前順のまま', s2.on === '名前順' && s2.heads.some(h => /^銘柄 \(/.test(h)), s2);

  // ---- 3. 詳細を開いて戻っても、タブを切り替えて戻っても名前順のまま ----
  await p.evaluate(() => document.querySelectorAll('#view .list-row')[1].click()); await p.waitForTimeout(300);
  await p.evaluate(() => backFromDetail()); await p.waitForTimeout(250);
  ok('詳細から戻っても名前順のまま', (await state()).on === '名前順');
  await p.evaluate(() => go('home')); await p.waitForTimeout(200);
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(250);
  ok('タブを切り替えて戻っても名前順のまま', (await state()).on === '名前順');

  // ---- 4. 保有優先に戻すと、それも覚える ----
  await clickSort('保有優先'); await p.waitForTimeout(250);
  await reloadToAnalysis();
  const s3 = await state();
  ok('保有優先に戻すと、再読込後も保有優先', s3.on === '保有優先' && s3.saved === '保有優先', s3);

  // ---- 5. 区分の開閉の記憶とは独立している(並び替えで開閉の記録を消さない) ----
  await p.evaluate(() => toggleGroup('ウォッチ')); await p.waitForTimeout(200);
  await clickSort('名前順'); await p.waitForTimeout(200);
  await clickSort('保有優先'); await p.waitForTimeout(200);
  ok('並び替えを切り替えても区分の開閉の記録は残る', await p.evaluate(() => closedGroups().includes('ウォッチ')));
  await p.evaluate(() => toggleGroup('ウォッチ')); await p.waitForTimeout(200);

  // ---- 6. 知らない値が保存されていても壊れず、保有優先として出す ----
  await p.evaluate(() => { DB.uiPrefs.anaSort = '存在しない並び'; save(); });
  await reloadToAnalysis();
  const s4 = await state();
  ok('知らない値のときは保有優先として出す', s4.on === '保有優先' && s4.heads.some(h => /^保有 \(/.test(h)), s4);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
