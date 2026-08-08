// メモ・注目ポイント: 外枠と区切り線をやめ、1枚ずつ独立した白いカードにする
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const { decodePng } = require('./png.js');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));
const isTransparent = c => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => openStock('9001')); await p.waitForTimeout(400);
  await p.evaluate(() => { STATE.hypoAll = true; render(); }); await p.waitForTimeout(350);

  ok('前提: カードが2枚以上並んでいる', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards > .swipe').length >= 2));

  // ---- 束ねる外枠が無い ----
  const box = await p.evaluate(() => {
    const e = document.querySelector('#view .list.cards'); const s = getComputedStyle(e);
    return { bg: s.backgroundColor, bw: s.borderTopWidth, r: parseFloat(s.borderTopLeftRadius) };
  });
  ok('一覧全体に外枠の線が無い', parseFloat(box.bw) === 0);
  ok('一覧全体に背景色が無い(地色が透ける)', isTransparent(box.bg));
  ok('一覧全体の角丸も無い', box.r === 0);

  // ---- 1枚ずつが白いカード(まとまりの中の行は対象外なので直下だけ見る) ----
  const cards = await p.evaluate(() => [...document.querySelectorAll('#view .list.cards > .swipe')].map(e => {
    const s = getComputedStyle(e), row = getComputedStyle(e.querySelector('.list-row'));
    return { bw: s.borderTopWidth, r: parseFloat(s.borderTopLeftRadius),
             rowBg: row.backgroundColor, rowBw: row.borderTopWidth,
             h: Math.round(e.getBoundingClientRect().height) };
  }));
  ok('カードに枠線が無い', cards.every(c => parseFloat(c.bw) === 0));
  ok('カード間の区切り線も無い', cards.every(c => parseFloat(c.rowBw) === 0));
  ok('カードの中身は白', cards.every(c => c.rowBg === 'rgb(255, 255, 255)'));
  ok('カードに角丸が付く', cards.every(c => c.r >= 8));
  ok('タップ領域は44px以上のまま', cards.every(c => c.h >= 44));

  // ---- 隙間はわずかに空き、地色が見える ----
  const gaps = await p.evaluate(() => {
    const es = [...document.querySelectorAll('#view .list.cards > .swipe')];
    const out = [];
    for (let i = 1; i < es.length; i++) {
      out.push(Math.round(es[i].getBoundingClientRect().top - es[i - 1].getBoundingClientRect().bottom));
    }
    return out;
  });
  ok('カードの間が空いている', gaps.length > 0 && gaps.every(g => g > 0));
  ok('隙間はわずか(4px)', gaps.every(g => g === 4));
  // 隙間はカードの外側なので、透けて見えるのは一覧の親(.body=ページの地色)。
  // 一覧自体が背景を持っていると地色が出ないので、そこも合わせて見る
  ok('隙間からページの地色が透ける', await p.evaluate(() => {
    const list = document.querySelector('#view .list.cards');
    const app = getComputedStyle(document.documentElement).getPropertyValue('--app').trim();
    const toRgb = hex => 'rgb(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
    return getComputedStyle(list).backgroundColor === 'rgba(0, 0, 0, 0)'
        && getComputedStyle(document.querySelector('.body')).backgroundColor === toRgb(app);
  }));

  // ---- 中身と操作は変えない ----
  ok('メモ/注目のバッジは残る', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards .chip').length > 0));
  ok('右向きの矢尻は無いまま', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards .arrow').length === 0));
  await p.evaluate(() => document.querySelector('#view .list.cards .list-row').click());
  await p.waitForTimeout(300);
  ok('タップで編集シートが開く', await p.evaluate(() => document.querySelector('#scrim').classList.contains('show')));
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(250);
  ok('スワイプ削除のボタンは残る', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards .del-btn').length > 0));
  ok('削除ボタンはカードの角丸からはみ出さない', await p.evaluate(() =>
    [...document.querySelectorAll('#view .list.cards > .swipe')].every(e => getComputedStyle(e).overflow === 'hidden')));

  // ---- 角に削除ボタンの赤が透けない ----
  // 切り抜きの縁はアンチエイリアスされるので、角の内側に赤を置いたままだと
  // 数%が残って細い枠線に見える。角丸は「切り抜き」と「削除ボタン」の両方で合わせる
  const corner = await p.evaluate(() => {
    const sw = document.querySelector('#view .list.cards > .swipe');
    const row = sw.querySelector('.list-row'), del = sw.querySelector('.del-btn');
    const g = e => getComputedStyle(e);
    return { swipeR: parseFloat(g(sw).borderTopLeftRadius), rowR: parseFloat(g(row).borderTopLeftRadius),
             delTR: parseFloat(g(del).borderTopRightRadius), delBR: parseFloat(g(del).borderBottomRightRadius),
             delTL: parseFloat(g(del).borderTopLeftRadius) };
  });
  ok('行は四角いまま(全面を白で塗る)', corner.rowR === 0);
  ok('削除ボタンの左側は角丸にしない(行と接する辺)', corner.delTL === 0);
  // 削除ボタンの角丸を切り抜きと同じにすると曲線が重なり、縁のアンチエイリアスで
  // 赤が残る。切り抜きより大きくして曲線を内側へ逃がすのが条件
  ok('削除ボタンの角丸は切り抜きより大きい',
    corner.delTR > corner.swipeR && corner.delBR > corner.swipeR);

  // ---- ほかの一覧は今までどおり(束ねた白カード) ----
  await p.evaluate(() => go('reminder')); await p.waitForTimeout(350);
  const other = await p.evaluate(() => {
    const e = document.querySelector('#view .list:not(.cards):not(.flat)');
    if (!e) return null;
    const s = getComputedStyle(e);
    return { bw: parseFloat(s.borderTopWidth), bg: s.backgroundColor };
  });
  ok('ほかの一覧は外枠を残す', !!other && other.bw === 1);
  ok('ほかの一覧は白背景を残す', !!other && other.bg === 'rgb(255, 255, 255)');

  // ---- 実際に描かれた画素で、角に赤が残っていないことを確かめる ----
  // CSSの取り決めだけでは「見た目に赤が出ていない」ことは保証できないので、
  // カード右辺を拡大して撮り、赤み(r - max(g,b))を測る。
  // 白(255,255,255)や地色(247,248,249)は0以下、削除ボタンの赤(156,51,41)は大きく正になる
  const p2 = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 4 });
  await p2.goto('http://127.0.0.1:8731/index.html');
  await p2.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p2.reload(); await p2.waitForTimeout(400);
  await p2.evaluate(() => openStock('9001')); await p2.waitForTimeout(400);
  await p2.evaluate(() => { STATE.hypoAll = true; render(); }); await p2.waitForTimeout(250);
  await p2.evaluate(() => document.querySelector('#view .list.cards > .swipe').scrollIntoView({ block: 'center' }));
  await p2.waitForTimeout(400);
  const bx = await (await p2.$('#view .list.cards > .swipe')).boundingBox();
  const img = decodePng(await p2.screenshot({
    clip: { x: bx.x + bx.width - 30, y: bx.y - 3, width: 32, height: bx.height + 6 } }));
  let maxRed = -99, redPx = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const c = img.at(x, y), v = c.r - Math.max(c.g, c.b);
    if (v > maxRed) maxRed = v;
    if (v >= 3) redPx++;
  }
  ok('角の曲線に赤みのある画素が無い', redPx === 0);
  ok('最も赤い画素でも赤みが出ていない', maxRed <= 0);
  await p2.close();

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
