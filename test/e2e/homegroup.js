// ホームの「期限切れ / 今日のリマインダー / 今週の予定」が
// それぞれ独立した開閉見出しになっていること。
// リマインド未登録はリマインダー画面へ移した(pendhint.js が担当)。
// 「対応が必要」という親見出しは行動を迫る言い回しのため廃止した(2026-08-09 DECISIONS.md参照)。
// 実行日によってフィクスチャに「今日」「期限切れ」に該当するリマインダーが無いことがあるため、
// このスイートは日付を動的に計算してテスト用データを注入し、実行日に依存しない形で検証する。
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
  const go = () => p.evaluate(() => window.go('home'));

  const state = () => p.evaluate(() => {
    const v = document.querySelector('#view'), c = v.lastElementChild;
    const heads = [...v.querySelectorAll('.lbl.grp')].map(e => e.textContent.trim().replace(/\s+/g, ' '));
    return {
      heads,
      attnCards: v.querySelectorAll('.card.attn').length,
      expiredCards: v.querySelectorAll('.card.attn.expired').length,
      closed: DB.uiPrefs.anaClosed.slice(),
      h: c ? Math.round(c.offsetTop + c.offsetHeight - v.offsetTop) : 0,
    };
  });

  // ---- 実行日に依存しないテスト用データを注入する(期限切れ2件・今日1件・銘柄をまたぐ) ----
  await p.evaluate(() => {
    const today = fmtToday();
    DB.reminders.push({ id: 'r_hg_exp1', stockId: '9001', hypoIds: [], title: '期限切れ検証1', comment: null,
      cat: '決算プレビュー', freq: '単発 2020/1/1', times: ['08:30'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: '期限切れ検証1のプロンプト', src: 'テスト', srcDate: today, log: [], nextFire: null });
    DB.reminders.push({ id: 'r_hg_exp2', stockId: '9002', hypoIds: [], title: '期限切れ検証2', comment: null,
      cat: 'テクニカル', freq: '単発 2020/1/2', times: ['08:30'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: '期限切れ検証2のプロンプト', src: 'テスト', srcDate: today, log: [], nextFire: null });
    DB.reminders.push({ id: 'r_hg_today', stockId: '9001', hypoIds: [], title: '本日検証リマインダー', comment: null,
      cat: '報道確認', freq: '単発 ' + today, times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: '本日検証のプロンプト', src: 'テスト', srcDate: today, log: [], nextFire: null });
    save();
  });
  await go(); await p.waitForTimeout(300);

  const s0 = await state();
  // リマインド未登録はリマインダー画面へ移した(pendhint.js が担当)
  ok('ホームに3区分の開閉見出しがある', s0.heads.length === 3, s0.heads);
  ok('見出しはリマインダーの状態3つだけ', s0.heads.every(h => /期限切れ|今日のリマインダー|今週の予定/.test(h)), s0.heads);
  ok('「対応が必要」という親見出しは無い(義務感を与える言い回しのため廃止)', !s0.heads.some(h => /対応が必要/.test(h)));
  ok('期限切れの件数が反映される', /^期限切れ \(2\)/.test(s0.heads[0]));
  ok('今日のリマインダーの件数が反映される', /^今日のリマインダー \(1\)/.test(s0.heads[1]));
  ok('既定はすべて開いている', s0.closed.length === 0);
  ok('期限切れ・今日どちらも地色付きカードで出る', s0.attnCards === 2);
  ok('期限切れカードだけ追加の強調(.expired)が付く', s0.expiredCards === 1);

  // ---- 見出しの形は他画面と同じ(44px・矢尻・アクセントバー無し) ----
  const headStyle = await p.evaluate(() => {
    const el = document.querySelector('#view .lbl.grp');
    return { h: Math.round(el.getBoundingClientRect().height), bar: getComputedStyle(el, '::before').content, caret: !!el.querySelector('svg.caret') };
  });
  ok('見出しは44px以上のタップ領域', headStyle.h >= 44);
  ok('見出しにキャレットが付く', headStyle.caret);
  ok('見出しにはアクセントバーを付けない', headStyle.bar === 'none');

  // ---- 期限切れ・今日のリマインダーで、コピー範囲が正しく分かれている ----
  await p.evaluate(() => copyExpired()); await p.waitForTimeout(200);
  const expiredToast = await p.evaluate(() => document.querySelector('#toast').textContent);
  ok('期限切れのコピーが成功する(2件が対象)', /コピーしました/.test(expiredToast));
  await p.waitForTimeout(300);
  await p.evaluate(() => copyBrief()); await p.waitForTimeout(200);
  const todayToast = await p.evaluate(() => document.querySelector('#toast').textContent);
  ok('今日のリマインダーのコピーが成功する(1件が対象)', /コピーしました/.test(todayToast));
  // 期限切れの銘柄別コピー(9002だけ)。今日の分(9001)が混ざらないことを見る。
  // copy()内部はclipboard Promiseの解決を待ってからtoast()を呼ぶため、
  // 呼び出しと読み取りは同じevaluateにまとめず、間を空けて非同期解決を待つ
  await p.waitForTimeout(300);
  await p.evaluate(() => copyExpiredFor('9002')); await p.waitForTimeout(200);
  const perStock = await p.evaluate(() => document.querySelector('#toast').textContent);
  ok('期限切れの銘柄別コピーが成功する', /サンプル半導体の確認プロンプトをコピーしました/.test(perStock));
  // 今週の予定には、コピー機能がそもそも無いことを確認。
  // 期限切れ(2件・2銘柄)は銘柄別コピー2 + 一括コピー1、今日(1件・1銘柄)は単一ボタン1で計4。
  // コピーボタンは行の到達操作を巻き込まないよう event.stopPropagation() を前置するので、
  // onclick の先頭が copy〜 とは限らない。属性の途中に現れる分も数える
  const briefFns = await p.evaluate(() => document.querySelector('#view').innerHTML.match(/onclick="[^"]*copy(Brief|Expired)[^"]*"/g) || []);
  ok('コピー操作は期限切れ・今日のセクションだけにある', briefFns.length === 4, briefFns);

  // ---- 今週の予定には「今日」の分を含めない ----
  const schedTitles = await p.evaluate(() => {
    const lbl = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今週の予定/.test(x.textContent));
    return [...lbl.nextElementSibling.querySelectorAll('.list-row .ttl')].map(e => e.textContent);
  });
  ok('今週の予定に「本日検証リマインダー」は出ない', !schedTitles.includes('本日検証リマインダー'));
  ok('今週の予定に期限切れの2件も出ない(次回発火が無いため)', !schedTitles.some(t => /期限切れ検証/.test(t)));

  // ---- 各区分はそれぞれ独立して畳める。片方を畳んでも他は影響を受けない ----
  const top = (label) => p.evaluate(l => {
    const lbl = [...document.querySelectorAll('#view .lbl.grp')].find(x => new RegExp(l).test(x.textContent));
    return Math.round(lbl.getBoundingClientRect().top);
  }, label);
  const todayTopBefore = await top('今日のリマインダー');
  await p.evaluate(() => toggleGroup('home:期限切れ')); await p.waitForTimeout(300);
  const s1 = await state();
  ok('期限切れを畳むと中身が消える(見出しは残る)', s1.heads[0] === s0.heads[0] &&
    !(s1.attnCards === s0.attnCards));
  ok('今日のリマインダーは畳まれない', s1.attnCards === s0.attnCards - 1);
  const todayTopAfter = await top('今日のリマインダー');
  ok('期限切れを畳むと今日のリマインダーが繰り上がる', todayTopAfter < todayTopBefore);

  await p.evaluate(() => { toggleGroup('home:今日のリマインダー'); toggleGroup('home:今週の予定'); });
  await p.waitForTimeout(300);
  const s2 = await state();
  ok('3区分とも畳める', s2.attnCards === 0 &&
    !/コピー/.test(await p.evaluate(() => document.querySelector('#view').innerText)));

  // ---- リロードしても畳んだ状態が残る ----
  await p.reload(); await p.waitForTimeout(400);
  await go(); await p.waitForTimeout(300);
  const s3 = await state();
  ok('リロードしても3区分とも畳んだ状態が残る', s3.closed.length === 3, s3.closed);

  // ---- 開き直せる ----
  await p.evaluate(() => { ['home:期限切れ', 'home:今日のリマインダー', 'home:今週の予定'].forEach(toggleGroup); });
  await p.waitForTimeout(300);
  const s4 = await state();
  ok('開き直すと元に戻る', s4.attnCards === s0.attnCards && s4.closed.length === 0);

  // ---- 市場銘柄分析側の開閉と混ざらない(キーが画面ごとに分かれている) ----
  await p.evaluate(() => { toggleGroup('home:期限切れ'); go('analysis'); }); await p.waitForTimeout(300);
  const ana = await p.evaluate(() => ({ lists: document.querySelectorAll('#view .list').length, heads: document.querySelectorAll('#view .lbl.grp').length }));
  ok('ホームを畳んでも市場銘柄分析は開いたまま', ana.lists === ana.heads && ana.lists > 0);
  await p.evaluate(() => { toggleGroup('保有'); go('home'); }); await p.waitForTimeout(300);
  ok('市場銘柄分析を畳んでもホームの今週の予定は開いたまま', (await state()).heads.some(h => /^今週の予定 \(\d+\)/.test(h)));

  // ---- 開閉の矢尻がある画面では、行の右端に「›」を並べない(今週の予定・期限切れ・今日) ----
  await p.evaluate(() => toggleGroup('home:期限切れ')); await p.waitForTimeout(300); // 開き直す
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
  ok('区分見出しの開閉の矢尻は3つとも残る', await p.evaluate(() =>
    document.querySelectorAll('#view .lbl.grp svg.caret').length === 3));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
