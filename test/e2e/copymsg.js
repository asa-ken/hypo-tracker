// ホームの一括コピーは、コピー可能な確認事項が無いときのメッセージが不正確だった(バグ報告)。
//
// 「期限切れ (N)」「今日のリマインダー (N)」の見出しは、プロンプト未設定のリマインダーも
// N に数える(区分の役割は「次回発火が計算できない/今日発火する」ことを示すだけで、
// プロンプトの有無とは無関係)。一方 copyBrief()/copyExpired() はプロンプトが無い項目を
// コピー対象から除外する。一括コピーの文字ボタンは N>0 のときしか出ないため、
// このボタンを押して rs.length===0 になるのは「区分自体が空」ではなく
// 「区分に項目はあるがコピーできる文面が無い」ときだけ。にもかかわらず旧実装は
// 「期限切れのリマインダーはありません」「今日のリマインダーはありません」という、
// 区分そのものが空であるかのようなメッセージを出していた。
// 銘柄で絞った copyExpiredFor/copyBriefFor は元から「コピーできる確認事項がありません」
// という正確な文言なので、一括側もそれに揃える。
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

  const head = (name) => p.evaluate(n => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => new RegExp(n).test(x.textContent));
    return l ? l.textContent.trim().replace(/\s+/g, ' ') : null;
  }, name);

  // ---- 1. 期限切れ: プロンプト未設定だけの1件 ----
  await p.evaluate(() => {
    DB.reminders = [{ id: 'e_np', stockId: '9001', hypoIds: [], title: '期限切れ(プロンプト無し)', comment: null,
      cat: '決算プレビュー', freq: '単発 2020/1/1', times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: '', src: 'テスト', srcDate: null, log: [], nextFire: null }];
    save(); go('home');
  }); await p.waitForTimeout(350);
  ok('期限切れが1件ある(テスト前提)', /期限切れ \(1\)/.test(await head('期限切れ')), await head('期限切れ'));
  await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /期限切れ/.test(x.textContent));
    l.querySelector('.grp-edit').click();
  });
  await p.waitForTimeout(250);
  const t1 = await p.evaluate(() => document.querySelector('#toast').textContent);
  ok('「期限切れのリマインダーはありません」という不正確なメッセージは出さない', !/期限切れのリマインダーはありません/.test(t1), t1);
  ok('銘柄別コピーと同じ「コピーできる確認事項がありません」が出る', /コピーできる確認事項がありません/.test(t1), t1);

  // ---- 2. 今日: プロンプト未設定だけの1件 ----
  await p.evaluate(() => {
    const t = fmtToday();
    DB.reminders = [{ id: 't_np', stockId: '9001', hypoIds: [], title: '本日(プロンプト無し)', comment: null,
      cat: '決算プレビュー', freq: '単発 ' + t, times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: '', src: 'テスト', srcDate: t, log: [], nextFire: null }];
    save(); go('home');
  }); await p.waitForTimeout(350);
  ok('今日のリマインダーが1件ある(テスト前提)', /今日のリマインダー \(1\)/.test(await head('今日のリマインダー')), await head('今日のリマインダー'));
  await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今日のリマインダー/.test(x.textContent));
    l.querySelector('.grp-edit').click();
  });
  await p.waitForTimeout(250);
  const t2 = await p.evaluate(() => document.querySelector('#toast').textContent);
  ok('「今日のリマインダーはありません」という不正確なメッセージは出さない', !/今日のリマインダーはありません/.test(t2), t2);
  ok('銘柄別コピーと同じ「コピーできる確認事項がありません」が出る', /コピーできる確認事項がありません/.test(t2), t2);

  // ---- 3. プロンプトがある場合は今まで通りコピーできる(回帰) ----
  await p.evaluate(() => {
    DB.reminders = [{ id: 'e_wp', stockId: '9001', hypoIds: [], title: '期限切れ(プロンプトあり)', comment: null,
      cat: '決算プレビュー', freq: '単発 2020/1/1', times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: '確認してください', src: 'テスト', srcDate: null, log: [], nextFire: null }];
    save(); go('home');
  }); await p.waitForTimeout(350);
  await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /期限切れ/.test(x.textContent));
    l.querySelector('.grp-edit').click();
  });
  await p.waitForTimeout(250);
  const t3 = await p.evaluate(() => document.querySelector('#toast').textContent);
  ok('プロンプトがあれば従来通りコピーされる(回帰)', /確認プロンプトをコピーしました/.test(t3), t3);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
