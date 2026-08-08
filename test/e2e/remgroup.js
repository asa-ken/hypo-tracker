// 銘柄詳細: 1つのリマインダーに紐づく注目ポイントは、リマインダー1枚のカードに畳む。
// 本文はカードに並べない(押せばリマインダーが開き、そこに一覧が出るため)
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
  await p.evaluate(() => openStock('9001')); await p.waitForTimeout(450);

  ok('前提: 1つのリマインダーが3件に紐づく', await p.evaluate(() =>
    DB.reminders.some(r => r.stockId === '9001' && (r.hypoIds || []).length === 3)));

  // ---- まとまりが1枚のカードになる ----
  const g = await p.evaluate(() => {
    const e = document.querySelector('#view .list.cards .rgrp');
    if (!e) return null;
    const h = e.querySelector('.rgrp-h');
    return { chip: h.querySelector('.chip').textContent.trim(),
             chipCls: [...h.querySelector('.chip').classList].filter(c => c !== 'chip')[0],
             freq: h.querySelector('.meta').textContent.trim(),
             title: h.querySelector('.ttl').textContent.trim(),
             next: [...h.querySelectorAll('.meta')].pop().textContent.trim(),
             rows: e.querySelectorAll('.swipe').length };
  });
  ok('リマインダーのカードが出る', !!g);
  ok('注目カードは3枚に分かれない', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards > .swipe').length === 4));   // 残り4件(未紐づけ2+メモ2)

  // ---- 本文はカードに並べない(リマインダーを開けば読めるため) ----
  ok('カードに本文を並べない', g.rows === 0);
  ok('注目ポイントの本文がカードに出ない', await p.evaluate(() =>
    !/受注残|中国向け|保守・部品/.test(document.querySelector('#view .list.cards .rgrp').textContent)));
  ok('カードは見出しだけで構成される', await p.evaluate(() => {
    const e = document.querySelector('#view .list.cards .rgrp');
    return e.children.length === 1 && e.firstElementChild.classList.contains('rgrp-h');
  }));

  // ---- 見出しの並びがリマインダー画面と同じ ----
  ok('区分バッジが出る', g.chip === '決算プレビュー');
  ok('区分の色もリマインダー画面と同じ', g.chipCls === 'amber');
  ok('頻度と時刻が出る', /単発 2026\/8\/28 08:30/.test(g.freq));
  ok('リマインダー名が出る', /1Q決算の確認/.test(g.title));
  ok('次回の日時が出る', /次回 2026\/8\/28\(金\) 08:30/.test(g.next));

  // ---- 銘柄詳細では社名を出さない ----
  ok('カードに社名を出さない', await p.evaluate(() =>
    !/テスト精機/.test(document.querySelector('#view .list.cards .rgrp').textContent)));
  ok('リマインダー画面の元タイトルには社名がある', await p.evaluate(() =>
    DB.reminders.find(r => (r.hypoIds || []).length === 3).title.startsWith('テスト精機')));

  // ---- リマインダー画面と同じ見え方か(バッジの文字・色を突き合わせる) ----
  const remSide = await p.evaluate(() => {
    openRem('9001');
    const row = [...document.querySelectorAll('#view .list-row')]
      .find(e => /1Q決算の確認/.test(e.textContent));
    const c = row.querySelector('.chip');
    return { chip: c.textContent.trim(), cls: [...c.classList].filter(x => x !== 'chip')[0],
             ttlSize: getComputedStyle(row.querySelector('.ttl')).fontSize };
  });
  await p.evaluate(() => openStock('9001')); await p.waitForTimeout(400);
  const detSize = await p.evaluate(() =>
    getComputedStyle(document.querySelector('#view .list.cards .rgrp .ttl')).fontSize);
  ok('区分バッジの文字が一致', remSide.chip === g.chip);
  ok('区分バッジの色が一致', remSide.cls === g.chipCls);
  ok('タイトルの文字サイズが一致', remSide.ttlSize === detSize);

  // ---- 操作 ----
  await p.evaluate(() => document.querySelector('#view .list.cards .rgrp .rgrp-h').click());
  await p.waitForTimeout(400);
  ok('見出しを押すとリマインダーが開く', await p.evaluate(() =>
    /1Q決算の確認/.test(document.querySelector('#sheet').textContent)));
  // 対象の一覧はリマインダー側に出る。そこから元の注目ポイントを直せる
  ok('リマインダーに対象の一覧が出る', await p.evaluate(() => {
    const t = document.querySelector('#sheet').textContent;
    return /このリマインダーの対象 \(3件\)/.test(t) && /受注残/.test(t) && /中国向け/.test(t) && /保守・部品/.test(t);
  }));
  ok('対象がタップできると案内する', await p.evaluate(() =>
    /タップで編集/.test(document.querySelector('#sheet').textContent)));
  ok('対象のタップ領域は44px以上', await p.evaluate(() =>
    [...document.querySelectorAll('#sheet .mine .row2.tap')].every(e => e.getBoundingClientRect().height >= 44)));
  await p.evaluate(() => document.querySelector('#sheet .mine .row2.tap').click());
  await p.waitForTimeout(400);
  ok('対象を押すとその注目ポイントを編集できる', await p.evaluate(() =>
    /受注残/.test(document.querySelector('#sheet').textContent) &&
    /削除/.test(document.querySelector('#sheet').textContent)));
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(300);

  // ---- 紐づいていない注目ポイント・メモは従来どおり1枚ずつ ----
  ok('未登録の注目ポイントは単独のカード', await p.evaluate(() =>
    [...document.querySelectorAll('#view .list.cards > .swipe')].some(e => /候補 2026\/9\/12\(未登録\)/.test(e.textContent))));
  ok('メモも単独のカード', await p.evaluate(() =>
    [...document.querySelectorAll('#view .list.cards > .swipe')].filter(e => /メモ/.test(e.textContent)).length === 2));

  // ---- 紐づけが1件だけでも同じ形にする(同じものは同じ見た目) ----
  await p.evaluate(() => {
    const r = DB.reminders.find(x => (x.hypoIds || []).length === 3);
    r.hypoIds = [r.hypoIds[0]]; save(); render();
  });
  await p.waitForTimeout(400);
  ok('1件でもリマインダーのカードで出す', await p.evaluate(() => {
    const e = document.querySelector('#view .list.cards .rgrp');
    return !!e && e.querySelectorAll('.swipe').length === 0 && /1Q決算の確認/.test(e.textContent);
  }));
  ok('外れた2件は単独のカードに戻る', await p.evaluate(() =>
    document.querySelectorAll('#view .list.cards > .swipe').length === 6));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
