// 市場・銘柄分析の一覧で、注目テーマを市場の行だけでなく銘柄の行にも出すこと
//
// 2026-09-25(市場・銘柄分析の初回レビュー、一貫性=1の②)で発見: 注目テーマは市場の行にだけ
// 「注目: …」として出し、テーマを持つ銘柄(testdataのテスト精機・TESTCO)の行には出していなかった。
// ユーザー指示(2026-09-26「銘柄の行にも注目テーマを出す」)で、銘柄の行にも同じ書き方で出す。
// テーマが無い銘柄には何も足さない(空欄の「注目: 未設定」は出さない。義務感を生まないため)
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
  await p.clock.install({ time: new Date('2026-08-22T03:00:00Z') });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  // 市場にもテーマを入れて、市場の行と銘柄の行の書き方を比べられるようにする(testdataの市場は未設定)
  await p.evaluate(() => { DB.askPrefs.themes['mkt_test1'] = 'AI投資の循環'; save(); go('analysis'); });
  await p.waitForTimeout(300);

  const rows = () => p.evaluate(() => [...document.querySelectorAll('#view .list-row')].map(r => {
    const metas = [...r.querySelectorAll('.lt .meta')];
    const th = metas.find(m => /^注目: /.test(m.textContent.trim()));
    const cs = th ? getComputedStyle(th) : null;
    const rr = r.getBoundingClientRect();
    return {
      name: r.querySelector('.ttl').textContent.trim(),
      theme: th ? th.textContent.trim() : null,
      style: cs ? cs.fontSize + '|' + cs.color : null,
      metas: metas.map(m => m.textContent.trim()),
      h: Math.round(rr.height), overflow: r.scrollWidth > r.clientWidth + 1,
    };
  }));
  const r0 = await rows();
  const by = n => r0.find(r => r.name.includes(n));

  // ---- 1. テーマを持つ銘柄の行に「注目: テーマ」が出る ----
  ok('テスト精機の行に注目テーマが出る', by('テスト精機').theme === '注目: 省人化投資と受注残の推移', by('テスト精機'));
  ok('TESTCOの行に注目テーマが出る', by('TESTCO').theme === '注目: AIデータセンター向けの電力効率', by('TESTCO'));

  // ---- 2. テーマが無い銘柄には何も足さない ----
  ok('テーマの無い銘柄(サンプル半導体)には出さない', by('サンプル半導体').theme === null && by('サンプル半導体').metas.length === 1, by('サンプル半導体'));
  ok('テーマの無い銘柄(ダミー商事)には出さない', by('ダミー商事').theme === null, by('ダミー商事'));

  // ---- 3. 市場の行と同じ書き方(同じ部品・同じ文字サイズと色) ----
  ok('市場の行の注目テーマは従来どおり出る', by('テスト市場').theme === '注目: AI投資の循環', by('テスト市場'));
  ok('市場の行と銘柄の行で注目テーマの見た目が同じ', by('テスト精機').style === by('テスト市場').style, [by('テスト精機').style, by('テスト市場').style]);
  ok('証券コードの行はそのまま残る(テーマは別の行)', by('テスト精機').metas[0] === '9001', by('テスト精機').metas);

  // ---- 4. 行が崩れない ----
  ok('どの行も横にはみ出さない', r0.every(r => !r.overflow), r0.filter(r => r.overflow));
  ok('どの行もタップ領域は44px以上', r0.every(r => r.h >= 44), r0.map(r => r.h));

  // ---- 5. (2026-10-03に廃止)名前順の検査 ----
  // 並び替えの切り替え(保有優先/名前順)を廃止したため外した(ユーザー判断。anasort.js 参照)

  // ---- 6. テーマを変えると一覧にも反映され、消すと行から消える(2回目) ----
  await p.evaluate(() => { DB.askPrefs.themes['9002'] = '新工場の立ち上がり'; save(); render(); }); await p.waitForTimeout(200);
  ok('テーマを付けると一覧に出る', (await rows()).find(r => r.name.includes('サンプル半導体')).theme === '注目: 新工場の立ち上がり');
  await p.evaluate(() => { DB.askPrefs.themes['9002'] = ''; save(); render(); }); await p.waitForTimeout(200);
  ok('テーマを消すと一覧からも消える', (await rows()).find(r => r.name.includes('サンプル半導体')).theme === null);

  // ---- 7. 記号や長い文字もそのまま安全に出る ----
  await p.evaluate(() => { DB.askPrefs.themes['9003'] = '<b>太字</b>&「長い長い長い長い長い長い長い長い長い長い長い長い長いテーマ」'; save(); render(); }); await p.waitForTimeout(200);
  const d = (await rows()).find(r => r.name.includes('ダミー商事'));
  ok('HTMLとして解釈せず文字のまま出す', /^注目: <b>太字<\/b>&/.test(d.theme || ''), d);
  ok('長いテーマでも横にはみ出さない', !d.overflow, d);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
