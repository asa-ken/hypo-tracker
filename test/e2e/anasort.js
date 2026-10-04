// 市場・銘柄分析には並び替えの切り替え(保有優先/名前順)を置かず、常に区分ごとの並びで出すこと
//
// 経緯: 2026-09-26に並び替えの選択を DB.uiPrefs.anaSort に保存するようにした(このスイートの旧版はその検査)。
// その後のレビュー(2026-10-01)で、名前順は漢字名を読みの順に並べられない(データに読みがない)、
// 「保有優先」でも先頭は市場の区分、選択中のボタンが画面で最も重い、等が見つかり、
// ユーザー判断で「そもそもタブ自体がいらないかも。保有優先の構造でいい」(2026-10-03)となった。
// 切り替えを外し、市場・業界・テーマ → 保有 → ウォッチ の区分ごとの並びに固定する。
// 以前に名前順を保存していたデータ(uiPrefs.anaSort='名前順')でも、区分ごとの並びで出す
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

  const state = () => p.evaluate(() => ({
    seg: document.querySelectorAll('#view .seg').length,
    sortWords: /保有優先|名前順/.test(document.querySelector('#view').innerText),
    // 見出しの文字だけを見る(2件以上の区分には右に「並べ替え」が付くため。2026-10-04)
    heads: [...document.querySelectorAll('#view .lbl.grp')].map(h => h.querySelector('span').textContent.trim().replace(/\s+/g, ' ')),
    firstIsHead: !!document.querySelector('#view > .lbl.grp:first-child'),
    metas: [...document.querySelectorAll('#view .list-row .meta')].map(m => m.textContent.trim()),
  }));

  // ---- 1. 切り替えが無く、区分ごとの並びで出る ----
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(250);
  const s0 = await state();
  ok('並び替えの切り替え(.seg)が無い', s0.seg === 0, s0);
  ok('「保有優先」「名前順」の文字が画面に無い', !s0.sortWords, s0);
  ok('区分は 市場・業界・テーマ → 保有 → ウォッチ の順', JSON.stringify(s0.heads.map(h => h.replace(/ \(\d+\)$/, ''))) === JSON.stringify(['市場・業界・テーマ', '保有', 'ウォッチ']), s0.heads);
  ok('画面の一番上が最初の区分見出し(上の線を引かない見出しになる)', s0.firstIsHead, s0);
  ok('銘柄の行の補足は証券コードだけ(区分と重なる「· 保有」等を添えない)', s0.metas.filter(m => /^\w+$/.test(m)).length >= 4 && !s0.metas.some(m => / · (保有|ウォッチ)$/.test(m)), s0.metas);

  // ---- 2. 以前に名前順を保存していたデータでも、区分ごとの並びで出る ----
  await p.evaluate(() => { DB.uiPrefs = DB.uiPrefs || { anaClosed: [] }; DB.uiPrefs.anaSort = '名前順'; save(); });
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(250);
  const s1 = await state();
  ok('名前順を保存していたデータでも区分ごとの並び', s1.seg === 0 && s1.heads.length === 3 && /^保有 \(/.test(s1.heads[1]), s1.heads);
  ok('保存されていた値はデータから消さない(読まないだけ)', await p.evaluate(() => DB.uiPrefs.anaSort === '名前順'));

  // ---- 3. 銘柄が0件のときも切り替えは出ない ----
  await p.evaluate(() => { DB.stocks = []; save(); go('analysis'); }); await p.waitForTimeout(250);
  const s2 = await state();
  ok('銘柄0件のときも切り替えは出ず、案内だけ出る', s2.seg === 0 && await p.evaluate(() => /銘柄がありません/.test(document.querySelector('#view').innerText)), s2);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
