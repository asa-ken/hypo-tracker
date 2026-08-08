// 銘柄一覧を地色に沈める / バックアップの歯車絵文字を線画アイコンに置き換える
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

  // ---- 1. 銘柄一覧が地色に沈む(白カード・枠線・区切り線なし) ----
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(300);
  const list = await p.evaluate(() => {
    const l = document.querySelector('#view .list.flat');
    const st = getComputedStyle(l);
    const row = l.querySelector('.list-row');
    const rst = getComputedStyle(row);
    return { bg: st.backgroundColor, border: st.borderTopWidth, radius: parseFloat(st.borderTopLeftRadius),
             rowBorder: rst.borderTopWidth, rowBg: rst.backgroundColor, rowPadLeft: parseFloat(rst.paddingLeft),
             rowH: Math.round(row.getBoundingClientRect().height) };
  });
  ok('一覧に白背景がない', isTransparent(list.bg));
  ok('一覧の外枠線がない', parseFloat(list.border) === 0);
  ok('一覧の角丸もない', list.radius === 0);
  ok('行の区切り線もない', parseFloat(list.rowBorder) === 0);
  ok('行に白背景がない', isTransparent(list.rowBg));
  ok('行は字下げされている(見出しの下にぶら下がって見える)', list.rowPadLeft >= 16);
  ok('行のタップ領域は44px以上のまま', list.rowH >= 44);

  // 詳細画面の小項目と同じ扱いになっている
  // 詳細画面の小項目と同じ扱い(地色のまま・字下げ)になっているか
  const same = await p.evaluate(() => {
    const anaIndent = Math.round(document.querySelector('#view .list.flat .list-row .ttl').getBoundingClientRect().left
      - document.querySelector('#view .lbl.grp > span').getBoundingClientRect().left);
    openStock(DB.stocks.find(s => s.name === 'テスト精機').id);
    document.querySelector('#view .sec').classList.add('open');
    const sec = document.querySelector('#view .sec.open');
    const subRow = sec.querySelector('.sub-row');
    // 見た目の字下げは「見出しの文字」からの距離。
    // .sec は枠線とpaddingを持つので、箱の左端で測ると実際より大きく出る
    const subIndent = Math.round(subRow.querySelector('.name').getBoundingClientRect().left
      - sec.querySelector('.h > span').getBoundingClientRect().left);
    return { anaIndent, subIndent, subBg: getComputedStyle(subRow).backgroundColor };
  });
  await p.waitForTimeout(200);
  ok('一覧と小項目の字下げ量が揃っている', Math.abs(same.anaIndent - same.subIndent) <= 2);
  ok('小項目も地色のまま(扱いが揃っている)', isTransparent(same.subBg));

  // バーの左端が、区分見出しの文字の左端と揃う
  await p.evaluate(() => { backFromDetail(); go('analysis'); }); await p.waitForTimeout(300);
  ok('行は見出しより右に字下げされている', await p.evaluate(() => {
    const lbl = document.querySelector('#view .lbl.grp').getBoundingClientRect().left;
    const lt = document.querySelector('#view .list.flat .list-row .lt').getBoundingClientRect().left;
    return lt - lbl >= 16;
  }));

  // ---- 2. バックアップが線画アイコンになった ----
  await p.evaluate(() => go('home')); await p.waitForTimeout(300);
  const act = await p.evaluate(() => {
    const a = document.querySelector('#topAct');
    const svg = a.querySelector('svg');
    return { text: a.textContent.trim(), hasSvg: !!svg, display: getComputedStyle(a).display,
             gap: getComputedStyle(a).gap, h: Math.round(a.getBoundingClientRect().height),
             svgW: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
             stroke: svg ? svg.getAttribute('stroke') : null };
  });
  ok('歯車の絵文字は使っていない', !/⚙/.test(act.text));
  ok('線画のSVGアイコンになっている', act.hasSvg && act.stroke === 'currentColor');
  ok('文字は「バックアップ」のまま', act.text === 'バックアップ');
  ok('アイコンと文字が横並び(flex)になる', /flex/.test(act.display));
  ok('アイコンと文字の間隔が効いている', parseFloat(act.gap) > 0);
  ok('タップ領域は44px以上', act.h >= 44);

  // 他の画面のヘッダーも壊れていない(display変更の影響確認)
  const others = await p.evaluate(() => {
    const out = [];
    ['analysis', 'reminder'].forEach(t => { go(t);
      const a = document.querySelector('#topAct'); const r = a.getBoundingClientRect();
      out.push({ tab: t, text: a.textContent.trim(), h: Math.round(r.height), right: Math.round(r.right), svg: !!a.querySelector('svg') }); });
    openStock(DB.stocks[0].id);
    const a = document.querySelector('#topAct'); const r = a.getBoundingClientRect();
    out.push({ tab: 'detail', text: a.textContent.trim(), h: Math.round(r.height), right: Math.round(r.right), svg: !!a.querySelector('svg') });
    return out;
  });
  await p.waitForTimeout(200);
  ok('他画面のヘッダーは文字のまま(SVGが残らない)', others.every(o => !o.svg));
  ok('他画面のヘッダーも44px以上', others.every(o => o.h >= 44));
  ok('他画面の文言も従来どおり', others.map(o => o.text).join('|') === '＋ 追加|＋ 登録|← 戻る');

  // バックアップシートは従来どおり開く
  await p.evaluate(() => { backFromDetail(); go('home'); document.querySelector('#topAct').click(); });
  await p.waitForTimeout(250);
  ok('タップでバックアップシートが開く', await p.evaluate(() => /データを書き出す/.test(document.querySelector('#sheet').innerText)));

  // ---- 区分見出しに開閉の矢尻がある画面では、行の右端に「›」を並べない ----
  // 矢印が二重に並ぶと画面がうるさくなる。行が押せることは区分の見出しと並びで伝わる
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(350);
  ok('銘柄の行に右向きの矢尻を出さない', await p.evaluate(() =>
    document.querySelectorAll('#view .list.flat .list-row .arrow').length === 0));
  ok('市場カードの行にも出さない', await p.evaluate(() =>
    ![...document.querySelectorAll('#view .list.flat .list-row')].some(r => /›/.test(r.textContent))));
  ok('区分見出しの開閉の矢尻は残る', await p.evaluate(() =>
    document.querySelectorAll('#view .lbl.grp svg.caret').length >= 2));
  ok('メモ・注目の件数バッジは残る', await p.evaluate(() =>
    [...document.querySelectorAll('#view .list.flat .list-row')].some(r => /メモ・注目 \d+/.test(r.textContent))));
  ok('市場・業界・テーマの種別チップも残る', await p.evaluate(() =>
    [...document.querySelectorAll('#view .list.flat .list-row')].some(r => r.querySelector('.chip.gray'))));
  ok('行はこれまでどおり押せる', await p.evaluate(() => {
    document.querySelector('#view .list.flat .list-row').click();
    return !!STATE.stockId;
  }));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
