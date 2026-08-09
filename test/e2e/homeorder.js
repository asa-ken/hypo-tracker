// ホームは、中身のある区分を先に見せること(認知負荷)
//
// 3区分は 期限切れ → 今日のリマインダー → 今週の予定 の順に並ぶ。
// ところが期限切れも今日も0件の日(通常はこれ)には、空の2区分が画面の最上部を占め、
// 中身にたどり着くまでに読み飛ばす必要があった。画面で最も価値のある位置を
// 「ここには何もない」が占めている状態。
//
// 情報は減らさない。3区分とも見出しは残し、件数も出す。位置だけを変える。
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

  // 見出しを上から順に、名前・件数・画面上のy座標で取る
  const heads = () => p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')].map(e => {
    const m = e.textContent.trim().replace(/\s+/g, ' ').match(/^(.+?) \((\d+)\)/);
    return { name: m ? m[1] : e.textContent.trim(), n: m ? +m[2] : null, top: Math.round(e.getBoundingClientRect().top) };
  }));

  // ---- 1. 通常の日: 期限切れ0・今日0、今週3 ----
  await p.evaluate(() => go('home')); await p.waitForTimeout(350);
  const h0 = await heads();
  ok('3区分とも残っている(情報を減らしていない)', h0.length === 3, h0.map(x => x.name));
  ok('件数は3区分とも表示される', h0.every(x => x.n !== null), h0);
  ok('通常データで空の区分と中身のある区分が混在する(テスト前提)',
    h0.some(x => x.n === 0) && h0.some(x => x.n > 0), h0.map(x => x.name + ':' + x.n));

  const filled0 = h0.filter(x => x.n > 0), empty0 = h0.filter(x => x.n === 0);
  ok('中身のある区分が、空の区分より上にある',
    Math.max(...filled0.map(x => x.top)) < Math.min(...empty0.map(x => x.top)),
    h0.map(x => `${x.name}(${x.n})@${x.top}`));
  ok('画面の一番上は中身のある区分', h0[0].n > 0, h0[0]);

  // 中身のある区分は、1画面(844px)の中に収まっていてほしい
  ok('中身のある区分が最初の1画面に収まる', Math.max(...filled0.map(x => x.top)) < 844,
    filled0.map(x => `${x.name}@${x.top}`));

  // ---- 2. 区分どうしの相対順序は、定義順のまま保つ ----
  // 空だからといって並び替えの中で順序が入れ替わると、毎回どこに何があるか学習し直しになる
  const ORDER = ['期限切れ', '今日のリマインダー', '今週の予定'];
  const idx = a => a.map(x => ORDER.indexOf(x.name));
  const ascending = a => idx(a).every((v, i, arr) => i === 0 || arr[i - 1] < v);
  ok('中身のある区分どうしは定義順のまま', ascending(filled0), filled0.map(x => x.name));
  ok('空の区分どうしも定義順のまま', ascending(empty0), empty0.map(x => x.name));

  // ---- 3. 期限切れが出たら最上部に来る ----
  await p.evaluate(() => {
    DB.reminders.push({ id: 'r_ord_x', stockId: '9001', hypoIds: [], title: '期限切れ検証', comment: null,
      cat: '決算プレビュー', freq: '単発 2020/1/1', times: ['08:30'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: 'p', src: 'テスト', srcDate: fmtToday(), log: [], nextFire: null });
    save(); go('home');
  }); await p.waitForTimeout(350);
  const h1 = await heads();
  ok('期限切れが出ると最上部に来る', h1[0].name === '期限切れ' && h1[0].n === 1, h1.map(x => x.name + ':' + x.n));
  ok('このとき空になった区分は下に残る', h1[h1.length - 1].n === 0, h1.map(x => x.name + ':' + x.n));

  // ---- 4. 全区分に中身があるときは、定義順そのまま ----
  await p.evaluate(() => {
    DB.reminders.push({ id: 'r_ord_t', stockId: '9002', hypoIds: [], title: '本日検証', comment: null,
      cat: '報道確認', freq: '単発 ' + fmtToday(), times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: 'p', src: 'テスト', srcDate: fmtToday(), log: [], nextFire: null });
    save(); go('home');
  }); await p.waitForTimeout(350);
  const h2 = await heads();
  ok('3区分すべてに中身があるとき、並びは定義順', JSON.stringify(h2.map(x => x.name)) === JSON.stringify(ORDER), h2.map(x => x.name));
  ok('このとき0件の区分は無い', h2.every(x => x.n > 0), h2.map(x => x.name + ':' + x.n));

  // ---- 5. 畳んだ状態は区分ごとに保たれる(並べ替えても取り違えない) ----
  await p.evaluate(() => { toggleGroup('home:今週の予定'); }); await p.waitForTimeout(300);
  const closed = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今週の予定/.test(x.textContent));
    const body = l.nextElementSibling;
    return { closedKeys: DB.uiPrefs.anaClosed.slice(),
             今週の予定の中身が消えた: !body || body.classList.contains('lbl') };
  });
  ok('畳んだ区分の記憶は区分名で保たれる', closed.closedKeys.includes('home:今週の予定'), closed.closedKeys);
  ok('畳むとその区分の中身だけが消える', closed.今週の予定の中身が消えた, closed);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
