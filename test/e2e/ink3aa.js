// 補助文字(--ink3)が、どの地色の上でも WCAG AA(4.5:1)を満たすこと
//
// --ink3 は以前 #8b95a1 で、ページの地色 2.86:1 / 白 3.04:1 / グレーの面 2.66:1 と基準に届かなかった
// (index.html の33か所、全画面・全シートで約290個の文字に使われていた。2026-09-28実測)。
// 基準を満たすよう同じ色味で濃くすると --ink2 とほぼ同じ濃さになる(#676e77、ink2との比1.14)ため、
// 文字色の3段階を2段階にしてよいかをユーザーに確認し、比較画像を見たうえで
// 「統一しましょう」(2026-09-30)となった。--ink3 を --ink2 と同じ色にする。
// トークン名は残す(「補助の文字」という用途の名前として。戻すときは値を1か所変えるだけで済む)
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const rd = fs.readFileSync(__dirname + '/fixtures/realdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

// WCAG 2.1 の相対輝度とコントラスト比
const lum = (r, g, b) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const L1 = lum(...a), L2 = lum(...b); const [x, y] = L1 > L2 ? [L1, L2] : [L2, L1]; return (x + 0.05) / (y + 0.05); };
const rgb = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install({ time: new Date('2026-08-22T03:00:00Z') });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), rd);
  await p.reload(); await p.waitForTimeout(500);

  // ---- 1. トークンの値 ----
  const tok = await p.evaluate(() => { const cs = getComputedStyle(document.documentElement);
    return ['--ink2', '--ink3', '--app', '--card', '--bg'].reduce((o, k) => (o[k] = cs.getPropertyValue(k).trim().toLowerCase(), o), {}); });
  ok('--ink3 は --ink2 と同じ色', tok['--ink3'] === tok['--ink2'], tok);
  for (const bg of ['--app', '--card', '--bg']) {
    const r = +ratio(hex(tok['--ink3']), hex(tok[bg])).toFixed(2);
    ok(`--ink3 は ${bg}(${tok[bg]})の上で4.5:1以上`, r >= 4.5, r);
  }

  // ---- 2. 実画面で --ink3 を使っている文字が、実効背景の上で4.5:1以上 ----
  // 見るのは主要4画面・銘柄詳細(中身あり/まだ空)・市場詳細。区分は開いた状態にする
  const scenes = [
    ['ホーム', "go('home')"], ['市場・銘柄分析', "go('analysis')"],
    ['銘柄詳細', "go('analysis'); openStock('6151')"], ['まだ空の銘柄', "go('analysis'); openStock('4062')"],
    ['市場詳細', "go('analysis'); openStock(DB.stocks.find(s=>s.kind==='市場').id)"],
    ['取り込み', "go('import')"], ['リマインダー', "go('reminder')"],
  ];
  const ink3 = 'rgb(' + hex(tok['--ink3']).join(', ') + ')';
  const low = [];
  let checked = 0;
  for (const [name, code] of scenes) {
    const got = await p.evaluate(([code, ink3]) => {
      eval(code);
      document.querySelectorAll('#view .sec').forEach(s => s.classList.add('open'));
      const out = [];
      for (const el of document.querySelectorAll('#view *')) {
        const cs = getComputedStyle(el);
        if (cs.color !== ink3 || cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        let bg = 'rgba(0, 0, 0, 0)', n = el;
        while (n && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
        out.push({ fg: cs.color, bg, text: el.textContent.trim().slice(0, 14) });
      }
      return out;
    }, [code, ink3]);
    await p.waitForTimeout(250);
    checked += got.length;
    got.forEach(g => { const r = ratio(rgb(g.fg), rgb(g.bg)); if (r < 4.5) low.push({ 画面: name, text: g.text, bg: g.bg, 比: +r.toFixed(2) }); });
  }
  ok('検査対象の補助文字が十分ある(実運用データで100個以上)', checked >= 100, checked);
  ok('補助文字はどれも実効背景の上で4.5:1以上', low.length === 0, low.slice(0, 8));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
