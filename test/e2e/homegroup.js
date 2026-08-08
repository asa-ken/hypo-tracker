// ホームの「対応が必要」「今週の予定」を市場銘柄分析と同じ要領で畳めること
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
  const go = () => p.evaluate(() => window.go('home'));
  // 「対応が必要」の中にも対象ごとのコピー行(.list .list-row)があるので、
  // 予定の件数は「今週の予定」見出し以降だけを数える
  const state = () => p.evaluate(() => {
    const v = document.querySelector('#view'), c = v.lastElementChild;
    const schedLbl = [...v.querySelectorAll('.lbl.grp')].find(x => /今週の予定/.test(x.textContent));
    let schedRows = 0;
    for (let el = schedLbl && schedLbl.nextElementSibling; el; el = el.nextElementSibling) {
      schedRows += el.querySelectorAll('.list-row').length;
    }
    return {
      heads: [...v.querySelectorAll('.lbl.grp')].map(e => e.textContent.trim().replace(/\s+/g, ' ')),
      attnCards: v.querySelectorAll('.card.attn').length,
      schedRows,
      closed: DB.uiPrefs.anaClosed.slice(),
      h: c ? Math.round(c.offsetTop + c.offsetHeight - v.offsetTop) : 0,
    };
  });

  await go(); await p.waitForTimeout(300);
  const s0 = await state();
  ok('ホームの2区分が開閉見出しになっている', s0.heads.length === 2);
  ok('「対応が必要」に件数が付く', /^対応が必要 \(\d+\)/.test(s0.heads[0]));
  ok('「今週の予定」に件数が付く', /^今週の予定 \(\d+\)/.test(s0.heads[1]));
  ok('既定は両方とも開いている', s0.closed.length === 0 && s0.attnCards > 0 && s0.schedRows > 0);

  // 見出しは市場銘柄分析と同じ .lbl.grp(44pxのタップ領域・矢尻)。
  // アクセントバーは大カテゴリではなく中身の行側に付ける方針なので、見出しには無い
  const headStyle = await p.evaluate(() => {
    const el = document.querySelector('#view .lbl.grp');
    return { h: Math.round(el.getBoundingClientRect().height), bar: getComputedStyle(el, '::before').content, caret: !!el.querySelector('svg.caret') };
  });
  ok('見出しは44px以上のタップ領域', headStyle.h >= 44);
  ok('見出しにキャレットが付く', headStyle.caret);
  ok('見出しにはアクセントバーを付けない', headStyle.bar === 'none');

  // ---- 「対応が必要」を畳むと今週の予定が上に来る ----
  const schedTopBefore = await p.evaluate(() => {
    const lbl = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今週の予定/.test(x.textContent));
    return Math.round(lbl.getBoundingClientRect().top);
  });
  await p.evaluate(() => toggleGroup('home:対応が必要')); await p.waitForTimeout(300);
  const s1 = await state();
  ok('畳むと対応が必要の中身が消える', s1.attnCards === 0);
  ok('見出しと件数は残る', /^対応が必要 \(\d+\)/.test(s1.heads[0]));
  ok('今週の予定は畳まれない', s1.schedRows === s0.schedRows);
  const schedTopAfter = await p.evaluate(() => {
    const lbl = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今週の予定/.test(x.textContent));
    return Math.round(lbl.getBoundingClientRect().top);
  });
  ok('今週の予定が画面上部に繰り上がる', schedTopAfter < schedTopBefore);
  ok('全体の高さが縮む', s1.h < s0.h);
  ok('今週の予定が1画面に収まる', schedTopAfter < 400);

  // ---- 今週の予定も個別に畳める ----
  await p.evaluate(() => toggleGroup('home:今週の予定')); await p.waitForTimeout(300);
  const s2 = await state();
  ok('両方畳める', s2.attnCards === 0 && s2.schedRows === 0 && s2.heads.length === 2);

  // ---- リロードしても畳んだまま ----
  await p.reload(); await p.waitForTimeout(400);
  await go(); await p.waitForTimeout(300);
  const s3 = await state();
  ok('リロードしても畳んだ状態が残る', s3.closed.length === 2 && s3.attnCards === 0 && s3.schedRows === 0);

  // ---- 開き直せる ----
  await p.evaluate(() => { toggleGroup('home:対応が必要'); toggleGroup('home:今週の予定'); }); await p.waitForTimeout(300);
  const s4 = await state();
  ok('開き直すと元に戻る', s4.attnCards === s0.attnCards && s4.schedRows === s0.schedRows);

  // ---- 市場銘柄分析側の開閉と混ざらない(キーが画面ごとに分かれている) ----
  await p.evaluate(() => { toggleGroup('home:対応が必要'); go('analysis'); }); await p.waitForTimeout(300);
  const ana = await p.evaluate(() => ({ lists: document.querySelectorAll('#view .list').length, heads: document.querySelectorAll('#view .lbl.grp').length }));
  ok('ホームを畳んでも市場銘柄分析は開いたまま', ana.lists === ana.heads && ana.lists > 0);
  await p.evaluate(() => { toggleGroup('保有'); go('home'); }); await p.waitForTimeout(300);
  ok('市場銘柄分析を畳んでもホームの今週の予定は開いたまま', (await state()).schedRows > 0);

  // ---- 開閉の矢尻がある画面では、行の右端に「›」を並べない ----
  await go(); await p.waitForTimeout(350);
  const sched = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今週の予定/.test(x.textContent));
    let arrows = 0, rows = 0, dated = 0;
    for (let e = l.nextElementSibling; e; e = e.nextElementSibling) {
      arrows += e.querySelectorAll('.arrow').length;
      e.querySelectorAll('.list-row').forEach(r => { rows++; if (/\d+\/\d+\(.\)/.test(r.textContent)) dated++; });
    }
    return { arrows, rows, dated };
  });
  ok('今週の予定に行がある(テスト前提)', sched.rows > 0);
  ok('今週の予定の行に右向きの矢尻を出さない', sched.arrows === 0);
  ok('日付は残る', sched.dated === sched.rows);
  ok('区分見出しの開閉の矢尻は残る', await p.evaluate(() =>
    document.querySelectorAll('#view .lbl.grp svg.caret').length === 2));
  ok('行はこれまでどおり押せる', await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今週の予定/.test(x.textContent));
    const r = l.nextElementSibling.querySelector('.list-row');
    return !!(r && r.getAttribute('onclick'));
  }));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
