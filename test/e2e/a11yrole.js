// 市場・銘柄分析の行と区分見出しを、支援技術とキーボードから「押せるもの」として扱えること
//
// 2026-09-25(市場・銘柄分析の初回レビュー)で発見: 銘柄の行(.list-row)と区分見出し(.lbl.grp)は
// onclick を持つ素の div で、role もフォーカスも無かった。Tab キーは「名前順」から下のタブバーへ
// 飛び、一覧の行には一度も止まらない(実測)。読み上げでも「ボタン」と伝わらず、区分が開いているか
// 閉じているかも伝わらない。見た目は変えずに、意味(role・フォーカス・開閉状態)だけを足す。
//
// 区分見出しは、右側に「編集」「一括コピー」などの別の操作を持つもの(groupBlockWithEdit)がある。
// 見出し全体を role=button にすると操作の中に操作が入れ子になるため、見出しの文字部分を
// 開閉ボタンにし、右側の操作はその隣に並ぶ別のボタンにする。タップで開閉できる範囲(見出し全体)は変えない
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
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(250);

  // ---- 1. 行は押せるものとして伝わる ----
  const rows = await p.evaluate(() => [...document.querySelectorAll('#view .list-row')].map(r => ({
    role: r.getAttribute('role'), tab: r.tabIndex, name: r.querySelector('.ttl').textContent.trim() })));
  ok('検査対象の行がある(市場1・銘柄4)', rows.length === 5, rows.length);
  ok('行は role=button を持つ', rows.every(r => r.role === 'button'), rows);
  ok('行はキーボードでフォーカスできる(tabindex=0)', rows.every(r => r.tab === 0), rows);

  // ---- 2. 区分見出しは開閉ボタンとして伝わり、開閉状態を持つ ----
  const heads = () => p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')].map(h => {
    const t = h.querySelector('[role="button"][aria-expanded]');
    return { text: h.textContent.trim().replace(/\s+/g, ' '), hasToggle: !!t, tab: t ? t.tabIndex : null, expanded: t ? t.getAttribute('aria-expanded') : null };
  }));
  const h0 = await heads();
  ok('区分見出しが3つある', h0.length === 3, h0);
  ok('区分見出しに開閉ボタン(role=button・aria-expanded)がある', h0.every(h => h.hasToggle && h.tab === 0), h0);
  ok('開いている区分は aria-expanded=true', h0.every(h => h.expanded === 'true'), h0);

  // ---- 3. Tab で行に止まり、Enter で開ける ----
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  const order = [];
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press('Tab');
    order.push(await p.evaluate(() => document.activeElement.textContent.trim().replace(/\s+/g, ' ').slice(0, 16)));
  }
  ok('Tab で一覧の行に止まる', order.some(t => /テスト精機/.test(t)), order);
  ok('Tab で区分見出しに止まる', order.some(t => /^保有 \(2\)/.test(t)), order);
  await p.evaluate(() => [...document.querySelectorAll('#view .list-row')].find(r => /テスト精機/.test(r.textContent)).focus());
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  ok('行で Enter を押すと詳細が開く', await p.evaluate(() => STATE.stockId === '9001'));
  await p.evaluate(() => backFromDetail()); await p.waitForTimeout(250);

  // ---- 4. Space で区分を開閉でき、状態が伝わる ----
  const toggleOf = label => p.evaluate(l => {
    const h = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.textContent.trim().startsWith(l));
    h.querySelector('[role="button"][aria-expanded]').focus();
  }, label);
  await toggleOf('ウォッチ');
  await p.keyboard.press(' '); await p.waitForTimeout(250);
  const closed = await heads();
  ok('Space で区分が閉じ、aria-expanded=false になる', closed.find(h => /^ウォッチ/.test(h.text)).expanded === 'false', closed);
  ok('Space でページがスクロールしない(既定の動作を止める)', await p.evaluate(() => (document.scrollingElement.scrollTop || 0) === 0));
  await toggleOf('ウォッチ');
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  ok('Enter でもう一度開く', (await heads()).find(h => /^ウォッチ/.test(h.text)).expanded === 'true');

  // ---- 5. 見出し全体のタップで開閉できる範囲は変わらない(見た目・触り心地の回帰) ----
  await p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')].find(x => /^ウォッチ/.test(x.textContent.trim())).click());
  await p.waitForTimeout(250);
  ok('見出し全体のタップで今までどおり閉じる', (await heads()).find(h => /^ウォッチ/.test(h.text)).expanded === 'false');
  await p.evaluate(() => toggleGroup('ウォッチ')); await p.waitForTimeout(200);

  // ---- 6. 右側に操作を持つ見出し(銘柄詳細の「編集」「追加」)は、操作が入れ子にならない ----
  // groupBlockWithEdit はホームの一括コピーと共通。固定した日付ではホームにリマインダーが無く
  // 一括コピーが出ないため、常に出る銘柄詳細で確かめる
  await p.evaluate(() => openStock('9001')); await p.waitForTimeout(300);
  const nest = await p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')].map(h => ({
    text: h.textContent.trim().replace(/\s+/g, ' ').slice(0, 20),
    headRole: h.getAttribute('role'),
    nested: [...h.querySelectorAll('[role="button"]')].some(x => x.parentElement.closest('[role="button"]')),
    edit: h.querySelector('.grp-edit') ? { role: h.querySelector('.grp-edit').getAttribute('role'), tab: h.querySelector('.grp-edit').tabIndex } : null,
  })));
  ok('見出しそのものには role を付けない(中の操作を入れ子にしない)', nest.every(n => n.headRole === null), nest);
  ok('ボタンの中にボタンが入っていない', nest.every(n => !n.nested), nest);
  ok('右側の操作(編集・追加)も押せるものとして伝わる', nest.filter(n => n.edit).length > 0 && nest.filter(n => n.edit).every(n => n.edit.role === 'button' && n.edit.tab === 0), nest);

  // ---- 7. 見出しの操作を Enter で押しても、開閉まで一緒に起きない ----
  const before = await p.evaluate(() => closedGroups().slice());
  await p.evaluate(() => document.querySelector('#view .lbl.grp .grp-edit').focus());
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  ok('右側の操作を Enter で押すと、その操作(シート)が開く', await p.evaluate(() => document.querySelector('#scrim').classList.contains('show')));
  ok('右側の操作を Enter で押しても区分は開閉しない', JSON.stringify(await p.evaluate(() => closedGroups())) === JSON.stringify(before));
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(300);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
