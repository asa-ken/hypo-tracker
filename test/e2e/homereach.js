// ホームに出ている項目は、すべてその本体へ到達できること(実運用摩擦)
//
// 2026-08-09 の再構成で「今日のリマインダー」を「今週の予定」から外した結果、
// 今日の分と期限切れの分がホーム上でコピーしかできなくなり、
// 再スケジュール・休止・削除に到達できなくなった。
// 変更前は、ホームに表示される項目はすべて openReminder() で開けた。
// 「表示されているのに触れない項目を作らない」を仕様として固定する。
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
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  // 実行日に依存しないよう、期限切れと今日の分をその場で作る。
  // 9001は期限切れ2件(複数件の銘柄)、9002は期限切れ1件(1件だけの銘柄)、
  // TSTCは今日1件。「1件のときは本体へ直接、複数件のときは絞り込んだ一覧へ」を両方見る
  await p.evaluate(() => {
    const t = fmtToday();
    const mk = (id, sid, title, freq) => ({ id, stockId: sid, hypoIds: [], title, comment: null,
      cat: '決算プレビュー', freq, times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: title + 'のプロンプト', src: 'テスト', srcDate: t, log: [], nextFire: null });
    DB.reminders.push(mk('r_ex_a', '9001', '期限切れA', '単発 2020/1/1'));
    DB.reminders.push(mk('r_ex_b', '9001', '期限切れB', '単発 2020/1/2'));
    DB.reminders.push(mk('r_ex_c', '9002', '期限切れC', '単発 2020/1/3'));
    DB.reminders.push(mk('r_td_a', 'TSTC', '本日A', '単発 ' + t));
    save(); go('home');
  });
  await p.waitForTimeout(400);

  const section = (name) => p.evaluate(n => {
    const lbl = [...document.querySelectorAll('#view .lbl.grp')].find(x => new RegExp(n).test(x.textContent));
    if (!lbl) return null;
    const rows = [...lbl.nextElementSibling.querySelectorAll('.list-row')];
    return {
      head: lbl.textContent.trim().replace(/\s+/g, ' '),
      rows: rows.map(r => ({ text: r.textContent.replace(/\s+/g, ' ').trim().slice(0, 30), on: r.getAttribute('onclick') })),
      // カード自体が押せる形(対象が1つだけのとき)も到達手段として数える
      cardOn: (lbl.nextElementSibling.classList.contains('card') ? lbl.nextElementSibling.getAttribute('onclick') : null),
      html: lbl.nextElementSibling.outerHTML,
    };
  }, name);

  // ---- 1. 期限切れ: 複数件ある銘柄は絞り込んだ一覧へ、1件だけの銘柄は本体へ ----
  const ex = await section('期限切れ');
  ok('期限切れが3件ある(テスト前提)', /期限切れ \(3\)/.test(ex.head), ex.head);
  ok('期限切れの各行に到達操作がある', ex.rows.length > 0 && ex.rows.every(r => !!r.on), ex.rows);
  ok('複数件ある銘柄(9001)は絞り込んだリマインダー一覧へ行ける',
    ex.rows.some(r => /テスト精機/.test(r.text) && /openRem\('9001'\)/.test(r.on || '')), ex.rows);
  ok('1件だけの銘柄(9002)はリマインダー本体へ直接行ける',
    ex.rows.some(r => /サンプル半導体/.test(r.text) && /openReminder\('r_ex_c'\)/.test(r.on || '')), ex.rows);

  // ---- 2. 今日のリマインダー: 対象が1つだけでも到達できる ----
  const td2 = await section('今日のリマインダー');
  ok('今日のリマインダーが1件ある(テスト前提)', /今日のリマインダー \(1\)/.test(td2.head), td2.head);
  ok('対象が1つだけのカードからも本体へ行ける',
    /openReminder\('r_td_a'\)/.test(td2.html), td2.html.slice(0, 200));

  // ---- 3. コピーは到達操作を巻き込まない ----
  // 行を押すと遷移、コピーボタンを押すとコピーだけ。イベントの伝播で両方走らないこと
  await p.evaluate(() => { window._nav = []; window.openRem = s => { window._nav.push('openRem:' + s); }; });
  // 到達操作が付く前は対象の行そのものが無いので、クリックできたかどうかも結果として返す
  const clicked = await p.evaluate(() => {
    // openRem( と openReminder( は接頭辞が同じなので、括弧まで含めて区別する
    const row = [...document.querySelectorAll('#view .list-row')].find(r => /テスト精機/.test(r.textContent) && /openRem\(/.test(r.getAttribute('onclick') || ''));
    if (!row) return false;
    row.querySelector('button').click();
    return true;
  });
  await p.waitForTimeout(250);
  ok('コピーボタンを持つ到達可能な行がある(テスト前提)', clicked);
  ok('コピーボタンを押しても画面遷移しない', clicked && (await p.evaluate(() => window._nav)).length === 0, await p.evaluate(() => window._nav));
  ok('コピーは成立している', clicked && /コピーしました/.test(await p.evaluate(() => document.querySelector('#toast').textContent)));

  // ---- 4. 到達操作を足してもタップ領域は44pxを保つ ----
  const small = await p.evaluate(() => [...document.querySelectorAll('#view button,#view .list-row,#view [onclick]')]
    .map(e => { const r = e.getBoundingClientRect(); return { cls: e.className, h: Math.round(r.height), w: Math.round(r.width) }; })
    .filter(x => x.w > 0 && x.h < 44));
  ok('44px未満のタップ要素がない', small.length === 0, small);

  // ---- 5. ホームに出ている項目に、触れないものが残っていない ----
  // 「今週の予定」は元から openReminder に行ける。3区分すべてで到達できることを通しで見る
  const orphan = await p.evaluate(() => {
    const out = [];
    ['期限切れ', '今日のリマインダー', '今週の予定'].forEach(n => {
      const lbl = [...document.querySelectorAll('#view .lbl.grp')].find(x => new RegExp(n).test(x.textContent));
      if (!lbl || /\(0\)/.test(lbl.textContent)) return;
      const body = lbl.nextElementSibling;
      const reach = body.matches('[onclick]') || body.querySelectorAll('[onclick*="openReminder"],[onclick*="openRem("]').length > 0;
      if (!reach) out.push(n);
    });
    return out;
  });
  ok('件数のある区分は、すべて本体へ到達できる', orphan.length === 0, orphan);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
