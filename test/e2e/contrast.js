// メリハリ強化(A1 タブのピル / B2 区分の区切り線と字下げ / C1 分析カテゴリも同じ表し方に揃える)
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

  // ---- A1. 選択中タブだけ地色が付く ----
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(300);
  const tabs = await p.evaluate(() => [...document.querySelectorAll('.tabbar button')].map(b => ({
    tab: b.dataset.tab, on: b.classList.contains('on'),
    bg: getComputedStyle(b).backgroundColor, radius: getComputedStyle(b).borderTopLeftRadius,
  })));
  const onTab = tabs.find(t => t.on), offTabs = tabs.filter(t => !t.on);
  ok('選択中のタブは1つだけ', tabs.filter(t => t.on).length === 1);
  ok('選択中タブに地色が付く', onTab && !isTransparent(onTab.bg));
  ok('非選択タブは地色なし', offTabs.every(t => isTransparent(t.bg)));
  ok('ピル型(角丸がある)', onTab && parseFloat(onTab.radius) >= 8);
  // タブを切り替えると地色も移動する
  await p.evaluate(() => go('reminder')); await p.waitForTimeout(300);
  const moved = await p.evaluate(() => {
    const on = [...document.querySelectorAll('.tabbar button')].find(b => b.classList.contains('on'));
    return { tab: on.dataset.tab, bg: getComputedStyle(on).backgroundColor };
  });
  ok('タブを切り替えると地色も移動する', moved.tab === 'reminder' && !isTransparent(moved.bg));

  // ---- B2. 区分の間の区切り線と、中身の字下げ ----
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(300);
  const heads = await p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')].map(e => parseFloat(getComputedStyle(e).borderTopWidth)));
  const indents = await p.evaluate(() => {
    const lbl = document.querySelector('#view .lbl.grp > span').getBoundingClientRect().left;
    return [...document.querySelectorAll('#view .list.flat .list-row .ttl')].map(t => Math.round(t.getBoundingClientRect().left - lbl));
  });
  ok('区分見出しが複数ある', heads.length >= 2);
  ok('区分の変わり目に細い線が入る', heads.every(w => w === 1));
  ok('中身は見出しより字下げされている', indents.length > 0 && indents.every(i => i >= 16));
  const align = await p.evaluate(() => {
    const lbl = document.querySelector('#view .lbl.grp');
    const list = document.querySelector('#view .list');
    return Math.abs(lbl.getBoundingClientRect().left - list.getBoundingClientRect().left) < 2;
  });
  ok('見出しとリストの外枠の左端は揃っている', align);

  // ---- C1. 詳細画面の分析カテゴリも、一覧の区分見出しと同じ表し方(区切り線＋字下げ) ----
  // 紺地に白抜きしていた頃の名残(白カード・枠線・背景色)が残っていないことを見る
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id));
  await p.waitForTimeout(300);
  const catHeads = await p.evaluate(() => [...document.querySelectorAll('#view .sec .h')].map(h => {
    const st = getComputedStyle(h);
    return { bg: st.backgroundColor, color: st.color, borderTop: parseFloat(st.borderTopWidth),
             radius: parseFloat(st.borderTopLeftRadius), h: Math.round(h.getBoundingClientRect().height) };
  }));
  ok('分析カテゴリが複数ある', catHeads.length >= 2);
  ok('カテゴリ見出しに白カードの地色が付いていない', catHeads.every(c => isTransparent(c.bg)));
  ok('カテゴリ見出しは角丸を持たない', catHeads.every(c => c.radius === 0));
  ok('カテゴリの変わり目に細い線が入る', catHeads.every(c => c.borderTop === 1));
  ok('カテゴリ見出しのタップ領域は44px以上', catHeads.every(c => c.h >= 44));

  await p.evaluate(() => document.querySelector('#view .sec').classList.add('open'));
  await p.waitForTimeout(250);
  const openStyle = await p.evaluate(() => {
    const sec = document.querySelector('#view .sec.open');
    const h = sec.querySelector('.h');
    const st = getComputedStyle(h);
    const row = sec.querySelector('.sub-row .name');
    return {
      bg: st.backgroundColor, color: st.color,
      indent: Math.round(row.getBoundingClientRect().left - h.getBoundingClientRect().left),
    };
  });
  ok('開いても背景は付かない', isTransparent(openStyle.bg));
  ok('開いても文字色は変わらない(白抜きにしない)', openStyle.color === catHeads[0].color);
  ok('開いた中身は見出しより字下げされている', openStyle.indent >= 16);
  // 一覧側(.lbl.grp)と見た目の作りが揃っている
  // getComputedStyle は生きた参照なので、画面を切り替える前に文字列として取り出しておく
  const sameAsList = await p.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#view .sec .h'));
    const sec = { fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, borderTopWidth: s.borderTopWidth };
    const secIndent = Math.round(document.querySelector('#view .sec.open .sub-row .name').getBoundingClientRect().left
                               - document.querySelector('#view .sec.open .h').getBoundingClientRect().left);
    backFromDetail(); go('analysis');
    const grpEl = [...document.querySelectorAll('#view .lbl.grp')].find(g => g.nextElementSibling && g.nextElementSibling.querySelector('.list-row'));
    const grp = getComputedStyle(grpEl);
    const grpIndent = Math.round(grpEl.nextElementSibling.querySelector('.ttl').getBoundingClientRect().left - grpEl.getBoundingClientRect().left);
    return { size: sec.fontSize === grp.fontSize, weight: sec.fontWeight === grp.fontWeight,
             color: sec.color === grp.color, line: sec.borderTopWidth === grp.borderTopWidth, indent: secIndent === grpIndent };
  });
  ok('一覧の区分見出しと文字の大きさが揃っている', sameAsList.size);
  ok('一覧の区分見出しと文字の太さが揃っている', sameAsList.weight);
  ok('一覧の区分見出しと文字色が揃っている', sameAsList.color);
  ok('一覧の区分見出しと区切り線が揃っている', sameAsList.line);
  ok('一覧と字下げ幅が揃っている', sameAsList.indent);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
