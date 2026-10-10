// 個別銘柄・市場の詳細画面を右スワイプで一覧に戻す
const { chromium } = require('playwright');
// 時刻を固定する(2026-09-25追記)。固定していないと、実行日がフィクスチャの日付から離れるにつれ
// 期限切れ・今週の予定などの判定が変わって落ちる(9/24に8スイート、9/25にcloseBtnが実際に失敗)。
// 他のスイートと同じ日付に揃える
const CLOCK = new Date('2026-08-22T03:00:00Z');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

// #view 上で直接タッチイベントを起こす(帯を重ねていないため target は実際の要素)
async function swipe(page, x1, y1, x2, y2, steps = 8) {
  await page.evaluate(([x1, y1, x2, y2, steps]) => {
    const el = document.elementFromPoint(x1, y1) || document.body;
    const mk = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    let t = mk(x1, y1);
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    for (let i = 1; i <= steps; i++) {
      t = mk(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
      el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    }
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
  }, [x1, y1, x2, y2, steps]);
}

// 指を置いたまま止める(途中の見え方を確かめるため)
async function swipeHold(page, x1, y1, x2, y2, steps = 8) {
  await page.evaluate(([x1, y1, x2, y2, steps]) => {
    const el = document.elementFromPoint(x1, y1) || document.body;
    window._swEl = el;
    const mk = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    let t = mk(x1, y1);
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    for (let i = 1; i <= steps; i++) {
      t = mk(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
      el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    }
    window._swT = t;
  }, [x1, y1, x2, y2, steps]);
}
async function swipeRelease(page) {
  await page.evaluate(() => {
    const t = window._swT;
    window._swEl.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
  });
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install({ time: CLOCK });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  const open = () => p.evaluate(() => { go('analysis'); openStock(DB.stocks.find(s => s.name === 'テスト精機').id); });
  // 横スクロールする部品(ページャー・業績推移の表)を避けた安全な座標を選ぶ
  const safeY = async () => { const y = await p.evaluate(() => {
    const e = document.querySelector('#view .sec'); e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
    await p.waitForTimeout(120); return y; };

  // ---- 1. 左40%からの右スワイプで一覧に戻る ----
  await open(); await p.waitForTimeout(300);
  ok('銘柄詳細が開いている', await p.evaluate(() => !!STATE.stockId));
  await swipe(p, 60, await safeY(), 260, await safeY());
  await p.waitForTimeout(300);
  ok('右スワイプで一覧に戻る', await p.evaluate(() => !STATE.stockId && document.querySelector('#topTitle').textContent === '市場・銘柄分析'));
  ok('transformが残らない', await p.evaluate(() => !document.querySelector('#view').style.transform && !document.querySelector('.phone').style.transform));

  // ---- 1b. 30%(旧しきい値)〜40%(新しきい値)の間から始めても戻る ----
  // 390px幅なら 30%=117px, 40%=156px。この間の x=140 は旧しきい値では対象外だった
  await open(); await p.waitForTimeout(300);
  await swipe(p, 140, await safeY(), 340, await safeY());
  await p.waitForTimeout(300);
  ok('30〜40%の間から始めても一覧に戻る(閾値が広がっている)', await p.evaluate(() => !STATE.stockId));

  // ---- 2. 右半分から始めた場合は戻らない ----
  await open(); await p.waitForTimeout(300);
  await swipe(p, 300, await safeY(), 380, await safeY());
  await p.waitForTimeout(300);
  ok('右半分からのスワイプでは戻らない', await p.evaluate(() => !!STATE.stockId));

  // ---- 2b. 新しきい値(40%=156px)のすぐ外からは戻らない ----
  await swipe(p, 170, await safeY(), 370, await safeY());
  await p.waitForTimeout(300);
  ok('40%のすぐ外から始めたスワイプでは戻らない', await p.evaluate(() => !!STATE.stockId));

  // ---- 3. 短いスワイプ(しきい値未満)では戻らない ----
  await swipe(p, 40, await safeY(), 90, await safeY());
  await p.waitForTimeout(300);
  ok('50pxのスワイプでは戻らない', await p.evaluate(() => !!STATE.stockId));

  // ---- 4. 縦スクロールは邪魔されない ----
  await p.evaluate(() => document.querySelector('#view').scrollTop = 0);
  await swipe(p, 60, await safeY(), 70, (await safeY()) - 300);
  await p.waitForTimeout(200);
  ok('縦方向のドラッグでは戻らない', await p.evaluate(() => !!STATE.stockId));

  // ---- 5. 指標ページャーの上では戻らない(横スワイプはページ送りに使う) ----
  const pg = await p.evaluate(() => {
    document.querySelector('#view').scrollTop = 0;
    const el = document.querySelector('#view .pages'); if (!el) return null;
    const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) };
  });
  ok('指標ページャーが左40%にかかっている', pg && pg.x < 390 * 0.4);
  await swipe(p, pg.x, pg.y, pg.x + 200, pg.y);
  await p.waitForTimeout(300);
  ok('ページャー上の右スワイプでは戻らない', await p.evaluate(() => !!STATE.stockId));

  // ---- 6. 業績推移の表(横スクロール)の上でも戻らない ----
  const tb = await p.evaluate(() => {
    const el = document.querySelector('#view .xscroll'); if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };
  });
  await p.waitForTimeout(200);
  const overflows = await p.evaluate(() => { const e = document.querySelector('#view .xscroll'); return !!e && e.scrollWidth > e.clientWidth + 2; });
  if (tb) { await swipe(p, tb.x, tb.y, tb.x + 200, tb.y); await p.waitForTimeout(300); }
  const backed = await p.evaluate(() => !STATE.stockId);
  ok(overflows ? '横スクロールする表の上では戻らない' : '幅に収まる表の上では戻れる(死角にしない)', overflows ? !backed : backed);

  // ---- 7. シートが開いている間はシート側の担当 ----
  await open(); await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelector('#view').scrollTop = 0; sheetStockMenu(STATE.stockId); });
  await p.waitForTimeout(250);
  await swipe(p, 60, 400, 260, 400);
  await p.waitForTimeout(300);
  ok('シートが開いている間は詳細画面が戻らない', await p.evaluate(() => !!STATE.stockId));
  await p.evaluate(() => closeSheet());

  // ---- 8. 市場カードでも戻れる ----
  await p.evaluate(() => { go('analysis'); openStock(DB.stocks.find(s => s.kind === '市場').id); });
  await p.waitForTimeout(300);
  await swipe(p, 60, await safeY(), 260, await safeY());
  await p.waitForTimeout(300);
  ok('市場カードの詳細からも戻れる', await p.evaluate(() => !STATE.stockId));

  // ---- 9. 一覧画面では何も起きない ----
  await p.evaluate(() => go('home')); await p.waitForTimeout(250);
  await swipe(p, 60, 400, 260, 400);
  await p.waitForTimeout(250);
  ok('一覧画面でスワイプしても画面が変わらない', await p.evaluate(() => STATE.tab === 'home' && !document.querySelector('#view').style.transform));

  // ---- 12. スワイプ中の見え方(2026-10-10 変更: Chrome風) ----
  // 以前は本文が指に合わせて右へずれ、下に戻り先の一覧(半透明の下敷き)が見えていた。
  // ユーザー指示「coolではないので chromeのようなUXにしてほしい」で、ページは動かさず、
  // 画面の左端から丸い「←」(#backArrow)が指の高さに出てくる形にした。しきい値を越えると
  // 「←」が紺に変わり(離せば戻る合図)、離すと戻る。しきい値の手前で離すと「←」は引っ込む
  await p.evaluate(() => {
    for (let i = 0; i < 20; i++) DB.stocks.push({ id: 'z' + i, name: '増量銘柄' + i, code: '' + (7000 + i), kind: '保有', metrics: {}, trend: {}, sections: {}, links: [] });
    save(); backFromDetail(); go('analysis'); setViewScroll(60);
  });
  await p.waitForTimeout(200);
  ok('一覧がスクロールできる状態になっている', await p.evaluate(() => viewScroll() === 60));
  ok('詳細に入ると先頭から始まる', await p.evaluate(() => { openStock(DB.stocks.find(s => s.name === 'テスト精機').id); return viewScroll() === 0; }));
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id));
  await p.waitForTimeout(300);
  const arrow = () => p.evaluate(() => { const a = document.querySelector('#backArrow'); const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
    return { op: +cs.opacity, armed: a.classList.contains('armed'), cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, w: Math.round(r.width), h: Math.round(r.height) }; });
  const y = await safeY();
  await swipeHold(p, 60, y, 200, y);
  await p.waitForTimeout(80);
  const mid = await p.evaluate(() => ({
    phone: document.querySelector('.phone').style.transform,
    view: document.querySelector('#view').style.transform,
    prevShown: !!document.querySelector('#backPrev'), // 下敷きの部品ごと廃止した
    topFixed: document.querySelector('.top').getBoundingClientRect().left === 0,
    tabFixed: document.querySelector('.tabbar').getBoundingClientRect().left === 0,
  }));
  const a1 = await arrow();
  ok('スワイプ中もページ(本文・枠)は動かない', mid.phone === '' && mid.view === '');
  ok('ヘッダーとタブバーは固定されたまま', mid.topFixed && mid.tabFixed);
  ok('戻り先の下敷きは出さない', !mid.prevShown);
  ok('左端から丸い「←」が出る', a1.op > 0.9 && a1.left >= 0 && a1.left < 60, a1);
  ok('「←」は指の高さに出る', Math.abs(a1.cy - y) <= 3, { y, cy: a1.cy });
  ok('「←」は44px以上の丸', a1.w >= 44 && a1.h >= 44, a1);
  ok('しきい値を越えると「←」が紺になる(離せば戻る合図)', a1.armed);

  await swipeRelease(p);
  await p.waitForTimeout(350);
  const after = await p.evaluate(() => ({
    back: !STATE.stockId,
    view: document.querySelector('#view').style.transform,
    scroll: viewScroll(),
    arrowOp: +getComputedStyle(document.querySelector('#backArrow')).opacity,
  }));
  ok('離すと一覧に戻る', after.back);
  ok('戻った後は「←」が消える', after.arrowOp === 0, after.arrowOp);
  ok('本文のtransformが残らない', !after.view);
  ok('一覧のスクロール位置が復元される', after.scroll === 60);

  // ---- 12b. 詳細をスクロールしていても「←」は指の高さに出る(画面に固定) ----
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id));
  await p.waitForTimeout(300);
  await p.evaluate(() => setViewScroll(600));
  await p.waitForTimeout(150);
  const scrolledY = await p.evaluate(() => {
    const e = document.querySelector('#view .sec'); const r = e.getBoundingClientRect();
    return Math.round(Math.min(Math.max(r.top + 20, 120), 700));
  });
  await swipeHold(p, 60, scrolledY, 200, scrolledY);
  await p.waitForTimeout(100);
  const a2 = await arrow();
  ok('その状態で実際に詳細はスクロールしている(前提の確認)', await p.evaluate(() => viewScroll() > 0));
  ok('詳細をスクロールしていても「←」は指の高さ', Math.abs(a2.cy - scrolledY) <= 3, { scrolledY, cy: a2.cy });
  await swipeRelease(p);
  await p.waitForTimeout(350);

  // ---- 13. 途中でやめた場合 ----
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id));
  await p.waitForTimeout(300);
  const y2 = await safeY();
  await swipeHold(p, 40, y2, 85, y2);
  await p.waitForTimeout(60);
  const a3 = await arrow();
  ok('途中でも「←」は出る', a3.op > 0, a3);
  ok('しきい値の手前では「←」は紺にならない', !a3.armed);
  ok('引いた量が少ないほど「←」は左端寄り(指に合わせて出てくる)', a3.cx < a1.cx, { short: a3.cx, long: a1.cx });
  await swipeRelease(p);
  await p.waitForTimeout(350);
  ok('しきい値未満なら詳細のまま', await p.evaluate(() => !!STATE.stockId));
  ok('やめたら「←」は引っ込み、本文も動いていない', await p.evaluate(() => +getComputedStyle(document.querySelector('#backArrow')).opacity === 0 && !document.querySelector('#view').style.transform));

  // ---- 14. 開閉の矢印 ----
  const caret = await p.evaluate(() => { backFromDetail(); go('analysis');
    const c = document.querySelector('#view .lbl.grp .caret');
    const r = c.getBoundingClientRect(); return { tag: c.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height) }; });
  ok('開閉の矢印はSVG', caret.tag === 'svg');
  ok('開閉の矢印は20px以上', caret.w >= 20 && caret.h >= 20);

  // ---- 10. ヘッダーの戻るボタンと同じ動きになる ----
  ok('戻るボタンはbackFromDetailを使う', await p.evaluate(() => { openStock(DB.stocks[0].id); return document.querySelector('#topAct').onclick === backFromDetail; }));

  // ---- 11. タップ・縦スクロール・横スクロール部品を殺していないこと ----
  await open(); await p.waitForTimeout(300);
  await p.evaluate(() => { const e = document.querySelector('#view .list-row'); e.scrollIntoView({ block: 'center' }); e.setAttribute('data-t', '1'); });
  await p.waitForTimeout(150);
  await p.tap('[data-t="1"]');
  await p.waitForTimeout(300);
  ok('メモ行のタップは従来どおりシートが開く', await p.evaluate(() => document.querySelector('#scrim').classList.contains('show')));
  await p.evaluate(() => closeSheet());
  const ta = await p.evaluate(() => ({
    body: getComputedStyle(document.querySelector('#view')).touchAction,
    pages: getComputedStyle(document.querySelector('#view .pages')).touchAction,
    xs: getComputedStyle(document.querySelector('#view .xscroll')).touchAction,
  }));
  ok('本文は縦スクロールを許可している', /pan-y/.test(ta.body));
  ok('本文は横方向をブラウザに渡さない', !/pan-x/.test(ta.body));
  ok('ページャーは横スクロールを許可している', /pan-x|manipulation/.test(ta.pages));
  ok('横スクロールする表も横方向を許可している', /pan-x|manipulation/.test(ta.xs));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
