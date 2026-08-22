// スクリーンショットから測る画面の指標(検証の段階2)。
//
// これまで `test/e2e/` に6枚のPNGをコミットしていたが、ベースライン比較をする仕組みは無く、
// 実行のたびに `git checkout -- *.png` で差分を破棄していた。撮影のコストは払っているのに、
// 差分という成果だけ毎回捨てている状態だった(2026-08-22、実測で確認)。
//
// このスイートは3つの量を測り、記録値と比べる。DOMからは見えないものを見るのが目的。
//   ink     … 地色以外が占める割合。画面の詰まり具合
//   colored … 有彩色(グレー以外)が占める割合。強調色がじわじわ増えていないか
//   高さ    … `#view` の scrollHeight。情報密度。表示要素を増やさなくても余白の取り方で伸びる
//
// 撮影は `#view` 要素そのものを対象にする。ページ全体(`fullPage`)ではこのアプリの内部
// スクロールを追えず、画面によって全体が入ったり入らなかったりして測る範囲が揃わない
// (実測: ホーム・市場・リマインダーは844pxのまま、銘柄詳細だけ2419pxまで伸びた)。
// かといってビューポートだけを撮ると、折り返しより下が一切写らない。取り込み画面では
// カードがすべて折り返しの下にあり、PR #155 で変えた部分が1画素も入らなかった(実測)。
// 要素を指定して撮ると、ビューポートより高くても全体が入る(実測: 390x1627px)。
//
// `visualnoise.js`(線の本数)とは測るものが違う。PR #155(取り込み画面の枠線廃止)の前後で:
//   線の本数  62 → 41 本        (visualnoise が捉える)
//   colored   15.54% → 10.05%  amber背景の廃止。35%減。**線の数ではまったく見えない**
//   ink       54.16% → 56.69%  地色の塗りが線を置き換えたぶん、むしろ増えた
//   高さ      1857 → 2014px     +157px。この周のコストとして誰も記録していなかった
// 3つとも別の向きに動いており、片方だけでは画面の変化を捉えきれないことが確認できる。
//
// 許容差について: 実測では実行間で完全に一致する(同一環境・同一Chromium)。それでも割合には
// ±0.2ポイントの許容を置いてある。Chromiumが上がるとアンチエイリアスの差で全数値がずれ、
// 無関係な理由で落ち続ける事故を避けるため。上の実測(2.6〜5.3ポイント)に対して十分小さく、
// 意味のある変化は取りこぼさない。高さは整数なので完全一致で見る。
const { chromium } = require('playwright');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const { decodePng } = require('./png.js');
const rd = fs.readFileSync(__dirname + '/fixtures/realdata.json', 'utf8');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

const FIXED = new Date('2026-08-22T03:00:00Z');
const TOL = 0.2; // 割合の許容差(ポイント)

// 記録値(2026-08-22実測)。変えるときは増減の理由を DECISIONS.md に書く。
// 減った場合も一致しなくなるので必ず更新する(古い値を残すと、その差分ぶんを無検査で戻せる)
const BASELINE = {
  'ホーム':                 { 高さ:  775, ink: 11.82, colored:  2.02 },
  '市場・銘柄分析':         { 高さ:  775, ink: 17.80, colored:  4.46 },
  'リマインダー':           { 高さ:  775, ink: 49.49, colored:  5.24 },
  '銘柄詳細':               { 高さ: 2349, ink: 52.10, colored:  8.38 },
  '取り込み(貼り付け後)':   { 高さ: 2014, ink: 56.69, colored: 10.05 },
};

const MD = `# 銘柄: テスト精機 (9001)
## 指標
- 配当利回り: 2.1 | 単位:% | 基準日 2026/8/20
- PBR: 1.8 | 基準日 2026/8/20
- これは形式に沿っていない行です
- これも読めない行です
## 注目ポイント
- 本文: 決算発表を確認する
- イベント日: 2026/9/10

これは自由文です。メモ候補として拾われます。
もう1つ自由文を置きます。
`;

function metrics(buf) {
  const { width: w, height: h, data, bpp } = decodePng(buf);
  const stride = w * bpp;
  const counts = new Map();
  let colored = 0, total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * stride + x * bpp;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    total++;
    // 32段階に丸めて数える。1段階の差はアンチエイリアスで揺れるため
    const key = (r >> 3) + ',' + (g >> 3) + ',' + (b >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
    // グレー(R≒G≒B)から離れている画素を有彩色とみなす
    if (Math.max(r, g, b) - Math.min(r, g, b) > 20) colored++;
  }
  const bg = [...counts.values()].sort((a, b) => b - a)[0];
  return { ink: +(100 * (total - bg) / total).toFixed(2), colored: +(100 * colored / total).toFixed(2) };
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const got = {};
  const errs = [];

  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install({ time: FIXED });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), rd);
  await p.reload(); await p.waitForTimeout(500);
  for (const [label, s] of [['ホーム', 'home'], ['市場・銘柄分析', 'analysis'], ['リマインダー', 'reminder']]) {
    await p.evaluate(x => go(x), s);
    await p.waitForTimeout(400);
    got[label] = { ...metrics(await p.locator('#view').screenshot()), 高さ: await p.evaluate(() => document.querySelector('#view').scrollHeight) };
  }
  await p.evaluate(() => {
    const st = DB.stocks.slice().sort((a, b) => (b.metrics || []).length - (a.metrics || []).length)[0];
    openStock(st.id);
  });
  await p.waitForTimeout(450);
  got['銘柄詳細'] = { ...metrics(await p.locator('#view').screenshot()), 高さ: await p.evaluate(() => document.querySelector('#view').scrollHeight) };
  await p.close();

  const q = await b.newPage({ viewport: { width: 390, height: 844 } });
  q.on('pageerror', e => errs.push(String(e)));
  await q.clock.install({ time: FIXED });
  await q.goto('http://127.0.0.1:8731/index.html');
  await q.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await q.reload(); await q.waitForTimeout(400);
  await q.evaluate(() => go('import')); await q.waitForTimeout(300);
  await q.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, MD);
  await q.waitForTimeout(500);
  got['取り込み(貼り付け後)'] = { ...metrics(await q.locator('#view').screenshot()), 高さ: await q.evaluate(() => document.querySelector('#view').scrollHeight) };
  await q.close();

  for (const k of Object.keys(BASELINE)) {
    const exp = BASELINE[k], act = got[k];
    const bad = [];
    if (act.高さ !== exp.高さ) bad.push(`高さ ${exp.高さ}→${act.高さ}`);
    for (const m of ['ink', 'colored']) {
      if (Math.abs(act[m] - exp[m]) > TOL) bad.push(`${m} ${exp[m]}→${act[m]}`);
    }
    ok(`${k}: 高さ・ink・coloredが記録どおり`, bad.length === 0,
      bad.length ? { 差分: bad, 実測: act } : undefined);
  }
  console.log('実測値:', JSON.stringify(got));
  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
