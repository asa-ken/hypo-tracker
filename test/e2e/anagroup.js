// 銘柄トップ(市場・銘柄分析)の区分を開閉できること
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
  const go = () => p.evaluate(() => window.go('analysis'));
  const state = () => p.evaluate(() => ({
    heads: [...document.querySelectorAll('#view .lbl.grp')].map(e => e.textContent.trim().replace(/[▾\s]+$/, '')),
    lists: document.querySelectorAll('#view .list').length,
    rows: document.querySelectorAll('#view .list-row').length,
    h: (() => { const v = document.querySelector('#view'), c = v.lastElementChild;
          return c ? Math.round(c.offsetTop + c.offsetHeight - v.offsetTop) : 0; })(),
    closed: DB.uiPrefs.anaClosed.slice(),
  }));

  // 件数が多い状態を作る(そもそも畳みたくなるのは件数が増えたとき)
  await p.evaluate(() => {
    for (let i = 0; i < 20; i++) DB.stocks.push({ id: 'x' + i, name: '増量銘柄' + i, code: '' + (7000 + i), kind: i % 2 ? '保有' : 'ウォッチ', metrics: {}, trend: {}, sections: {}, links: [] });
    save();
  });
  await go(); await p.waitForTimeout(300);
  const s0 = await state();
  ok('件数が多いと一画面に収まらない', s0.h > 844);
  ok('3区分すべてに開閉見出しがある', s0.heads.length === 3);
  ok('区分は市場・保有・ウォッチ', /市場・業界・テーマ/.test(s0.heads[0]) && /保有/.test(s0.heads[1]) && /ウォッチ/.test(s0.heads[2]));
  ok('既定は全部開いている', s0.closed.length === 0 && s0.lists === 3);

  // ---- 見出しのタップ領域 ----
  const tapH = await p.evaluate(() => Math.min(...[...document.querySelectorAll('#view .lbl.grp')].map(e => Math.round(e.getBoundingClientRect().height))));
  ok('見出しは44px以上のタップ領域', tapH >= 44);

  // ---- 畳む ----
  await p.evaluate(() => toggleGroup('保有')); await p.waitForTimeout(250);
  const s1 = await state();
  ok('保有を畳むと一覧が消える', s1.lists === 2 && s1.rows < s0.rows);
  ok('見出しは残る', s1.heads.length === 3);
  ok('畳むと画面が短くなる', s1.h < s0.h);
  ok('畳んだ区分の矢尻だけ下向き(無回転)になる', await p.evaluate(() => {
    const gs = [...document.querySelectorAll('#view .lbl.grp')];
    const closed = gs.filter(g => !g.querySelector('.caret.open'));
    return closed.length === 1 && /保有/.test(closed[0].textContent);
  }));

  // ---- 3区分すべて畳める ----
  await p.evaluate(() => { toggleGroup('市場'); toggleGroup('ウォッチ'); }); await p.waitForTimeout(250);
  const s2 = await state();
  ok('3区分すべて畳める', s2.lists === 0 && s2.heads.length === 3);
  ok('全部畳むと大幅に短くなる', s2.h < s0.h);

  // ---- 開き直す ----
  await p.evaluate(() => toggleGroup('保有')); await p.waitForTimeout(250);
  const s3 = await state();
  ok('開き直すと元に戻る', s3.lists === 1 && s3.closed.length === 2);

  // ---- リロードしても畳んだまま ----
  await p.reload(); await p.waitForTimeout(400);
  await go(); await p.waitForTimeout(300);
  const s4 = await state();
  ok('リロードしても畳んだ状態が残る', s4.closed.length === 2 && s4.lists === 1);

  // ---- 名前順に切り替えても壊れない ----
  await p.evaluate(() => { anaSort = '名前順'; render(); }); await p.waitForTimeout(250);
  const s5 = await state();
  ok('名前順では市場と銘柄の2区分になる', s5.heads.length === 2 && /銘柄 \(/.test(s5.heads[1]));
  ok('名前順の市場は畳んだままを引き継ぐ', s5.lists === 1);
  await p.evaluate(() => toggleGroup('銘柄')); await p.waitForTimeout(250);
  ok('名前順の銘柄も畳める', await p.evaluate(() => document.querySelectorAll('#view .list').length === 0));

  // ---- 移行: 既存データにも uiPrefs が入る ----
  const mig = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hypo_tracker_proto_v1'));
    delete raw.uiPrefs; localStorage.setItem('hypo_tracker_proto_v1', JSON.stringify(raw));
    return true;
  });
  await p.reload(); await p.waitForTimeout(400);
  ok('uiPrefsが無い既存データでも壊れない', await p.evaluate(() => Array.isArray(DB.uiPrefs.anaClosed) && DB.uiPrefs.anaClosed.length === 0));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
