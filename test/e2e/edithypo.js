// 注目ポイント/メモの編集シート: 操作を上端に集め、本文の入力欄を主役にする
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
  await p.evaluate(() => openStock('9001')); await p.waitForTimeout(400);
  await p.evaluate(() => sheetEditHypo('h_t1')); await p.waitForTimeout(400);

  // ---- 本文が主役 ----
  const ta = await p.evaluate(() => {
    const e = document.querySelector('#hy_text');
    return { h: Math.round(e.getBoundingClientRect().height), fs: getComputedStyle(e).fontSize,
             full: e.value === DB.hypotheses.find(x => x.id === 'h_t1').text };
  });
  ok('入力欄が210px以上ある', ta.h >= 210);
  ok('本文が丸ごと入っている', ta.full);
  ok('入力欄の文字は16px(iOSで拡大されない)', ta.fs === '16px');
  ok('入力欄はシートで一番大きい要素', await p.evaluate(() => {
    const th = document.querySelector('#hy_text').getBoundingClientRect().height;
    return [...document.querySelectorAll('#sheet .list, #sheet .seg, #sheet .headbar')]
      .every(e => e.getBoundingClientRect().height < th);
  }));

  // ---- 操作は上端のバーに ----
  const bar = await p.evaluate(() => {
    const e = document.querySelector('#sheet .headbar');
    if (!e) return null;
    const bs = [...e.querySelectorAll('button')];
    return { title: e.querySelector('.t').textContent.trim(),
             labels: bs.map(x => x.textContent.trim()),
             heights: bs.map(x => Math.round(x.getBoundingClientRect().height)),
             sticky: getComputedStyle(e).position };
  });
  ok('上端に操作バーがある', !!bar);
  ok('左がキャンセル・右が保存', bar.labels[0] === 'キャンセル' && bar.labels[1] === '保存');
  ok('タイトルが出る', bar.title === '注目ポイント');
  ok('操作のタップ領域は44px以上', bar.heights.every(h => h >= 44));
  ok('スクロールしても操作が残る', bar.sticky === 'sticky');
  ok('✕ は出さない(キャンセルと役目が重なる)', await p.evaluate(() =>
    !document.querySelector('#sheet .sheet-close')));

  // ---- 全幅ボタンを積まない ----
  // 重いのは「全幅」かつ「塗りか枠を持つ」ボタン。削除の文字リンクは全幅だが
  // 背景も枠も持たないので、視覚的な重さは無い
  const heavy = await p.evaluate(() => {
    const w = document.querySelector('#sheet').clientWidth;
    return [...document.querySelectorAll('#sheet button')].filter(e => {
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      const filled = !(s.backgroundColor === 'rgba(0, 0, 0, 0)' || s.backgroundColor === 'transparent');
      const bordered = parseFloat(s.borderTopWidth) > 0;
      return r.width > w * 0.8 && (filled || bordered);
    }).map(e => e.textContent.trim());
  });
  ok('全幅の塗り/枠つきボタンを積まない', heavy.length === 0);
  ok('紺の塗りつぶしボタンが無い', await p.evaluate(() =>
    ![...document.querySelectorAll('#sheet button')].some(e =>
      getComputedStyle(e).backgroundColor === 'rgb(18, 58, 94)')));

  // ---- 種別の切り替えは軽いピル ----
  const seg = await p.evaluate(() => {
    const e = document.querySelector('#sheet .seg');
    const on = e.querySelector('button.on');
    return { light: e.classList.contains('light'),
             inline: getComputedStyle(e).display === 'inline-flex',
             onBg: getComputedStyle(on).backgroundColor,
             onLabel: on.textContent.trim(),
             h: Math.round(on.getBoundingClientRect().height),
             widthRatio: e.getBoundingClientRect().width / document.querySelector('#sheet').clientWidth };
  });
  ok('セグメントは軽い見た目', seg.light && seg.inline);
  ok('選択中は白で浮かせる(紺ベタではない)', seg.onBg === 'rgb(255, 255, 255)');
  ok('セグメントは全幅を占めない', seg.widthRatio < 0.75);
  ok('セグメントのタップ領域は44px以上', seg.h >= 44);
  ok('いま注目ポイントが選ばれている', seg.onLabel === '注目ポイント');

  // ---- リマインダーは行で状態を見せる ----
  const rem = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#sheet .list .list-row')];
    return rows.map(r => ({ ttl: r.querySelector('.ttl').textContent.trim(),
                            meta: r.querySelector('.meta').textContent.trim() }));
  });
  ok('登録済みのリマインダーが行で出る', /1Q決算の確認/.test(rem[0].ttl));
  ok('いつ届くかが読める', /次回 2026\/8\/28/.test(rem[0].meta));
  ok('追加の行も並ぶ', /リマインダーを追加/.test(rem[1].ttl));
  ok('「保存してリマインダー」ボタンは無くなった', await p.evaluate(() =>
    ![...document.querySelectorAll('#sheet button')].some(e => /^保存して/.test(e.textContent.trim()))));

  // ---- 削除は文字リンク ----
  const del = await p.evaluate(() => {
    const e = document.querySelector('#sheet .dellink');
    if (!e) return null;
    const s = getComputedStyle(e);
    return { label: e.textContent.trim(), bg: s.backgroundColor, border: s.borderTopWidth,
             h: Math.round(e.getBoundingClientRect().height) };
  });
  ok('削除は文字リンクになっている', !!del && /削除/.test(del.label));
  ok('削除に枠も背景も無い', parseFloat(del.border) === 0 &&
    (del.bg === 'rgba(0, 0, 0, 0)' || del.bg === 'transparent'));
  ok('削除のタップ領域は44px以上', del.h >= 44);

  // ---- 動作は変わらない ----
  await p.evaluate(() => { document.querySelector('#hy_text').value = '書き換えたテキスト'; });
  await p.evaluate(() => [...document.querySelectorAll('#sheet .headbar button')].find(x => x.textContent.trim() === '保存').click());
  await p.waitForTimeout(500);
  ok('保存できる', await p.evaluate(() =>
    DB.hypotheses.find(x => x.id === 'h_t1').text === '書き換えたテキスト'));
  ok('保存するとシートが閉じる', await p.evaluate(() =>
    !document.querySelector('#scrim').classList.contains('show')));

  // 種別の切り替え(入力中の文章を保つ)
  await p.evaluate(() => sheetEditHypo('h_t1')); await p.waitForTimeout(350);
  await p.evaluate(() => { document.querySelector('#hy_text').value = '途中まで書いた'; });
  await p.evaluate(() => [...document.querySelectorAll('#sheet .seg button')].find(x => x.textContent.trim() === 'メモ').click());
  await p.waitForTimeout(350);
  ok('種別を変えても書きかけが残る', await p.evaluate(() =>
    document.querySelector('#hy_text').value === '途中まで書いた'));
  ok('メモにはリマインダー欄を出さない', await p.evaluate(() =>
    !document.querySelector('#sheet .list')));
  ok('メモのときは見出しもメモになる', await p.evaluate(() =>
    document.querySelector('#sheet .headbar .t').textContent.trim() === 'メモ'));

  // 新規作成
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(250);
  await p.evaluate(() => sheetEditHypo(null, '9001')); await p.waitForTimeout(350);
  ok('新規作成では削除リンクを出さない', await p.evaluate(() => !document.querySelector('#sheet .dellink')));
  ok('新規作成でも入力欄は大きいまま', await p.evaluate(() =>
    document.querySelector('#hy_text').getBoundingClientRect().height >= 210));
  ok('新規作成の見出しは「注目ポイントを作成」', await p.evaluate(() =>
    document.querySelector('#sheet .headbar .t').textContent.trim() === '注目ポイントを作成'));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
