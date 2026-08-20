// 2周目レビュー(2026-08-20)で発見: .d-del(取り消し線、業績推移の「更新前」セルで変更前の
// 実数値に使われる)がWCAG AA(4.5:1)未達の低コントラストだった(--ink3、実測2.86:1)。
// --ink2に変更後、実測でAA基準を満たすことを確認する。
const { chromium } = require('playwright');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

function luminance([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(rgb1, rgb2) {
  const l1 = luminance(rgb1), l2 = luminance(rgb2);
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}
function parseRgb(s) {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  await p.evaluate(() => go('import'));
  await p.waitForTimeout(250);
  const MD = '# 銘柄: テスト精機 (9001)\n## 業績推移\n- 売上高: 27年3月期(予)=999999 | 単位:百万円';
  await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, MD);
  await p.waitForTimeout(400);

  const measured = await p.evaluate(() => {
    const el = document.querySelector('.d-del');
    if (!el) return null;
    const st = getComputedStyle(el);
    let bgEl = el; let bg = 'rgba(0, 0, 0, 0)';
    while (bgEl && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
      bg = getComputedStyle(bgEl).backgroundColor;
      bgEl = bgEl.parentElement;
    }
    return { color: st.color, bg, textDecoration: st.textDecorationLine };
  });
  ok('.d-delが見つかる', !!measured, measured);
  if (measured) {
    const ratio = contrast(parseRgb(measured.color), parseRgb(measured.bg));
    ok('.d-delのコントラスト比がWCAG AA(4.5:1)を満たす', ratio >= 4.5, { ratio: ratio.toFixed(2), ...measured });
    ok('取り消し線は維持されている(色だけでなく装飾でも区別する)', measured.textDecoration === 'line-through', measured.textDecoration);
  }

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
