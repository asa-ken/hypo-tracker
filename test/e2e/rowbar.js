// 一覧と分析の小項目を Apple 風に揃える
//  ・アクセントバーは廃止。区分の間に細い線を1本、中身は字下げで表す
//  ・まだ空のものは文字を薄く細くして状態を残す
//  ・矢尻は 閉=下向き / 開=上向き で全画面統一
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));
const isTransparent = c => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
const noBar = st => st.content === 'none' || parseFloat(st.w || 0) === 0;

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => {
    DB.stocks.push({ id: '9998', name: 'まだ空の銘柄', code: '9998', kind: 'ウォッチ', metrics: {}, trend: {}, sections: {}, links: [] });
    save(); go('analysis');
  });
  await p.waitForTimeout(300);

  // ---- 1. アクセントバーはどこにも残っていない ----
  const noBars = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#view .list.flat .list-row .lt, #view .lbl.grp').forEach(e => {
      const st = getComputedStyle(e, '::before'); out.push({ content: st.content, w: st.width });
    });
    return out;
  });
  ok('検査対象がある', noBars.length >= 5);
  ok('行にも見出しにもアクセントバーが無い', noBars.every(noBar));

  // ---- 2. 区分の間に細い線が1本入る ----
  const grps = await p.evaluate(() => [...document.querySelectorAll('#view .lbl.grp')].map(e => {
    const st = getComputedStyle(e);
    return { text: e.textContent.trim().replace(/\s+/g, ' '), borderW: parseFloat(st.borderTopWidth), borderC: st.borderTopColor };
  }));
  ok('区分見出しが3つある', grps.length === 3);
  ok('2つ目以降の見出しに区切り線が入る', grps.slice(1).every(g => g.borderW === 1 && !isTransparent(g.borderC)));
  ok('画面の一番上に来る見出しだけ線を引かない(ヘッダーの線と二重にしない)', await p.evaluate(() => {
    go('home');
    const gs = [...document.querySelectorAll('#view .lbl.grp')];
    return gs[0].matches(':first-child') && parseFloat(getComputedStyle(gs[0]).borderTopWidth) === 0
        && parseFloat(getComputedStyle(gs[1]).borderTopWidth) === 1;
  }));
  await p.evaluate(() => go('analysis')); await p.waitForTimeout(250);

  // ---- 3. 中身は字下げで表す(行の区切り線・白カードは無い) ----
  const list = await p.evaluate(() => {
    const l = document.querySelector('#view .list.flat');
    const row = l.querySelector('.list-row');
    const lbl = document.querySelector('#view .lbl.grp');
    const st = getComputedStyle(row);
    return {
      listBg: getComputedStyle(l).backgroundColor, listBorder: parseFloat(getComputedStyle(l).borderTopWidth),
      rowBorder: parseFloat(st.borderTopWidth), rowBg: st.backgroundColor,
      rowH: Math.round(row.getBoundingClientRect().height),
      indent: Math.round(row.querySelector('.ttl').getBoundingClientRect().left - lbl.getBoundingClientRect().left),
    };
  });
  ok('一覧に白カード・枠線が無い', isTransparent(list.listBg) && list.listBorder === 0);
  ok('行の区切り線も無い', list.rowBorder === 0 && isTransparent(list.rowBg));
  ok('行は見出しより字下げされている', list.indent >= 16);
  ok('行のタップ領域は44px以上のまま', list.rowH >= 44);

  // ---- 4. まだ空のカードだけ薄く細い ----
  const rows = await p.evaluate(() => [...document.querySelectorAll('#view .list.flat .list-row')].map(el => {
    const t = el.querySelector('.ttl');
    return { name: t.textContent.trim(), filled: el.classList.contains('filled'),
             weight: getComputedStyle(t).fontWeight, color: getComputedStyle(t).color };
  }));
  const filled = rows.filter(r => r.filled), empty = rows.filter(r => !r.filled);
  ok('中身ありと空が両方ある(テスト前提)', filled.length > 0 && empty.length > 0);
  ok('中身のあるカードは濃く太い', filled.every(r => +r.weight >= 600));
  ok('まだ空のカードは薄く細い', empty.every(r => +r.weight < 600 && r.color !== filled[0].color));
  ok('空と判定されたのは追加したカードだけ', empty.length === 1 && empty[0].name === 'まだ空の銘柄');
  ok('filledはhasContentと一致する', await p.evaluate(() => {
    return [...document.querySelectorAll('#view .list.flat .list-row')].every(el => {
      const name = el.querySelector('.ttl').textContent.trim().replace(/^◆ /, '');
      return el.classList.contains('filled') === hasContent(DB.stocks.find(x => x.name === name));
    });
  }));

  // ---- 5. 矢尻は 閉=下向き / 開=上向き ----
  const grpOpen = await p.evaluate(() => getComputedStyle(document.querySelector('#view .lbl.grp svg.caret')).transform);
  ok('開いている区分の矢尻は上向き', /matrix\(-1, 0, 0, -1/.test(grpOpen));
  await p.evaluate(() => toggleGroup('ウォッチ')); await p.waitForTimeout(250);
  const grpClosed = await p.evaluate(() => {
    const lbl = [...document.querySelectorAll('#view .lbl.grp')].find(x => /ウォッチ/.test(x.textContent));
    return getComputedStyle(lbl.querySelector('svg.caret')).transform;
  });
  ok('閉じている区分の矢尻は下向き(無回転)', grpClosed === 'none' || /matrix\(1, 0, 0, 1/.test(grpClosed));
  await p.evaluate(() => toggleGroup('ウォッチ')); await p.waitForTimeout(200);

  // ---- 6. 分析の小項目も同じ扱い(バー無し・字下げ・空は薄い) ----
  await p.evaluate(() => {
    openStock(DB.stocks.find(s => s.name === 'テスト精機').id);
    document.querySelector('#view .sec').classList.add('open');
  });
  await p.waitForTimeout(400);   // 矢尻の回転(transition .15s)が終わるのを待つ
  const detail = await p.evaluate(() => {
    const sec = document.querySelector('#view .sec.open');
    const head = sec.querySelector('.h');
    const rows = [...sec.querySelectorAll('.sub-row')];
    const f = rows.find(r => r.classList.contains('filled'));
    const e = rows.find(r => !r.classList.contains('filled'));
    const barSt = getComputedStyle(rows[0].querySelector('.name'), '::before');
    return {
      bar: { content: barSt.content, w: barSt.width },
      indent: Math.round(rows[0].querySelector('.name').getBoundingClientRect().left - head.getBoundingClientRect().left),
      filledWeight: f ? getComputedStyle(f.querySelector('.name')).fontWeight : null,
      emptyWeight: e ? getComputedStyle(e.querySelector('.name')).fontWeight : null,
      emptyColor: e ? getComputedStyle(e.querySelector('.name')).color : null,
      filledColor: f ? getComputedStyle(f.querySelector('.name')).color : null,
      // 分析の大カテゴリは矢尻ではなく＋/×。閉=＋(無回転) / 開=×(45度)
      openMark: getComputedStyle(head.querySelector('svg.plusmark')).transform,
      closedMark: getComputedStyle(document.querySelector('#view .sec:not(.open) .h svg.plusmark')).transform,
    };
  });
  await p.waitForTimeout(200);
  ok('小項目にもアクセントバーは無い', noBar(detail.bar));
  ok('小項目は見出しより字下げされている', detail.indent >= 16);
  ok('取り込み済みの小項目は濃く太い', +detail.filledWeight >= 600);
  ok('まだ空の小項目は薄く細い', +detail.emptyWeight < 600 && detail.emptyColor !== detail.filledColor);
  const deg = t => { const m = t.match(/matrix\(([-\d.]+), ([-\d.]+)/); return m ? Math.round(Math.atan2(+m[2], +m[1]) * 180 / Math.PI) : 0; };
  ok('閉じた大カテゴリは＋のまま', detail.closedMark === 'none' || deg(detail.closedMark) === 0);
  ok('開いた大カテゴリは×になる(45度)', deg(detail.openMark) === 45);

  // ---- 7. 取り込み画面の展開エリアも同じ向き ----
  const impBefore = await p.evaluate(() => {
    backFromDetail(); go('import');
    return getComputedStyle(document.querySelector('#view .sec svg.caret')).transform;
  });
  await p.evaluate(() => document.querySelector('#view .sec').classList.add('open'));
  await p.waitForTimeout(400);
  const imp = { before: impBefore, after: await p.evaluate(() => getComputedStyle(document.querySelector('#view .sec svg.caret')).transform) };
  ok('取り込み画面も閉=下向き', imp.before === 'none' || /matrix\(1, 0, 0, 1/.test(imp.before));
  ok('取り込み画面も開=上向き', /matrix\(-1, 0, 0, -1/.test(imp.after));

  // ---- 8. タップ動作は変わらない ----
  await p.evaluate(() => { go('analysis'); document.querySelector('#view .list.flat .list-row').click(); });
  await p.waitForTimeout(300);
  ok('行タップで詳細が開く', await p.evaluate(() => !!STATE.stockId));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
