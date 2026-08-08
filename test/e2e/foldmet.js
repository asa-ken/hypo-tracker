// 主要指標・業績推移も、一覧やホームと同じ要領で畳めること
//  ・指標をあまり見ない銘柄では丸ごと隠せる。開閉は銘柄ごとに覚える
//  ・見出しの「編集」は開閉とは別の行き先(押しても畳まれない)
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
  const open = name => p.evaluate(n => openStock(DB.stocks.find(s => s.name === n).id), name);
  const head = label => p.evaluate(l => {
    const el = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.querySelector('span') && x.querySelector('span').textContent.trim() === l);
    if (!el) return null;
    const r = el.getBoundingClientRect(), edit = el.querySelector('.grp-edit');
    return { h: Math.round(r.height), caret: !!el.querySelector('svg.caret'),
             caretUp: /matrix\(-1, 0, 0, -1/.test(getComputedStyle(el.querySelector('svg.caret')).transform),
             edit: !!edit, editH: edit ? Math.round(edit.getBoundingClientRect().height) : 0 };
  }, label);
  const body = () => p.evaluate(() => {
    const v = document.querySelector('#view');
    return { cells: v.querySelectorAll('.metric .m').length, table: v.querySelectorAll('table').length,
             bars: v.querySelectorAll('.pages').length,
             h: Math.round(v.getBoundingClientRect().height),
             lvlHint: /数か月単位で見直す水準/.test(v.innerText) };
  });

  // ---- 1. 見出しが開閉できる形になっている ----
  await open('テスト精機'); await p.waitForTimeout(400);
  const met = await head('主要指標'), tre = await head('業績推移');
  ok('主要指標が開閉見出しになっている', !!met && met.caret);
  ok('業績推移も開閉見出しになっている', !!tre && tre.caret);
  ok('既定は開いている(矢尻が上向き)', met.caretUp && tre.caretUp);
  ok('見出しのタップ領域は44px以上', met.h >= 44 && tre.h >= 44);
  ok('「編集」は見出しの中に残っている', met.edit && tre.edit);
  ok('「編集」も44px以上のタップ領域', met.editH >= 44 && tre.editH >= 44);
  ok('一覧の区分見出しと同じ作り(区切り線)', await p.evaluate(() =>
    [...document.querySelectorAll('#view .lbl.grp')].every(e => parseFloat(getComputedStyle(e).borderTopWidth) === 1)));

  const b0 = await body();
  ok('中身(指標カード・グラフ・表)が出ている', b0.cells > 0 && b0.table === 1);

  // ---- 2. 畳むと中身が消える ----
  await p.evaluate(() => toggleGroup(detailGroupKey(stock(STATE.stockId), '主要指標')));
  await p.waitForTimeout(350);
  const b1 = await body();
  ok('主要指標を畳むとカードが消える', b1.cells === 0);
  ok('業績推移は畳まれない', b1.table === 1);
  ok('見出し自体は残る', !!(await head('主要指標')));
  ok('畳んだ見出しの矢尻は下向き', (await head('主要指標')).caretUp === false);

  await p.evaluate(() => toggleGroup(detailGroupKey(stock(STATE.stockId), '業績推移')));
  await p.waitForTimeout(350);
  const b2 = await body();
  ok('業績推移も畳める(グラフと表が消える)', b2.table === 0 && b2.bars === 0);
  ok('画面が短くなる', b2.h < b0.h);
  ok('分析より下はそのまま残る', await p.evaluate(() => document.querySelectorAll('#view .sec').length > 0));

  // ---- 3. 開き直せる ----
  await p.evaluate(() => { const s = stock(STATE.stockId); toggleGroup(detailGroupKey(s, '主要指標')); toggleGroup(detailGroupKey(s, '業績推移')); });
  await p.waitForTimeout(400);
  const b3 = await body();
  ok('開き直すと元どおり', b3.cells === b0.cells && b3.table === b0.table);

  // ---- 4. 「編集」は開閉と取り違えない ----
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.querySelector('span').textContent.trim() === '主要指標');
    el.querySelector('.grp-edit').click();
  });
  await p.waitForTimeout(350);
  ok('「編集」で設定シートが開く', await p.evaluate(() => document.querySelector('#scrim').classList.contains('show')
    && /指標/.test(document.querySelector('#sheet h3').textContent)));
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(300);
  ok('「編集」を押しても畳まれない', (await body()).cells === b0.cells);

  // 見出しの本体タップは開閉になる
  await p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')].find(x => x.querySelector('span').textContent.trim() === '主要指標').click());
  await p.waitForTimeout(350);
  ok('見出しをタップすると畳まれる', (await body()).cells === 0);

  // ---- 4b. 開閉と編集は押し間違えない距離を空ける ----
  // 以前は編集の箱と矢尻が隙間0で並び、矢尻(22px)を狙うとほぼ編集に当たっていた
  await p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')].find(x => x.querySelector('span').textContent.trim() === '主要指標').click());
  await p.waitForTimeout(350);
  const geo = await p.evaluate(() => {
    const row = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.querySelector('span').textContent.trim() === '主要指標');
    const R = row.getBoundingClientRect(), E = row.querySelector('.grp-edit').getBoundingClientRect(), C = row.querySelector('.grp-caret').getBoundingClientRect();
    return { editW: Math.round(E.width), editH: Math.round(E.height), caretW: Math.round(C.width), caretH: Math.round(C.height),
             gap: Math.round(C.left - E.left - E.width), fromRight: Math.round(R.right - E.right) };
  });
  ok('矢尻に44px以上のタップ枠がある', geo.caretW >= 44 && geo.caretH >= 44);
  ok('編集にも44px以上のタップ枠がある', geo.editW >= 44 && geo.editH >= 44);
  ok('編集と矢尻の間が空いている', geo.gap >= 16);
  ok('編集は画面右端から十分内側にある', geo.fromRight >= 56);

  // 右端から手前へ1pxずつ見て、どこを押すと何になるかを数える
  const zones = await p.evaluate(() => {
    const row = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.querySelector('span').textContent.trim() === '主要指標');
    const R = row.getBoundingClientRect(), y = R.top + R.height / 2;
    const out = { edit: 0, toggle: 0, firstEditAt: null };
    for (let d = 1; d <= 120; d++) {
      const el = document.elementFromPoint(R.right - d, y);
      if (el && el.closest('.grp-edit')) { out.edit++; if (out.firstEditAt === null) out.firstEditAt = d; }
      else if (el && el.closest('.lbl.grp')) out.toggle++;
    }
    return out;
  });
  ok('右端から56px以内はすべて開閉になる', zones.firstEditAt >= 56);
  ok('右寄りの帯は開閉のほうが広い', zones.toggle > zones.edit);

  // 実際に押してみる
  const tapAt = sel => p.evaluate(s => {
    const row = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.querySelector('span').textContent.trim() === '主要指標');
    const r = row.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  const cBox = await tapAt('.grp-caret');
  const closedBefore = await p.evaluate(() => DB.uiPrefs.anaClosed.length);
  await p.mouse.click(cBox.x, cBox.y); await p.waitForTimeout(350);
  ok('矢尻の中心を押すと開閉する(編集にならない)', await p.evaluate(n => DB.uiPrefs.anaClosed.length !== n
    && !document.querySelector('#scrim').classList.contains('show'), closedBefore));
  // 矢尻と編集のちょうど中間(いちばん迷う位置)を押しても、開くだけで済むほうへ倒れる
  const mid = await p.evaluate(() => {
    const row = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.querySelector('span').textContent.trim() === '主要指標');
    const E = row.querySelector('.grp-edit').getBoundingClientRect(), C = row.querySelector('.grp-caret').getBoundingClientRect();
    return { x: (E.right + C.left) / 2, y: (C.top + C.bottom) / 2 };
  });
  const n2 = await p.evaluate(() => DB.uiPrefs.anaClosed.length);
  await p.mouse.click(mid.x, mid.y); await p.waitForTimeout(350);
  ok('編集と矢尻の中間を押しても開閉になる', await p.evaluate(n => DB.uiPrefs.anaClosed.length !== n
    && !document.querySelector('#scrim').classList.contains('show'), n2));
  // 編集の中心はちゃんと編集
  const eBox = await tapAt('.grp-edit');
  await p.mouse.click(eBox.x, eBox.y); await p.waitForTimeout(350);
  ok('編集の中心を押すと設定が開く', await p.evaluate(() => document.querySelector('#scrim').classList.contains('show')));
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(300);

  // 矢尻の無い見出し(分析)の編集も、縦に揃っている
  ok('見出しの「編集」はどれも同じ右位置に揃う', await p.evaluate(() => {
    const textRight = el => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight);
    const es = [...document.querySelectorAll('#view .lbl .grp-edit')];
    return es.length >= 2 && es.every(e => Math.abs(textRight(e) - textRight(es[0])) <= 2);
  }));

  // 畳んだ状態に戻しておく
  await p.evaluate(() => { const s = stock(STATE.stockId); if (!groupClosed(detailGroupKey(s, '主要指標'))) toggleGroup(detailGroupKey(s, '主要指標')); });
  await p.waitForTimeout(350);

  // ---- 5. 銘柄ごとに覚える ----
  await p.evaluate(() => backFromDetail()); await p.waitForTimeout(250);
  await open('サンプル半導体'); await p.waitForTimeout(400);
  ok('別の銘柄は畳まれていない', (await body()).cells > 0);
  await p.evaluate(() => backFromDetail()); await p.waitForTimeout(250);
  await open('テスト精機'); await p.waitForTimeout(400);
  ok('畳んだ銘柄は畳んだまま', (await body()).cells === 0);

  // ---- 6. リロードしても残る ----
  await p.reload(); await p.waitForTimeout(400);
  await open('テスト精機'); await p.waitForTimeout(400);
  ok('リロードしても畳んだまま', (await body()).cells === 0);
  ok('保存先は uiPrefs.anaClosed', await p.evaluate(() => DB.uiPrefs.anaClosed.some(k => /^detail:.*主要指標$/.test(k))));
  await p.evaluate(() => toggleGroup(detailGroupKey(stock(STATE.stockId), '主要指標'))); await p.waitForTimeout(350);

  // ---- 7. 市場カードの指標も同じように畳める ----
  await p.evaluate(() => { backFromDetail(); openStock(DB.stocks.find(s => s.kind === '市場').id); });
  await p.waitForTimeout(400);
  const mktHead = await p.evaluate(() => {
    const el = document.querySelector('#view .lbl.grp');
    return el ? { label: el.querySelector('span').textContent.trim(), caret: !!el.querySelector('svg.caret'), edit: !!el.querySelector('.grp-edit') } : null;
  });
  ok('市場カードの指標も開閉見出しになっている', !!mktHead && mktHead.caret && mktHead.edit);
  const m0 = await body();
  ok('市場カードに業績推移は無いまま(元の仕様)', m0.table === 0 && m0.cells > 0);
  ok('水準の読み方を添える一文が出ている', m0.lvlHint);
  await p.evaluate(l => toggleGroup(detailGroupKey(stock(STATE.stockId), l)), mktHead.label);
  await p.waitForTimeout(350);
  const m1 = await body();
  ok('市場カードの指標も畳める', m1.cells === 0);
  ok('添えた一文も一緒に隠れる(見出しだけ浮かない)', !m1.lvlHint);

  // ---- 8. 同じ層の見出しは、畳めるかどうかに関わらず同じ大きさ ----
  // 分析やメモ・注目ポイントは主要指標・業績推移と同じ層なので、
  // 文字が小さいと「1段下の見出し」に見えてしまう
  await p.evaluate(() => { backFromDetail(); openStock(DB.stocks.find(s => s.name === 'テスト精機').id); });
  await p.waitForTimeout(400);
  const heads = await p.evaluate(() => [...document.querySelectorAll('#view .lbl')].map(e => {
    const st = getComputedStyle(e);
    return { text: e.textContent.trim().replace(/\s+/g, ' ').slice(0, 12), grp: e.classList.contains('grp'),
             size: st.fontSize, weight: st.fontWeight, color: st.color, line: st.borderTopWidth,
             h: Math.round(e.getBoundingClientRect().height) };
  }));
  ok('詳細画面の区分見出しが4つ以上ある', heads.length >= 4);
  ok('詳細画面の区分見出しはすべて畳める', heads.every(x => x.grp));
  const base = heads[0];
  ok('文字の大きさが揃っている', heads.every(x => x.size === base.size));
  ok('文字の太さが揃っている', heads.every(x => x.weight === base.weight));
  ok('文字色が揃っている', heads.every(x => x.color === base.color));
  ok('区切り線が揃っている', heads.every(x => x.line === base.line));
  ok('高さが揃っている', heads.every(x => x.h === base.h));
  ok('「分析」も同じ大きさ', (heads.find(x => /^分析/.test(x.text)) || {}).size === base.size);
  ok('「メモ・注目ポイント」も同じ大きさ', (heads.find(x => /^メモ/.test(x.text)) || {}).size === base.size);
  // 市場カードでも同じ
  await p.evaluate(() => { backFromDetail(); openStock(DB.stocks.find(s => s.kind === '市場').id); });
  await p.waitForTimeout(400);
  ok('市場カードの見出しも揃っている', await p.evaluate(() => {
    const hs = [...document.querySelectorAll('#view .lbl')].map(e => getComputedStyle(e).fontSize);
    return hs.length >= 3 && hs.every(x => x === hs[0]);
  }));
  // 畳める見出しだけが矢尻を持つ(押せるかどうかの手がかりは残す)
  ok('矢尻があるのは畳める見出しだけ', await p.evaluate(() =>
    [...document.querySelectorAll('#view .lbl')].every(e => !!e.querySelector('svg.caret') === e.classList.contains('grp'))));

  // ---- 9. 分析・メモ・注目ポイントも同じように畳める ----
  await p.evaluate(() => { backFromDetail(); openStock(DB.stocks.find(s => s.name === 'テスト精機').id); });
  await p.waitForTimeout(400);
  const before9 = await p.evaluate(() => ({
    secs: document.querySelectorAll('#view .sec').length,
    summary: /ざっくりまとめ/.test(document.querySelector('#view').innerText),
    hypos: document.querySelectorAll('#view .list .list-row, #view .hypo-row').length,
    h: Math.round(document.querySelector('#view').getBoundingClientRect().height),
  }));
  ok('分析の中身(大カテゴリ)が出ている', before9.secs > 0 && before9.summary);
  await p.evaluate(() => toggleGroup(detailGroupKey(stock(STATE.stockId), '分析')));
  await p.waitForTimeout(350);
  const a9 = await p.evaluate(() => ({
    secs: document.querySelectorAll('#view .sec').length,
    summary: /ざっくりまとめ/.test(document.querySelector('#view').innerText),
    head: !![...document.querySelectorAll('#view .lbl.grp')].find(x => x.querySelector('span').textContent.trim() === '分析'),
    edit: !![...document.querySelectorAll('#view .lbl.grp')].find(x => x.querySelector('span').textContent.trim() === '分析' && x.querySelector('.grp-edit')),
  }));
  ok('分析を畳むと大カテゴリもざっくりまとめも消える', a9.secs === 0 && !a9.summary);
  ok('分析の見出しは残る', a9.head);
  ok('畳んでも「編集」は押せる', a9.edit);

  await p.evaluate(() => toggleGroup(detailGroupKey(stock(STATE.stockId), 'メモ・注目ポイント')));
  await p.waitForTimeout(350);
  const b9 = await p.evaluate(() => ({
    heads: [...document.querySelectorAll('#view .lbl.grp')].map(x => x.querySelector('span').textContent.trim()),
    memoBtn: [...document.querySelectorAll('#view button')].some(b => b.textContent.trim() === '＋'),
    h: Math.round(document.querySelector('#view').getBoundingClientRect().height),
  }));
  ok('メモ・注目ポイントも畳める(追加ボタンごと隠れる)', !b9.memoBtn);
  ok('見出しは件数つきで残る', b9.heads.some(t => /^メモ・注目ポイント \(\d+\)$/.test(t)));
  ok('畳むと画面が短くなる', b9.h < before9.h - 100);
  ok('リマインダー・取り込みのボタンは畳まれない', await p.evaluate(() =>
    [...document.querySelectorAll('#view button')].some(b => /会話を取り込む/.test(b.textContent))));

  // 銘柄ごとに覚える
  await p.evaluate(() => { backFromDetail(); openStock(DB.stocks.find(s => s.name === 'サンプル半導体').id); });
  await p.waitForTimeout(400);
  ok('別の銘柄の分析は畳まれていない', await p.evaluate(() => document.querySelectorAll('#view .sec').length > 0));
  await p.reload(); await p.waitForTimeout(400);
  await open('テスト精機'); await p.waitForTimeout(400);
  ok('リロードしても畳んだまま', await p.evaluate(() => document.querySelectorAll('#view .sec').length === 0));
  await p.evaluate(() => { const s = stock(STATE.stockId);
    toggleGroup(detailGroupKey(s, '分析')); toggleGroup(detailGroupKey(s, 'メモ・注目ポイント')); });
  await p.waitForTimeout(400);
  ok('開き直すと元に戻る', await p.evaluate(() => document.querySelectorAll('#view .sec').length > 0));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
