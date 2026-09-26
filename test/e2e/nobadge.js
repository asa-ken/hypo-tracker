const { chromium } = require('playwright');
// 時刻を固定する(2026-09-25追記)。固定していないと、実行日がフィクスチャの日付から離れるにつれ
// 期限切れ・今週の予定などの判定が変わって落ちる(9/24に8スイート、9/25にcloseBtnが実際に失敗)。
// 他のスイートと同じ日付に揃える
const CLOCK = new Date('2026-08-22T03:00:00Z');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (label, v) => console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v));

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.clock.install({ time: CLOCK });
  await page.goto('http://127.0.0.1:8731/index.html');
  await page.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await page.reload();
  await page.waitForTimeout(400);

  // ホーム
  await page.evaluate(() => go('home'));
  await page.waitForTimeout(200);
  const home = await page.evaluate(() => document.querySelector('#view').innerText);
  ok('ホームに「鮮度切れ」が出ない', !/鮮度切れ/.test(home));
  ok('ホームに「要更新」が出ない', !/要更新/.test(home));

  // 銘柄分析リスト
  await page.evaluate(() => go('analysis'));
  await page.waitForTimeout(200);
  const list = await page.evaluate(() => document.querySelector('#view').innerText);
  ok('リストに「要更新」チップが出ない', !/要更新/.test(list));
  ok('リストに「最新」チップが出ない', !/最新/.test(list));
  ok('ソートに「鮮度が古い順」が出ない', !/鮮度が古い順/.test(list));

  // 個別銘柄詳細
  await page.evaluate(() => openStock('9001'));
  await page.waitForTimeout(300);
  const detail = await page.evaluate(() => document.querySelector('#view').innerText);
  ok('詳細に「分析の要更新」が出ない', !/分析の要更新/.test(detail));
  ok('詳細に「最新」チップが出ない', !/最新/.test(detail));

  ok('staleCount関数が残っていない', await page.evaluate(() => typeof staleCount === 'undefined'));

  // ---- 注目・メモの件数バッジを出さない(ユーザー指示、2026-09-26) ----
  // 「この数を強調することに大きな意味はない」。一覧の行の「メモ・注目 N」と、
  // 銘柄詳細・市場詳細の上部の「注目 N」「メモ N」を出さない。
  // 件数そのものは詳細の見出し「メモ・注目ポイント (N)」に残る(区分の件数表示であってバッジではない)
  const badgeIn = () => page.evaluate(() => [...document.querySelectorAll('#view .chip')]
    .map(c => c.textContent.trim()).filter(t => /^(メモ・注目|注目|メモ) \d+$/.test(t)));
  ok('詳細の上部に「注目 N」「メモ N」のバッジが出ない(銘柄)', (await badgeIn()).length === 0);
  ok('詳細の見出しの件数(メモ・注目ポイント (N))は残る', /メモ・注目ポイント \(7\)/.test(detail));
  await page.evaluate(() => { backFromDetail(); openStock('mkt_test1'); });
  await page.waitForTimeout(300);
  ok('詳細の上部に「注目 N」のバッジが出ない(市場)', (await badgeIn()).length === 0);
  ok('市場詳細の関連銘柄のチップは残る', await page.evaluate(() => [...document.querySelectorAll('#view .pill-row .chip')].some(c => /テスト精機/.test(c.textContent))));
  await page.evaluate(() => { backFromDetail(); go('analysis'); });
  await page.waitForTimeout(250);
  ok('一覧の行に「メモ・注目 N」のバッジが出ない', (await badgeIn()).length === 0);
  ok('一覧の市場・業界・テーマの種別チップは残る', await page.evaluate(() => [...document.querySelectorAll('#view .list-row .chip.gray')].some(c => /^市場$/.test(c.textContent.trim()))));

  console.log('JSエラー:', JSON.stringify(errs));
  await page.screenshot({ path: __dirname + '/nobadge_home.png' });
  await browser.close();
})();
