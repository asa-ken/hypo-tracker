// 市場・銘柄分析の区分ごとに、並び順を自分で変えられること
//
// ユーザー指示(2026-10-04): 「並び順は登録順が第一優先で、各区分ごとに、ハンバーガーマークで並び順を変える
// UIが多いと思うけど、そんな感じにしてみたい」。
//  ・既定の並びは登録順(DB.stocks の順)
//  ・区分の見出しの右の「並べ替え」で、その区分だけ並べ替えの状態になり、行の右に ≡(つまみ)が出る
//  ・つまみをドラッグして順番を変える。キーボードでは つまみ にフォーカスして ↑↓ で動かせる
//  ・「完了」で元に戻る。並べ替えの状態の間は、行を押しても詳細を開かない(つまみの操作と取り違えないため)
//  ・並び順は DB.uiPrefs.anaOrder に区分ごとに保存する。DB.stocks の順(他の画面の並び)は変えない
//  ・並べ替えた後に追加した銘柄は、その区分の末尾に出る
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install({ time: new Date('2026-08-22T03:00:00Z') });
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  // 保有に3件そろえる(testdataの保有は2件)。登録順は テスト精機 → ダミー商事 → 新規A
  await p.evaluate(() => { DB.stocks.push({ id: 'NA1', name: '新規A', code: 'NA1', kind: '保有', metrics: {}, trend: {}, sections: {}, mine: [] }); save(); go('analysis'); });
  await p.waitForTimeout(300);

  const names = key => p.evaluate(k => {
    const h = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.textContent.trim().startsWith(k));
    const list = h && h.nextElementSibling;
    return list && list.classList.contains('list') ? [...list.querySelectorAll('.list-row .ttl')].map(e => e.textContent.trim()) : [];
  }, key);
  const head = key => p.evaluate(k => {
    const h = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.textContent.trim().startsWith(k));
    const e = h.querySelector('.grp-edit'); return e ? e.textContent.trim() : null;
  }, key);
  const handles = key => p.evaluate(k => {
    const h = [...document.querySelectorAll('#view .lbl.grp')].find(x => x.textContent.trim().startsWith(k));
    const list = h.nextElementSibling;
    return [...list.querySelectorAll('.list-row .drag')].map(d => { const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), role: d.getAttribute('role'), label: d.getAttribute('aria-label') }; });
  }, key);
  const clickHead = key => p.evaluate(k => [...document.querySelectorAll('#view .lbl.grp')].find(x => x.textContent.trim().startsWith(k)).querySelector('.grp-edit').click(), key);

  // ---- 1. 既定は登録順。「並べ替え」は2件以上の区分にだけ出る ----
  ok('既定の並びは登録順', JSON.stringify(await names('保有')) === JSON.stringify(['テスト精機', 'ダミー商事', '新規A']), await names('保有'));
  ok('2件以上の区分(保有)に「並べ替え」がある', await head('保有') === '並べ替え');
  ok('1件だけの区分(市場)には「並べ替え」を出さない', await head('市場') === null);
  ok('並べ替えの前は、つまみ(≡)は出ない', (await handles('保有')).length === 0);

  // ---- 2. 「並べ替え」でその区分だけつまみが出る ----
  await clickHead('保有'); await p.waitForTimeout(250);
  const hs = await handles('保有');
  ok('押した区分の行につまみが出る', hs.length === 3, hs);
  ok('他の区分(ウォッチ)にはつまみが出ない', (await handles('ウォッチ')).length === 0);
  ok('見出しの文字が「完了」に変わる', await head('保有') === '完了');
  ok('つまみのタップ領域は44px以上', hs.every(h => h.w >= 44 && h.h >= 44), hs);
  ok('つまみは読み上げで何を動かすか分かる', hs.every(h => h.role === 'button' && /を移動/.test(h.label || '')), hs);
  await p.evaluate(() => document.querySelector('#view .list-row .ttl') && [...document.querySelectorAll('#view .list-row')].find(r => /ダミー商事/.test(r.textContent)).click());
  await p.waitForTimeout(250);
  ok('並べ替えの間は、行を押しても詳細を開かない', await p.evaluate(() => STATE.stockId === null));

  // ---- 3. つまみをドラッグして順番を変える(テスト精機を一番下へ) ----
  const box = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#view .list-row')].filter(r => r.querySelector('.drag'));
    const d = rows[0].querySelector('.drag').getBoundingClientRect(); const last = rows[2].getBoundingClientRect();
    return { x: d.x + d.width / 2, y: d.y + d.height / 2, toY: last.bottom - 4 };
  });
  await p.mouse.move(box.x, box.y); await p.mouse.down();
  for (let i = 1; i <= 12; i++) { await p.mouse.move(box.x, box.y + (box.toY - box.y) * i / 12); await p.waitForTimeout(16); }
  await p.mouse.up(); await p.waitForTimeout(300);
  ok('ドラッグで順番が変わる(テスト精機が一番下へ)', JSON.stringify(await names('保有')) === JSON.stringify(['ダミー商事', '新規A', 'テスト精機']), await names('保有'));
  ok('並び順は区分ごとに保存される', await p.evaluate(() => JSON.stringify(DB.uiPrefs.anaOrder['保有']) === JSON.stringify(['9003', 'NA1', '9001'])));
  ok('他の画面で使う DB.stocks の順は変えない', await p.evaluate(() => DB.stocks.filter(s => s.kind === '保有').map(s => s.id).join(',') === '9001,9003,NA1'));

  // ---- 4. キーボードでも動かせる(つまみにフォーカスして ↑) ----
  await p.evaluate(() => [...document.querySelectorAll('#view .list-row')].find(r => /テスト精機/.test(r.textContent)).querySelector('.drag').focus());
  await p.keyboard.press('ArrowUp'); await p.waitForTimeout(250);
  ok('↑で1つ上へ動く', JSON.stringify(await names('保有')) === JSON.stringify(['ダミー商事', 'テスト精機', '新規A']), await names('保有'));
  ok('動かした後もつまみにフォーカスが残る(続けて動かせる)', await p.evaluate(() => /テスト精機/.test(document.activeElement.getAttribute('aria-label') || '')));

  // ---- 5. 「完了」で元に戻り、行から詳細を開ける ----
  await clickHead('保有'); await p.waitForTimeout(250);
  ok('「完了」でつまみが消える', (await handles('保有')).length === 0 && await head('保有') === '並べ替え');
  await p.evaluate(() => [...document.querySelectorAll('#view .list-row')].find(r => /ダミー商事/.test(r.textContent)).click());
  await p.waitForTimeout(250);
  ok('完了後は行から詳細を開ける', await p.evaluate(() => STATE.stockId === '9003'));
  await p.evaluate(() => backFromDetail()); await p.waitForTimeout(200);

  // ---- 6. 再読込しても並び順が残る。後から足した銘柄は末尾 ----
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => { DB.stocks.push({ id: 'NB1', name: '新規B', code: 'NB1', kind: '保有', metrics: {}, trend: {}, sections: {}, mine: [] }); save(); go('analysis'); });
  await p.waitForTimeout(300);
  ok('再読込しても並び順が残り、後から足した銘柄は末尾に出る', JSON.stringify(await names('保有')) === JSON.stringify(['ダミー商事', 'テスト精機', '新規A', '新規B']), await names('保有'));

  // ---- 7. 畳んでいる区分で「並べ替え」を押すと開く ----
  await p.evaluate(() => toggleGroup('ウォッチ')); await p.waitForTimeout(200);
  await clickHead('ウォッチ'); await p.waitForTimeout(250);
  ok('畳んでいる区分で「並べ替え」を押すと開いてつまみが出る', (await handles('ウォッチ')).length === 2);
  ok('並べ替えは同時に1つの区分だけ(保有は通常表示)', (await handles('保有')).length === 0);
  await clickHead('ウォッチ'); await p.waitForTimeout(200);

  // ---- 8. 区分が変わった銘柄(保有→ウォッチ)の行き先 ----
  // 移った先の区分を並べ替えたことがあれば、その末尾に出る(保存した並びに無い=後から来たものとして扱う)
  await p.evaluate(() => { setAnaOrder('ウォッチ', ['TSTC', '9002']); DB.stocks.find(s => s.id === '9001').kind = 'ウォッチ'; save(); render(); }); await p.waitForTimeout(250);
  ok('並べ替え済みの区分へ移った銘柄は、その末尾に出る', JSON.stringify(await names('ウォッチ')) === JSON.stringify(['TESTCO Inc.', 'サンプル半導体', 'テスト精機']), await names('ウォッチ'));
  ok('保有の残りの並びは保たれる', JSON.stringify(await names('保有')) === JSON.stringify(['ダミー商事', '新規A', '新規B']), await names('保有'));
  // 並べ替えたことの無い区分は、既定どおり登録順のまま(移ってきた銘柄も登録順の位置に入る)
  await p.evaluate(() => { DB.uiPrefs.anaOrder['ウォッチ'] = undefined; save(); render(); }); await p.waitForTimeout(250);
  ok('並べ替えたことの無い区分は登録順(移ってきた銘柄も登録順の位置)', JSON.stringify(await names('ウォッチ')) === JSON.stringify(['テスト精機', 'サンプル半導体', 'TESTCO Inc.']), await names('ウォッチ'));

  // ---- 9. 並べ替えの途中で別のタブへ移ると、並べ替えの状態は終わる。行は横にはみ出さない ----
  await clickHead('保有'); await p.waitForTimeout(200);
  ok('並べ替え中の行も横にはみ出さない', await p.evaluate(() => [...document.querySelectorAll('#view .list-row')].every(r => r.scrollWidth <= r.clientWidth + 1 && r.getBoundingClientRect().right <= document.querySelector('#view').getBoundingClientRect().right + 1)));
  await p.evaluate(() => { go('home'); go('analysis'); }); await p.waitForTimeout(250);
  ok('タブを移って戻ると並べ替えの状態は終わっている', (await handles('保有')).length === 0 && await head('保有') === '並べ替え');

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
