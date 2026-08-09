// 区分ぜんぶを対象にするコピーは、区分見出しの並びに文字ボタンとして置くこと
//
// カードの一番下に全幅のボタンを置くと、区分の中身より操作のほうが強く見える。
// 「その区分ぜんぶ」に効く操作なので、区分の見出しと同じ行にあるほうが対象と一致する。
// 銘柄詳細の分析カテゴリで使っている groupBlockWithEdit の文字ボタンと同じ作りに揃える。
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

  // 今日2銘柄・期限切れ1銘柄。今日は「複数銘柄」、期限切れは「1銘柄だけ」の形になる
  await p.evaluate(() => {
    const t = fmtToday();
    const mk = (id, sid, ti, f) => ({ id, stockId: sid, hypoIds: [], title: ti, comment: null,
      cat: '決算プレビュー', freq: f, times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: ti + 'のプロンプト', src: 'テスト', srcDate: t, log: [], nextFire: null });
    DB.reminders = [mk('t1', '9001', '本日A', '単発 ' + t), mk('t2', '9002', '本日B', '単発 ' + t),
                    mk('e1', 'TSTC', '期限切れA', '単発 2020/1/1')];
    save(); go('home');
  }); await p.waitForTimeout(400);

  const head = (name) => p.evaluate(n => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => new RegExp(n).test(x.textContent));
    if (!l) return null;
    const btn = l.querySelector('.grp-edit');
    const r = btn ? btn.getBoundingClientRect() : null;
    return {
      label: btn ? btn.textContent.trim() : null,
      on: btn ? btn.getAttribute('onclick') : null,
      w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
      caret: !!l.querySelector('svg.caret'),
      headH: Math.round(l.getBoundingClientRect().height),
    };
  }, name);

  // ---- 1. 今日・期限切れの見出しに文字ボタンがある ----
  const today = await head('今日のリマインダー');
  ok('今日の見出しにコピーの文字ボタンがある', !!today.label, today);
  ok('押すと今日の分をまとめてコピーする', /copyBrief\(\)/.test(today.on || ''), today.on);
  ok('見出しの開閉と同時に走らない(伝播を止めている)', /stopPropagation/.test(today.on || ''), today.on);
  ok('文字ボタンのタップ領域は44px以上', today.w >= 44 && today.h >= 44, today);
  ok('矢尻は残る', today.caret);
  ok('見出し自体の高さは44px以上のまま', today.headH >= 44, today);

  const exp = await head('期限切れ');
  ok('期限切れの見出しにも文字ボタンがある', !!exp.label, exp);
  ok('押すと期限切れの分をまとめてコピーする', /copyExpired\(\)/.test(exp.on || ''), exp.on);
  ok('今日と期限切れで文字ボタンの語が同じ', today.label === exp.label, { today: today.label, expired: exp.label });

  // ---- 2. 中身の側からは全幅の一括コピーボタンが無くなる ----
  const body = await p.evaluate(() => {
    const v = document.querySelector('#view');
    return { 全幅ボタン: /全部まとめて一括コピー/.test(v.innerText),
      カード内ボタン: [...v.querySelectorAll('.card.attn button')].map(e => e.textContent.trim()) };
  });
  ok('「全部まとめて一括コピー」の全幅ボタンは無くなった', !body.全幅ボタン, body);
  ok('カードに残るのは銘柄ごとのコピーだけ', body.カード内ボタン.every(t => t === 'コピー'), body.カード内ボタン);

  // ---- 3. 今週の予定にはコピーを置かない(コピー対象ではない区分) ----
  const sched = await head('今週の予定');
  ok('今週の予定の見出しにはコピーを置かない', sched && sched.label === null, sched);

  // ---- 4. 0件の区分にはコピーを置かない ----
  await p.evaluate(() => { DB.reminders = DB.reminders.filter(r => r.id === 'e1'); save(); go('home'); });
  await p.waitForTimeout(350);
  const emptyToday = await head('今日のリマインダー');
  ok('0件の区分にはコピーの文字ボタンを出さない', emptyToday && emptyToday.label === null, emptyToday);
  ok('0件でも見出しと矢尻は残る', emptyToday.caret && emptyToday.headH >= 44, emptyToday);

  // ---- 5. 実際にコピーできる ----
  await p.evaluate(() => {
    const t = fmtToday();
    DB.reminders.push({ id: 't3', stockId: '9001', hypoIds: [], title: '本日C', comment: null,
      cat: '決算プレビュー', freq: '単発 ' + t, times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: '本日Cのプロンプト', src: 'テスト', srcDate: t, log: [], nextFire: null });
    save(); go('home');
  }); await p.waitForTimeout(350);
  await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今日のリマインダー/.test(x.textContent));
    l.querySelector('.grp-edit').click();
  });
  await p.waitForTimeout(250);
  ok('文字ボタンを押すとコピーされる', /コピーしました/.test(await p.evaluate(() => document.querySelector('#toast').textContent)));
  // 見出しを押したときの開閉と混ざっていないこと
  ok('コピーしても区分は畳まれない', await p.evaluate(() => !DB.uiPrefs.anaClosed.includes('home:今日のリマインダー')),
    await p.evaluate(() => DB.uiPrefs.anaClosed.slice()));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
