// 分析の小項目と大カテゴリ: カードで囲わず、区切り線＋字下げで表す(一覧の区分見出しと同じ作り)
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
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
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id));
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#view .sec').classList.add('open'));
  await p.waitForTimeout(250);

  // ---- 小項目は白カードでも枠線でもない ----
  const row = await p.evaluate(() => {
    const r = document.querySelector('#view .sec.open .sub-row');
    const st = getComputedStyle(r);
    return { bg: st.backgroundColor, borderTop: st.borderTopWidth, h: Math.round(r.getBoundingClientRect().height) };
  });
  ok('小項目に白背景がない(地色に沈む)', isTransparent(row.bg));
  ok('小項目の区切り線がない', parseFloat(row.borderTop) === 0);
  ok('小項目のタップ領域は44px以上のまま', row.h >= 44);

  // ---- 項目名は字下げ。取り込み済みは濃く、まだ空は薄く細く ----
  const names = await p.evaluate(() => {
    const head = document.querySelector('#view .sec.open .h > span').getBoundingClientRect().left;
    return [...document.querySelectorAll('#view .sec.open .sub-row')].map(r => {
      const n = r.querySelector('.name'); const st = getComputedStyle(n);
      return { filled: r.classList.contains('filled'), bar: getComputedStyle(n, '::before').content,
               weight: +st.fontWeight, color: st.color,
               indent: Math.round(n.getBoundingClientRect().left - head) };
    });
  });
  ok('小項目にアクセントバーは無い', names.length > 0 && names.every(x => x.bar === 'none'));
  ok('小項目は見出しより字下げされている', names.every(x => x.indent >= 16));
  const filledBars = names.filter(x => x.filled), emptyBars = names.filter(x => !x.filled);
  ok('取り込み済みと未取得が両方ある(テスト前提)', filledBars.length > 0 && emptyBars.length > 0);
  ok('取り込み済みは濃く太い', filledBars.every(x => x.weight >= 600));
  ok('未取得は薄く細くて区別できる', emptyBars.every(x => x.weight < 600 && x.color !== filledBars[0].color));
  ok('filledは実データと一致する', await p.evaluate(() => {
    const s = stock(STATE.stockId);
    const cat = masterFor(s).filter(c => c.on)[0];
    const rows = [...document.querySelectorAll('#view .sec.open .sub-row')];
    return rows.every((r, i) => r.classList.contains('filled') === !!s.sections[cat.subs[i]]);
  }));

  // ---- 大項目もカードで囲わない(一覧の区分見出しと同じ、区切り線＋字下げ) ----
  const secs = await p.evaluate(() => {
    const open = document.querySelector('#view .sec.open');
    const closed = document.querySelector('#view .sec:not(.open)');
    const st = el => { const s = getComputedStyle(el); return { bg: s.backgroundColor, border: s.borderTopWidth, radius: parseFloat(s.borderTopLeftRadius) }; };
    return {
      open: st(open), openHead: st(open.querySelector('.h')),
      closed: st(closed), closedHead: st(closed.querySelector('.h')),
    };
  });
  ok('開いた大項目に外枠も背景もない', secs.open.border === '0px' && isTransparent(secs.open.bg));
  ok('閉じた大項目にも外枠も背景もない', secs.closed.border === '0px' && isTransparent(secs.closed.bg));
  ok('見出しは白カードにならない', isTransparent(secs.openHead.bg) && isTransparent(secs.closedHead.bg));
  ok('見出しは角丸を持たない', secs.openHead.radius === 0 && secs.closedHead.radius === 0);
  ok('見出しの上に区切り線が1本入る', parseFloat(secs.openHead.border) === 1 && parseFloat(secs.closedHead.border) === 1);

  // ---- 開いた塊と次の大項目の間に間隔がある(地続きに見えない) ----
  const gap = await p.evaluate(() => {
    const open = document.querySelector('#view .sec.open');
    const rows = [...open.querySelectorAll('.sub-row')];
    const nextHead = open.nextElementSibling.querySelector('.h');
    return Math.round(nextHead.getBoundingClientRect().top - rows[rows.length - 1].getBoundingClientRect().bottom);
  });
  ok('最後の小項目と次の大項目の間が空く', gap >= 8);

  // ---- タップは従来どおり分析項目シートを開く ----
  await p.evaluate(() => document.querySelector('#view .sec.open .sub-row').click());
  await p.waitForTimeout(250);
  ok('小項目タップでシートが開く', await p.evaluate(() => document.querySelector('#scrim').classList.contains('show')));

  // ---- 大カテゴリに開閉の記号があるので、小項目の右端に「›」は並べない ----
  await p.evaluate(() => { backFromDetail(); openStock(DB.stocks.find(s => s.name === 'テスト精機').id); });
  await p.waitForTimeout(350);
  await p.evaluate(() => document.querySelector('#view .sec').classList.add('open'));
  await p.waitForTimeout(300);
  ok('小項目に右向きの矢尻を出さない', await p.evaluate(() =>
    document.querySelectorAll('#view .sub-row .arrow').length === 0));
  ok('「›」の文字も残っていない', await p.evaluate(() =>
    ![...document.querySelectorAll('#view .sub-row')].some(r => /›/.test(r.textContent))));
  ok('取り込んだ日付は残る', await p.evaluate(() =>
    [...document.querySelectorAll('#view .sub-row.filled .m')].some(e => /\d+\/\d+/.test(e.textContent))));
  ok('詳細のバッジも残る', await p.evaluate(() =>
    [...document.querySelectorAll('#view .sub-row')].some(r => /詳細\d/.test(r.textContent))));
  ok('大カテゴリの開閉の記号は残る', await p.evaluate(() =>
    document.querySelectorAll('#view .sec .h svg.plusmark').length > 0));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
