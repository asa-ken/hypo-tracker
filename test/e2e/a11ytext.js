// 読ませる前提の文字と、押せる要素の文字は、地色に対して WCAG AA(4.5:1)を満たすこと
//
// --ink3(#8b95a1)はどの地色でも 2.54〜3.04:1 しかなく、AAにもAA-large(3:1)にも届かない。
// 全部を一度に直すとトークン定義の変更になり、--ink2 との明度差が無くなって
// 文字色の3段階(ink / ink2 / ink3)が2段階に潰れる。そこはユーザー確認に回した。
//
// このスイートが守るのは、その中でも譲れない2つ。
//  ・案内文(.hint) … 読ませるために置いている文。読めなければ置く意味がない
//  ・押せる要素の文字 … 操作できるものが読めないのはアクセシビリティの重大問題
// 補助情報(.meta / .arrow)は現時点では対象外。REVIEW_BACKLOG.md に残してある。
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

// WCAG 2.1 の相対輝度とコントラスト比
const lum = (r, g, b) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const L1 = lum(...a), L2 = lum(...b); const [x, y] = L1 > L2 ? [L1, L2] : [L2, L1]; return (x + 0.05) / (y + 0.05); };
const rgb = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  // 案内文が出る状態を作る。期限切れ・今日とも複数銘柄にまたがると
  // 「チャットを対象ごとに分けている場合は〜」の .hint が地色付きカードの上に出る
  await p.evaluate(() => {
    const t = fmtToday();
    const mk = (id, sid, ti, f) => ({ id, stockId: sid, hypoIds: [], title: ti, comment: null,
      cat: '決算プレビュー', freq: f, times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: 'p', src: 'テスト', srcDate: t, log: [], nextFire: null });
    DB.reminders.push(mk('a1', '9001', '期限切れA', '単発 2020/1/1'));
    DB.reminders.push(mk('a2', '9002', '期限切れB', '単発 2020/1/2'));
    DB.reminders.push(mk('a3', '9001', '本日A', '単発 ' + t));
    DB.reminders.push(mk('a4', 'TSTC', '本日B', '単発 ' + t));
    save();
  });

  // 画面ごとに、対象の文字とその実効背景色を集める
  const collect = (screen) => p.evaluate(s => {
    go(s);
    const out = [];
    document.querySelectorAll('#view *').forEach(e => {
      if (e.children.length || !e.textContent.trim()) return;
      const isHint = e.classList.contains('hint');
      // 「操作のラベル」= button の中の文字。押せる行の中にある補助情報(.meta など)は含めない。
      // .meta は読まなくても操作できる添え物で、こちらは --ink3 の定義そのものの話になるため
      // このスイートの対象から外し、REVIEW_BACKLOG.md に残してある
      const isLabel = !!e.closest('button');
      if (!isHint && !isLabel) return;
      const st = getComputedStyle(e);
      let bg = 'rgba(0, 0, 0, 0)', n = e;
      while (n && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
      out.push({ kind: isHint ? '案内文' : '押せる要素', screen: s, cls: e.className || e.tagName,
        fg: st.color, bg, size: parseFloat(st.fontSize), weight: +st.fontWeight,
        text: e.textContent.trim().slice(0, 16) });
    });
    return out;
  }, screen);

  let all = [];
  for (const s of ['home', 'analysis', 'import', 'reminder']) { all = all.concat(await collect(s)); await p.waitForTimeout(250); }

  // 記号だけの装飾(矢尻など)は文字として読ませるものではないので、判定から外す
  const target = all.filter(x => !/^[›»▾▸\s]*$/.test(x.text));
  const judged = target.map(x => {
    const r = ratio(rgb(x.fg), rgb(x.bg));
    // WCAG: 18pt(24px)以上、または14pt(18.66px)以上のboldは「大きい文字」で3:1
    const large = x.size >= 24 || (x.size >= 18.66 && x.weight >= 700);
    return { ...x, r, need: large ? 3 : 4.5 };
  });
  const ng = judged.filter(x => x.r < x.need)
    .map(x => `${x.r.toFixed(2)}:1 [${x.size}px/${x.weight}] ${x.kind} ${x.cls} "${x.text}" ${x.screen}`);

  ok('検査対象の文字が集まっている(テスト前提)', judged.length >= 10, judged.length);
  ok('案内文が検査対象に含まれている(テスト前提)', judged.some(x => x.kind === '案内文'), judged.filter(x => x.kind === '案内文').length);
  ok('押せる要素の文字が検査対象に含まれている(テスト前提)', judged.some(x => x.kind === '押せる要素'));
  ok('案内文と押せる要素の文字がWCAG AAを満たす', ng.length === 0, ng);

  // 地色付きカード(期限切れの赤地・今日の紺地)の上でも満たすこと。
  // 白地では通っても、色地の上で落ちることがある
  const onTint = judged.filter(x => x.bg !== 'rgb(255, 255, 255)' && x.bg !== 'rgb(247, 248, 249)');
  ok('地色付きの上にある文字も検査できている(テスト前提)', onTint.length > 0, onTint.length);
  ok('地色付きカードの上でもWCAG AAを満たす', onTint.every(x => x.r >= x.need),
    onTint.filter(x => x.r < x.need).map(x => `${x.r.toFixed(2)}:1 ${x.cls} on ${x.bg}`));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
