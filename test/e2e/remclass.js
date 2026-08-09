// ホームの区分(今日 / 期限切れ / 今週の予定)の振り分けが、日付の意味と合っていること
//
// 振り分けに calcNextFire() だけを使うと、今日の分でも時刻を過ぎた時点で null になり、
// 「今日登録したリマインダーが期限切れに出る」という状態になる。
// 期限切れは「日付そのものが過ぎた」ことであって「今日の時刻を過ぎた」ことではない。
//
// 発火の計算(calcNextFire / matchFreq)自体は変更しない。区分の振り分けだけを直す。
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

  // 画面に出ている区分ごとのタイトルを読む。実装の内部関数ではなく描画結果で判定する
  // groupBlock は見出し+中身を1つの div にまとめず兄弟要素として並べるので、
  // 中身は「次の見出しが出るまで」の兄弟要素すべてを連結して読む
  // (2026-08-09 外枠なし・地色なしに揃えたため。homeflat.js参照)
  const sections = () => p.evaluate(() => {
    const out = {};
    document.querySelectorAll('#view .lbl.grp').forEach(l => {
      const name = l.textContent.trim().split(' (')[0];
      const lines = [];
      for (let e = l.nextElementSibling; e && !e.classList.contains('lbl'); e = e.nextElementSibling)
        lines.push(...e.innerText.split('\n').map(x => x.trim()).filter(Boolean));
      out[name] = lines;
    });
    return out;
  });

  // 同じ銘柄が同じ区分に2件入るとカードが「〜 ほか」に集約され、2件目のタイトルが読めない。
  // 判定を確実にするため、件ごとに別の銘柄を割り当てる
  const setup = (list) => p.evaluate(rs => {
    const t = fmtToday();
    const S = ['9001', '9002', '9003', 'TSTC'];
    DB.reminders = rs.map((r, i) => ({ id: r.id, stockId: S[i % S.length], hypoIds: [], title: r.title, comment: null,
      cat: '決算プレビュー', freq: r.freq.replace('TODAY', t), times: r.times,
      startDate: r.startDate ? r.startDate.replace('TODAY', t) : null,
      endDate: r.endDate ? r.endDate.replace('TODAY', t) : null,
      paused: false, changes: [], prompt: 'p', src: 'テスト', srcDate: t, log: [], nextFire: null }));
    save(); go('home');
  }, list).then(() => p.waitForTimeout(320));

  const nowH = await p.evaluate(() => new Date().getHours() + ':' + String(new Date().getMinutes()).padStart(2, '0'));
  console.log('(実行時刻 ' + nowH + ' / 00:00 は過ぎた時刻、23:59 はこれからの時刻として扱う)');

  // ---- 1. 今日の日付で登録したものは、時刻を過ぎていても「今日」 ----
  await setup([
    { id: 'a', title: '今日・時刻が過ぎた', freq: '単発 TODAY', times: ['00:00'] },
    { id: 'b', title: '今日・時刻はこれから', freq: '単発 TODAY', times: ['23:59'] },
  ]);
  const s1 = await sections();
  ok('時刻がこれからの今日の分は「今日のリマインダー」に出る',
    s1['今日のリマインダー'].some(t => /今日・時刻はこれから/.test(t)), s1);
  ok('時刻を過ぎた今日の分も「今日のリマインダー」に出る',
    s1['今日のリマインダー'].some(t => /今日・時刻が過ぎた/.test(t)), s1);
  ok('時刻を過ぎただけで「期限切れ」に落ちない',
    !s1['期限切れ'].some(t => /今日・時刻が過ぎた/.test(t)), s1['期限切れ']);

  // ---- 2. 繰り返しでも、今日の時刻を過ぎたら「今週の予定」へ移らない ----
  // 毎日のリマインダーは翌日の発火が計算できてしまうため、今日の分が見えなくなる
  await setup([
    { id: 'c', title: '毎日・時刻が過ぎた', freq: '毎日', times: ['00:00'] },
    { id: 'd', title: '平日・時刻が過ぎた', freq: '平日', times: ['00:00'] },
  ]);
  const s2 = await sections();
  ok('毎日のリマインダーは、今日の時刻を過ぎても「今日」に残る',
    s2['今日のリマインダー'].some(t => /毎日・時刻が過ぎた/.test(t)), s2);
  ok('毎日のリマインダーが「今週の予定」へ流れない',
    !s2['今週の予定'].some(t => /毎日・時刻が過ぎた/.test(t)), s2['今週の予定']);

  // ---- 3. 日付そのものが過ぎたものだけが「期限切れ」 ----
  await setup([
    { id: 'e', title: '昨日以前の単発', freq: '単発 2020/1/1', times: ['09:00'] },
    { id: 'f', title: '終了日を過ぎた毎日', freq: '毎日', times: ['09:00'], endDate: '2020/1/1' },
  ]);
  const s3 = await sections();
  ok('過ぎた日付の単発は「期限切れ」', s3['期限切れ'].some(t => /昨日以前の単発/.test(t)), s3);
  ok('終了日を過ぎたものも「期限切れ」', s3['期限切れ'].some(t => /終了日を過ぎた毎日/.test(t)), s3);
  ok('期限切れは「今日」に出さない', !s3['今日のリマインダー'].some(t => /昨日以前|終了日/.test(t)), s3['今日のリマインダー']);

  // ---- 4. 先の日付は「今週の予定」 ----
  await setup([
    { id: 'g', title: '先の単発', freq: '単発 2026/12/25', times: ['09:00'] },
    { id: 'h', title: '開始日がまだ先', freq: '毎日', times: ['09:00'], startDate: '2026/12/1' },
  ]);
  const s4 = await sections();
  ok('先の日付は「今週の予定」', s4['今週の予定'].some(t => /先の単発/.test(t)), s4);
  ok('開始日がまだ先のものは「期限切れ」にしない', !s4['期限切れ'].some(t => /開始日がまだ先/.test(t)), s4['期限切れ']);
  ok('開始日がまだ先のものは「今日」にも出さない', !s4['今日のリマインダー'].some(t => /開始日がまだ先/.test(t)), s4['今日のリマインダー']);

  // ---- 5. 区分は互いに排他(同じものが2箇所に出ない) ----
  await setup([
    { id: 'i', title: '今日の分', freq: '単発 TODAY', times: ['00:00'] },
    { id: 'j', title: '過ぎた分', freq: '単発 2020/1/1', times: ['09:00'] },
    { id: 'k', title: '先の分', freq: '単発 2026/12/25', times: ['09:00'] },
  ]);
  const s5 = await sections();
  const all = [...(s5['今日のリマインダー'] || []), ...(s5['期限切れ'] || []), ...(s5['今週の予定'] || [])];
  ['今日の分', '過ぎた分', '先の分'].forEach(t => {
    ok(`「${t}」はどこか1箇所にだけ出る`, all.filter(x => x.includes(t)).length === 1,
      all.filter(x => x.includes(t)));
  });

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
