// 分析セクションの管理を独立画面にした件の確認
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
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  // ---- 銘柄詳細: 分析の横に編集リンクがある ----
  const sid = await p.evaluate(() => { const s = DB.stocks.find(x => x.name === 'テスト精機'); openStock(s.id); return s.id; });
  await p.waitForTimeout(300);
  const link = await p.evaluate(() => {
    const lbls = [...document.querySelectorAll('#view .lbl')];
    const l = lbls.find(x => x.textContent.trim().startsWith('分析'));
    if (!l) return null;
    // 開閉見出しでは編集リンクがラッパーに包まれる。ラッパーも文字は「編集」なので、
    // 押せるほう(onclickを持つほう)を掴む
    const e = l.querySelector('.grp-edit') || [...l.querySelectorAll('span')].find(x => x.textContent.trim() === '編集' && x.getAttribute('onclick'));
    if (!e) return null;
    e.setAttribute('data-t', '1');
    return { onclick: e.getAttribute('onclick'), h: Math.round(e.getBoundingClientRect().height) };
  });
  ok('分析の見出しに編集リンクがある', !!link);
  ok('編集リンクは分析セクションの管理を開く', /sheetSectionMaster/.test(link.onclick));
  ok('編集リンクも44pxのタップ領域', link.h >= 44);

  await p.click('[data-t="1"]'); await p.waitForTimeout(300);
  const sheet = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok('分析セクションの管理が開く', /分析セクションの管理/.test(sheet));
  ok('影響範囲が書かれている', /すべての銘柄に共通の設定/.test(sheet));
  ok('表示中の件数が出る', /\d+\/\d+件を表示中/.test(sheet));
  ok('独立画面なので「項目選択に戻る」が出ない', !/項目選択に戻る/.test(sheet));

  // ---- 切り替えると分析の一覧に反映される ----
  const before = await p.evaluate(() => DB.sectionMaster.filter(c => c.on).length);
  await p.evaluate(() => { const i = DB.sectionMaster.findIndex(c => c.on); DB.sectionMaster[i].on = false; save(); sheetSectionMaster(STATE.stockId, null); });
  await p.waitForTimeout(250);
  await p.evaluate(() => { closeSheet(); render(); });
  await p.waitForTimeout(300);
  const secs = await p.evaluate(() => document.querySelectorAll('#view .sec').length);
  ok('非表示にすると分析の一覧から消える', secs === before - 1);

  // ---- 指標の設定シートからは入口が消えている ----
  const met = await p.evaluate(() => { sheetMetricsMaster(); return document.querySelector('#sheet').innerText; });
  ok('指標の設定に分析セクションの入口が無い', !/大カテゴリの表示\/非表示/.test(met));

  // ---- 市場カードでも粒度ごとのマスターを開く ----
  const mkt = await p.evaluate(() => {
    closeSheet(); const s = DB.stocks.find(x => x.kind === '市場'); openStock(s.id);
    const l = [...document.querySelectorAll('#view .lbl')].find(x => x.textContent.trim().startsWith('分析'));
    // 開閉見出しでは編集リンクがラッパーに包まれる。ラッパーも文字は「編集」なので、
    // 押せるほう(onclickを持つほう)を掴む
    const e = l.querySelector('.grp-edit') || [...l.querySelectorAll('span')].find(x => x.textContent.trim() === '編集' && x.getAttribute('onclick'));
    e.click();   // onclick を直接評価すると event が無くて落ちるので、実際に押す
    return document.querySelector('#sheet').innerText;
  });
  await p.waitForTimeout(250);
  ok('市場カードでは市場用の管理画面が開く', /分析セクションの管理\(市場用\)/.test(mkt));
  ok('市場カードでは影響範囲が「市場」のカードと書かれる', /「市場」のカードすべてに共通/.test(mkt));
  const mm = await p.evaluate(() => { closeSheet(); sheetMarketMetricsMaster(); return document.querySelector('#sheet').innerText; });
  ok('市場の指標設定からも入口が消えている', !/大カテゴリの表示\/非表示/.test(mm));

  // ---- 「調べる項目を選ぶ」からは戻れる ----
  const ord = await p.evaluate(sid => { closeSheet(); openStock(sid); sheetSectionMaster(sid, 'order'); return document.querySelector('#sheet').innerText; }, sid);
  await p.waitForTimeout(250);
  ok('項目選択から来たときは戻るボタンが出る', /項目選択に戻る/.test(ord));

  // ---- 大カテゴリの表示(入力済み件数はバッジのみ)と、小項目の日付表記 ----
  await p.evaluate(sid => { closeSheet(); DB.sectionMaster.forEach(c => c.on = true); save(); openStock(sid);
    document.querySelectorAll('#view .sec').forEach(e => e.classList.add('open')); }, sid);
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => ({
    headTexts: [...document.querySelectorAll('#view .sec .h')].map(e => e.textContent.trim()),
    withBadge: [...document.querySelectorAll('#view .sec .h')].filter(e => e.querySelector('.chip.navy')).length,
    filledCats: DB.sectionMaster.filter(c => c.on && c.subs.some(su => stock(STATE.stockId).sections[su])).length,
    dates: [...document.querySelectorAll('#view .sub-row .m')].map(e => e.textContent.trim()).filter(Boolean),
    wraps: [...document.querySelectorAll('#view .sub-row')].filter(e => e.getBoundingClientRect().height > 50).length,
  }));
  ok('大カテゴリに「n/m 項目」を出さない', r.headTexts.length > 0 && r.headTexts.every(x => !/項目/.test(x)));
  ok('入力済みの件数はバッジで分かる', r.withBadge === r.filledCats && r.withBadge > 0);
  ok('小項目の日付は年(下2桁)から出る', r.dates.length > 0 && r.dates.every(x => /^\d{2}\/\d{1,2}\/\d{1,2}$/.test(x)));
  ok('日付が伸びても項目名が折り返さない', r.wraps === 0);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
