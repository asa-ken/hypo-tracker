// 取り込みの確認テーブル(#parseOut)の1列目固定。
//
// 3周目レビュー(2026-08-22)で発見: この表は3列(項目/更新前/更新後)で560px必要だが、
// 表示枠(.xscroll)は358pxしかなく、**全20行の「更新後」列が186pxはみ出していた**。
// 区分名は「読み込み内容を確認してください」なのに、確認すべき更新後の値が初期表示で
// 1行も読めない状態だった。横スクロールはできるが、スクロールすると今度は
// 「どの項目の行を見ているのか」が分からなくなる。
//
// 対策(ユーザー選択A案): 銘柄詳細の業績推移テーブル(2026-08-20(4))と同じ position:sticky で
// 1列目を固定する。更新前+更新後で444px要るため横スクロール自体は残るが、
// スクロール中も項目名が見えることで「何の値か」を見失わなくなる。
const { chromium } = require('playwright');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

// 既存指標の更新(PER(予想))・新規指標(受注残高)・該当セクション不明の行を同時に作る
const MD = `# 銘柄: テスト精機 (9001)
## 指標
- PER(予想): 14.2 | 単位:倍 | 基準日 2026/8/20
- 受注残高: 1200 | 単位:百万円 | 基準日 2026/8/20
## 分析
- 謎のカテゴリ(サマリ): 該当なしのテスト | 基準日 2026/8/20`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => go('import')); await p.waitForTimeout(250);
  await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, MD);
  await p.waitForTimeout(500);

  const info = () => p.evaluate(() => {
    const wrap = document.querySelector('#parseOut .xscroll');
    const t = wrap.querySelector('table.diffpv');
    if (!t) return null;
    const rows = [...t.querySelectorAll('tr')];
    const left = r => Math.round(r.children[0].getBoundingClientRect().left);
    const bg = r => getComputedStyle(r.children[0]).backgroundColor;
    const normal = rows.find(r => !r.className);
    const nw = rows.find(r => r.classList.contains('newrow'));
    const orphan = rows.find(r => r.classList.contains('orphanrow'));
    return {
      scrollLeft: Math.round(wrap.scrollLeft),
      枠の左端: Math.round(wrap.getBoundingClientRect().left),
      見出し1列目の左端: left(rows[0]),
      通常行1列目の左端: normal ? left(normal) : null,
      新規行1列目の左端: nw ? left(nw) : null,
      通常行1列目の背景: normal ? bg(normal) : null,
      新規行1列目の背景: nw ? bg(nw) : null,
      該当不明行1列目の背景: orphan ? bg(orphan) : null,
      position: getComputedStyle(rows[0].children[0]).position,
      更新後セルの右端: Math.round(rows[1].lastElementChild.getBoundingClientRect().right),
      画面幅: window.innerWidth,
      横スクロールできるか: wrap.scrollWidth > wrap.clientWidth,
    };
  });

  const a = await info();
  ok('確認テーブルに .diffpv が付いている', !!a, a);
  ok('1列目が position:sticky になっている', a.position === 'sticky', a);
  ok('横スクロールが発生する(3列が画面幅に収まらない)', a.横スクロールできるか, a);
  // 対策前はここで「更新後」が画面外だった
  ok('横スクロール前は更新後セルが画面外にはみ出している(対策の前提)', a.更新後セルの右端 > a.画面幅, a);

  await p.evaluate(() => { document.querySelector('#parseOut .xscroll').scrollLeft = 999; });
  await p.waitForTimeout(400);
  const c = await info();

  ok('横スクロールが実際に起きた', c.scrollLeft > 0, c);
  ok('横スクロールしても1列目(項目名)は枠の左端に留まる', c.通常行1列目の左端 === c.枠の左端, c);
  ok('見出しの1列目も同じく留まる', c.見出し1列目の左端 === c.枠の左端, c);
  ok('横スクロール後は更新後セルが画面内に入る', c.更新後セルの右端 <= c.画面幅, c);
  // 固定セルの背景指定が行の色を消してしまわないこと
  ok('新規行の地色(緑)は固定した1列目にも続く', c.新規行1列目の背景 === 'rgb(229, 241, 223)', c);
  ok('該当セクション不明行の地色(赤)も固定した1列目に続く', c.該当不明行1列目の背景 === 'rgb(251, 230, 228)', c);
  // 透過すると横スクロール中に他セルの文字が透ける
  ok('通常行の固定セルは透過していない(地色を敷いている)',
    c.通常行1列目の背景 === 'rgb(247, 248, 249)', c);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
