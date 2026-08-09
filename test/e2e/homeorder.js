// ホームの区分は、意味的な優先順位で固定して並べること
//
// 順序は 今日のリマインダー → 期限切れ → 今週の予定 で常に固定する。件数では動かさない。
//
// 2026-08-09 に一度「中身のある区分を先に、空の区分を後ろに」という並べ替えを入れたが撤回した。
// 「今日のリマインダーは無い」ことは、この画面で最初に確認したい答えそのものであり、
// 空であることが価値の無さを意味しない。件数で位置が動くと、
// 毎日ホームを開くたびに「今日の分はどこにあるか」を探し直すことになる。
// 詳細は DECISIONS.md の同日エントリを参照。
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

// 意味的な優先順位。今日やることが最初、次に取りこぼし、最後に先の予定
const ORDER = ['今日のリマインダー', '期限切れ', '今週の予定'];

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  // 見出しを上から順に、名前・件数・画面上のy座標で取る
  const heads = () => p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')].map(e => {
    const m = e.textContent.trim().replace(/\s+/g, ' ').match(/^(.+?) \((\d+)\)/);
    return { name: m ? m[1] : e.textContent.trim(), n: m ? +m[2] : null, top: Math.round(e.getBoundingClientRect().top) };
  }));
  // freq の TODAY は、実行日に依存しないようブラウザ側で当日の日付に置き換える
  const mk = (id, sid, title, freq) => ({ id, stockId: sid, hypoIds: [], title, comment: null,
    cat: '決算プレビュー', freq, times: ['23:59'], startDate: null, endDate: null, paused: false,
    changes: [], prompt: 'p', src: 'テスト', srcDate: null, log: [], nextFire: null });
  const setAndRead = (reminders) => p.evaluate(rs => {
    DB.reminders = rs.map(r => ({ ...r, srcDate: fmtToday(), freq: r.freq.replace('TODAY', fmtToday()) }));
    save(); go('home');
  }, reminders).then(() => p.waitForTimeout(320)).then(heads);

  // ---- 1. 通常の日(今日0・期限切れ0・今週3) ----
  await p.evaluate(() => go('home')); await p.waitForTimeout(350);
  const h0 = await heads();
  ok('3区分とも出ている(情報を減らしていない)', h0.length === 3, h0.map(x => x.name));
  ok('件数は3区分とも表示される', h0.every(x => x.n !== null), h0);
  ok('並びは 今日 → 期限切れ → 今週の予定', JSON.stringify(h0.map(x => x.name)) === JSON.stringify(ORDER), h0.map(x => x.name));
  ok('今日が0件でも最上位にある', h0[0].name === '今日のリマインダー' && h0[0].n === 0, h0[0]);
  ok('期限切れが0件でも2番目にある', h0[1].name === '期限切れ' && h0[1].n === 0, h0[1]);
  // 「今日は無い」が最初に読めることが目的なので、最上位は1画面目に入っていること
  ok('今日の区分は最初の1画面に入る', h0[0].top < 844, h0[0]);

  // ---- 2. 件数が変わっても並びは動かない ----
  const onlyExpired = await setAndRead([mk('x1', '9001', '期限切れA', '単発 2020/1/1')]);
  ok('期限切れだけがあるときも並びは固定', JSON.stringify(onlyExpired.map(x => x.name)) === JSON.stringify(ORDER),
    onlyExpired.map(x => `${x.name}(${x.n})`));
  ok('このとき今日(0件)は依然として最上位', onlyExpired[0].name === '今日のリマインダー' && onlyExpired[0].n === 0, onlyExpired[0]);

  const onlyToday = await setAndRead([mk('y1', '9001', '本日A', '単発 TODAY')]);
  ok('今日だけがあるときも並びは固定', JSON.stringify(onlyToday.map(x => x.name)) === JSON.stringify(ORDER),
    onlyToday.map(x => `${x.name}(${x.n})`));
  ok('このとき期限切れ(0件)は2番目のまま', onlyToday[1].name === '期限切れ' && onlyToday[1].n === 0, onlyToday[1]);

  const allFilled = await setAndRead([
    mk('x2', '9001', '期限切れB', '単発 2020/1/2'),
    mk('y2', '9002', '本日B', '単発 TODAY'),
    mk('z2', 'TSTC', '来週', '単発 2026/12/25'),
  ]);
  ok('全区分に中身があるときも並びは固定', JSON.stringify(allFilled.map(x => x.name)) === JSON.stringify(ORDER),
    allFilled.map(x => `${x.name}(${x.n})`));
  ok('このとき3区分とも中身がある', allFilled.every(x => x.n > 0), allFilled.map(x => `${x.name}:${x.n}`));

  // 4通りすべてで、名前の並びが完全に同じであること
  const orders = [h0, onlyExpired, onlyToday, allFilled].map(a => JSON.stringify(a.map(x => x.name)));
  ok('件数の組み合わせが変わっても並びは1通り', new Set(orders).size === 1, orders);

  // ---- 3. 「今日は無い」が状態として読めること ----
  const todayHead = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今日のリマインダー/.test(x.textContent));
    return l.textContent.trim().replace(/\s+/g, ' ');
  });
  ok('今日の区分は件数つきの見出しを持つ', /^今日のリマインダー \(\d+\)/.test(todayHead), todayHead);

  // ---- 4. 畳んだ状態は区分ごとに保たれる ----
  await p.evaluate(() => { toggleGroup('home:今日のリマインダー'); }); await p.waitForTimeout(300);
  const closed = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今日のリマインダー/.test(x.textContent));
    const body = l.nextElementSibling;
    return { keys: DB.uiPrefs.anaClosed.slice(),
             中身が消えた: !body || body.classList.contains('lbl'),
             見出しは残る: !!l,
             並び: [...document.querySelectorAll('#view .lbl.grp')].map(e => e.textContent.trim().split(' (')[0]) };
  });
  ok('畳んだ区分の記憶は区分名で保たれる', closed.keys.includes('home:今日のリマインダー'), closed.keys);
  ok('畳むと中身だけが消え、見出しは残る', closed.中身が消えた && closed.見出しは残る, closed);
  ok('畳んでも並びは変わらない', JSON.stringify(closed.並び) === JSON.stringify(ORDER), closed.並び);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
