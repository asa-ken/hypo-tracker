// アクセントバーの位置 / 展開UIの矢尻統一 / 分析カテゴリの「n/m 項目」削除
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  // ---- 1. 中身は字下げで表す(アクセントバーは使わない) ----
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(300);
  const bar = await p.evaluate(() => {
    const lt = document.querySelector('#view .list.flat .list-row .lt');
    const st = getComputedStyle(lt, '::before');
    return { barContent: st.content, barW: parseFloat(st.width || 0),
             textLeft: Math.round(lt.querySelector('.ttl').getBoundingClientRect().left),
             lblLeft: Math.round(document.querySelector('#view .lbl.grp > span').getBoundingClientRect().left) };
  });
  ok('行にアクセントバーは無い', bar.barContent === 'none' || bar.barW === 0);
  ok('行の文字は画面端から十分内側にある', bar.textLeft >= 12);
  ok('行は見出しの文字より字下げされている', bar.textLeft - bar.lblLeft >= 16);

  // ---- 2. 展開UIの矢尻が統一されている ----
  const sameIcon = (sel) => p.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    const svg = el.querySelector('svg.caret');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { d: svg.querySelector('path').getAttribute('d'), w: Math.round(r.width), rot: getComputedStyle(svg).transform };
  }, sel);
  const grpCaret = await sameIcon('#view .lbl.grp');
  ok('一覧の区分見出しに矢尻がある', !!grpCaret);

  // 分析の大カテゴリは、区分見出しの矢尻とは別の記号(閉=＋ / 開=×)にする。
  // 区分の「中身」であって、開く方向を示す場所ではないため
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id)); await p.waitForTimeout(300);
  const secMark = await p.evaluate(() => {
    const svg = document.querySelector('#view .sec .h svg');
    const r = svg.getBoundingClientRect();
    return { cls: svg.getAttribute('class'), d: svg.querySelector('path').getAttribute('d'),
             w: Math.round(r.width), rot: getComputedStyle(svg).transform };
  });
  ok('分析カテゴリには矢尻を使わない', secMark.cls === 'plusmark');
  ok('形も一覧の区分見出しとは別物', secMark.d !== grpCaret.d);
  ok('大きさは矢尻と同じに揃える', secMark.w === grpCaret.w);
  ok('閉じているときは＋(無回転)', secMark.rot === 'none' || /matrix\(1, 0, 0, 1/.test(secMark.rot));
  await p.evaluate(() => document.querySelector('#view .sec').classList.add('open')); await p.waitForTimeout(500);
  const secOpen = await p.evaluate(() => {
    const svg = document.querySelector('#view .sec.open .h svg');
    return { rot: getComputedStyle(svg).transform, color: getComputedStyle(svg).color,
             bg: getComputedStyle(document.querySelector('#view .sec.open .h')).backgroundColor };
  });
  // 45°回すと＋が×になる。行列から回転角を出して確かめる
  const deg = (() => { const m = secOpen.rot.match(/matrix\(([-\d.]+), ([-\d.]+)/);
    return m ? Math.round(Math.atan2(+m[2], +m[1]) * 180 / Math.PI) : null; })();
  ok('開くと45度回って×になる', deg === 45);
  ok('開いた見出しに背景色は付かない', secOpen.bg === 'rgba(0, 0, 0, 0)' || secOpen.bg === 'transparent');
  ok('開いている印として色も濃くする', /^rgb\(1[0-9], 5[0-9], 9[0-9]\)$/.test(secOpen.color));

  // 取り込み画面の展開エリアも同じ矢尻(「開閉」というテキストは廃止)
  await p.evaluate(() => go("import")); await p.waitForTimeout(300);
  const importSecs = await p.evaluate(() => {
    const secs = [...document.querySelectorAll('#view .sec')];
    return {
      count: secs.length,
      allHaveCaret: secs.every(s => !!s.querySelector('.h svg.caret')),
      ds: secs.map(s => s.querySelector('.h svg.caret path').getAttribute('d')),
      text: document.querySelector('#view').innerText,
    };
  });
  ok('取り込み画面に展開エリアが複数ある', importSecs.count >= 2);
  ok('すべてに矢尻が付く', importSecs.allHaveCaret);
  ok('取り込み画面の矢尻も同じ形', importSecs.ds.every(d => d === grpCaret.d));
  ok('「開閉」というテキスト表記は無くなった', !/開閉/.test(importSecs.text));

  // ---- 3. 分析カテゴリの「n/m 項目」は出さない(バッジで足りる) ----
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id)); await p.waitForTimeout(300);
  const secs = await p.evaluate(() => {
    const hs = [...document.querySelectorAll('#view .sec .h')];
    return {
      texts: hs.map(h => h.textContent.trim()),
      badges: hs.filter(h => h.querySelector('.chip.navy')).map(h => h.querySelector('.chip.navy').textContent.trim()),
      filled: DB.sectionMaster.filter(c => c.on).map(c => c.subs.filter(su => stock(STATE.stockId).sections[su]).length).filter(n => n > 0),
    };
  });
  ok('カテゴリ見出しに「項目」の文字が出ない', secs.texts.length > 0 && secs.texts.every(t => !/項目/.test(t)));
  ok('分母(n/m)も出ない', secs.texts.every(t => !/\d+\/\d+/.test(t)));
  ok('入力済み件数のバッジは残り、値が正しい', JSON.stringify(secs.badges.map(Number)) === JSON.stringify(secs.filled));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
