// 業績推移のグラフは常に1枚。表の行をタップすると、その指標のグラフに即座に切り替わる
// (2026-08-15: 設定画面のグラフOn/Offトグル・上限4件は廃止。どの指標でもタップすればグラフになる)
//  ・判定は指標名だけでなく、実数を含めた行全体
//  ・いまグラフに出ている指標は表側にも印を付ける
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => openStock(DB.stocks.find(s => s.name === 'テスト精機').id));
  await p.waitForTimeout(400);
  // 表が画面に入るよう、主要指標は畳んでおく
  await p.evaluate(() => toggleGroup(detailGroupKey(stock(STATE.stockId), '主要指標')));
  await p.waitForTimeout(400);

  const state = () => p.evaluate(() => ({
    chartCount: document.querySelectorAll('#trendchart_single').length,
    chartText: (document.querySelector('#trendchart_single') || {}).innerText || '',
    onRows: [...document.querySelectorAll('#view tr.trend-tap.on')].map(r => r.querySelector('td').textContent.trim()),
    tappable: [...document.querySelectorAll('#view table.trend tr')].slice(1)
      .map(r => ({ name: r.querySelector('td').textContent.trim(), tap: r.classList.contains('trend-tap') })),
  }));
  // 表は5行を超えると内側だけスクロールする(.trend-scroll)ので、対象行が隠れていれば先に
  // 内側だけスクロールして表に出す(ページ全体は動かさない、実際の操作と同じ)
  const tapCell = (name, col) => p.evaluate(([n, c]) => {
    const tr = [...document.querySelectorAll('#view table.trend tr')].find(r => r.dataset.name === n);
    tr.scrollIntoView({ block: 'nearest' });
    const tds = tr.querySelectorAll('td'); const r = tds[Math.min(c, tds.length - 1)].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, [name, col]).then(b => p.mouse.click(b.x, b.y)).then(() => p.waitForTimeout(300));

  // ---- 1. グラフは常に1枚。どの指標の行も押せる ----
  const s0 = await state();
  ok('どの行も押せる(上限や未選択という概念が無い)', s0.tappable.every(r => r.tap));
  ok('グラフは1枚だけ', s0.chartCount === 1);
  ok('最初は先頭の指標(売上高)のグラフ', /売上高/.test(s0.chartText));
  ok('表側にも1行だけ印が付く', JSON.stringify(s0.onRows) === JSON.stringify(['売上高']));
  ok('行の高さは44px以上ある', await p.evaluate(() =>
    [...document.querySelectorAll('#view table.trend tr')].slice(1).every(r => r.getBoundingClientRect().height >= 44)));
  ok('押せることが文章でも案内される', await p.evaluate(() => /表の行をタップすると、その指標のグラフに切り替わります/.test(document.querySelector('#view').innerText)));
  ok('横スワイプのページャーは無い(単一グラフのため)', await p.evaluate(() => !document.querySelector('#trendchart_pages')));
  // 指標名セルの2行クランプ(.clip2)はtd自体ではなく中の要素に掛ける。tdに直接掛けると
  // table-cellから外れて行の高さ計算がずれ、区切り線が指標列だけ浮く(ユーザー指摘、2026-08-15)
  ok('指標列と数値列の区切り線がずれない', await p.evaluate(() =>
    [...document.querySelectorAll('#view table.trend tr')].every(r => {
      const bottoms = [...r.children].map(c => Math.round(c.getBoundingClientRect().bottom));
      return new Set(bottoms).size === 1;
    })));
  ok('指標名セルはtable-cellのまま(2行クランプで外れていない)', await p.evaluate(() =>
    [...document.querySelectorAll('#view table.trend td:first-child')].every(td => getComputedStyle(td).display === 'table-cell')));

  // ---- 2. 指標名をタップして切り替わる ----
  await tapCell('営業利益', 0);
  const s1 = await state();
  ok('指標名のタップで切り替わる', /営業利益/.test(s1.chartText));
  ok('印も一緒に動く', JSON.stringify(s1.onRows) === JSON.stringify(['営業利益']));

  // ---- 3. 実数のセルをタップしても切り替わる(本題) ----
  await tapCell('EPS', 3);
  const s2 = await state();
  ok('いちばん右の実数セルでも切り替わる', /EPS/.test(s2.chartText));
  ok('印はEPSに移る', JSON.stringify(s2.onRows) === JSON.stringify(['EPS']));
  await tapCell('売上高', 2);
  const s3 = await state();
  ok('真ん中あたりの実数セルでも切り替わる', /売上高/.test(s3.chartText) && JSON.stringify(s3.onRows) === JSON.stringify(['売上高']));

  // ---- 4. 印は常に1行だけ ----
  ok('印が付くのは常に1行だけ', s0.onRows.length === 1 && s1.onRows.length === 1 && s2.onRows.length === 1 && s3.onRows.length === 1);

  // ---- 5. 以前「グラフに出していない」扱いだった指標も、同じようにタップで切り替わる ----
  // ROIC は既定のマスターに無い名前(ROEは既定にすでに含まれるため、新規追加の検証には使えない)
  await p.evaluate(() => {
    DB.metricsMaster.trend.push({ name: 'ROIC' });
    const s = stock(STATE.stockId); s.trend['ROIC'] = { unit: '%', '24年3月期': '11.2', '25年3月期': '12.5', '26年3月期': '13.7', '27年3月期(予)': '14.1' };
    save(); render();
  });
  await p.waitForTimeout(400);
  ok('新しく増えた指標もタップできる行として出る', await p.evaluate(() =>
    [...document.querySelectorAll('#view table.trend tr')].some(r => r.dataset && r.dataset.name === 'ROIC')));
  await tapCell('ROIC', 2);
  const s4 = await state();
  ok('タップすればそのままグラフになる(「グラフに出していません」という分岐は無い)', /ROIC/.test(s4.chartText));
  ok('印もROICに移る', JSON.stringify(s4.onRows) === JSON.stringify(['ROIC']));
  ok('無反応・エラーにはならない', errs.length === 0);

  // ---- 6. 数値の無い指標もタップできる(データなしのグラフになる) ----
  await p.evaluate(() => { DB.metricsMaster.trend.push({ name: '純利益' }); save(); render(); });
  await p.waitForTimeout(400);
  ok('データなしの行も表に出る', await p.evaluate(() =>
    [...document.querySelectorAll('#view table.trend tr.trend-tap')].some(r => /純利益/.test(r.textContent) && /データなし/.test(r.textContent))));
  await tapCell('純利益', 1);
  const s5 = await state();
  ok('データなしの指標もタップでグラフに切り替わる', JSON.stringify(s5.onRows) === JSON.stringify(['純利益']));
  ok('切り替え先はデータなしのグラフ', /データなし/.test(s5.chartText));

  // ---- 7. 指標が1件しかなくても壊れない ----
  await p.evaluate(() => { DB.metricsMaster.trend = [{ name: '売上高' }]; save(); render(); });
  await p.waitForTimeout(400);
  const s6 = await state();
  ok('1件のときもグラフは1枚出る', s6.chartCount === 1 && /売上高/.test(s6.chartText));
  ok('1件のときは案内文を出さない(切り替える相手がいないため)', await p.evaluate(() => !/表の行をタップすると/.test(document.querySelector('#view').innerText)));
  await tapCell('売上高', 1);
  ok('1件のときに押しても壊れない', errs.length === 0 && (await state()).onRows.length === 1);

  // ---- 8. グラフに出ていない指標という概念自体が無くなったので、上限に関する案内は出ない ----
  await p.evaluate(() => {
    DB.metricsMaster.trend = [{ name: '売上高' }, { name: '営業利益' }, { name: 'EPS' }, { name: 'FCF' }, { name: '純利益' }, { name: 'ROE' }];
    save(); render();
  });
  await p.waitForTimeout(400);
  ok('件数が多くても上限の案内は出ない(上限が無いため)', await p.evaluate(() => !/グラフに出せるのは/.test(document.querySelector('#view').innerText)));
  ok('表には全指標が出ている', await p.evaluate(() =>
    document.querySelectorAll('#view table.trend tr').length - 1 === trendInds(DB.metricsMaster).length));

  // ---- 9. グラフの見出しはグラフの上・中央 ----
  await p.evaluate(() => {
    DB.metricsMaster.trend = [{ name: '売上高' }, { name: '営業利益' }, { name: 'EPS' }];
    save(); render();
  });
  await p.waitForTimeout(400);
  const cap = await p.evaluate(() => {
    const box = document.querySelector('#trendchart_single');
    const bars = box.querySelector('div[style*="align-items:flex-end"]');
    const title = box.firstElementChild;
    const st = getComputedStyle(title);
    const name = title.querySelector('span');
    return {
      text: title.textContent.trim().replace(/\s+/g, ' '),
      align: st.textAlign,
      aboveBars: Math.round(title.getBoundingClientRect().bottom) <= Math.round(bars.getBoundingClientRect().top) + 1,
      nameSize: name ? getComputedStyle(name).fontSize : null,
      nameWeight: name ? getComputedStyle(name).fontWeight : null,
      subSize: st.fontSize,
      centered: Math.abs((title.getBoundingClientRect().left + title.getBoundingClientRect().right) / 2
                       - (box.getBoundingClientRect().left + box.getBoundingClientRect().right) / 2) < 2,
    };
  });
  ok('見出しはグラフより上にある', cap.aboveBars);
  ok('左右中央揃えになっている', cap.align === 'center' && cap.centered);
  ok('指標名が読める大きさ・太さになっている', cap.nameSize === '13px' && +cap.nameWeight >= 700);
  ok('単位と凡例は小さく添える', cap.subSize === '11px');
  ok('見出しに指標名・単位・凡例が入る', /売上高.*百万円.*点線=予想/.test(cap.text));
  ok('グラフの下に見出しは残っていない', await p.evaluate(() => {
    const box = document.querySelector('#trendchart_single');
    return !/点線=予想/.test(box.lastElementChild.textContent);
  }));

  // ---- 10. 連続でタップしても、印は常に1行・グラフは常に1枚のまま ----
  await p.evaluate(() => {
    DB.metricsMaster.trend = [{ name: '売上高' }, { name: '営業利益' }, { name: 'EPS' }, { name: 'FCF' }];
    const st = stock(STATE.stockId);
    st.trend['FCF'] = { unit: '百万円', '24年3月期': '10', '25年3月期': '20', '26年3月期': '30', '27年3月期(予)': '40' };
    save(); render();
  });
  await p.waitForTimeout(400);
  await tapCell('EPS', 1);
  const seq1 = await state();
  ok('先頭から3番目へ飛んでも、印・グラフともEPSのまま', JSON.stringify(seq1.onRows) === JSON.stringify(['EPS']) && /EPS/.test(seq1.chartText));
  await tapCell('売上高', 1);
  const seq2 = await state();
  ok('上へ戻しても同様', JSON.stringify(seq2.onRows) === JSON.stringify(['売上高']));
  await tapCell('FCF', 1);
  const seq3 = await state();
  ok('端まで飛ばしても同様', JSON.stringify(seq3.onRows) === JSON.stringify(['FCF']) && /FCF/.test(seq3.chartText));
  ok('印は常に1行だけ', await p.evaluate(() => document.querySelectorAll('#view table.trend tr.trend-tap.on').length === 1));
  ok('グラフは常に1枚だけ', await p.evaluate(() => document.querySelectorAll('#trendchart_single').length === 1));

  // ---- 11. 指標数が多いと表の中だけ縦スクロールし、ページ全体は動かさない ----
  // (2026-08-15 ユーザー指摘: 表が縦に長いと、行をタップしてもグラフが画面外のままになっていた)
  await p.evaluate(() => {
    DB.metricsMaster.trend = ['売上高', '営業利益', 'EPS', 'FCF', '純利益', 'ROE', '自己資本比率', '配当性向']
      .map(name => ({ name }));
    const st = stock(STATE.stockId);
    st.trend['配当性向'] = { unit: '%', '24年3月期': '30.0' };
    save(); render();
  });
  await p.waitForTimeout(400);
  const scrollBox = await p.evaluate(() => {
    const el = document.querySelector('.trend-scroll');
    return { h: Math.round(el.getBoundingClientRect().height), scrollable: el.scrollHeight > el.clientHeight + 1 };
  });
  ok('指標が多くても表の枠の高さは一定(ファーストビューは約5行)', scrollBox.h > 0 && scrollBox.h < 300);
  ok('枠を超えた分は表の中だけでスクロールする', scrollBox.scrollable);
  const beforeScroll = await p.evaluate(() => ({
    pageY: window.pageYOffset,
    chartTop: Math.round(document.querySelector('#trendchart_single').getBoundingClientRect().top),
  }));
  // 一番下(表の外に隠れている行)をタップする
  await tapCell('配当性向', 1);
  const afterScroll = await p.evaluate(() => ({
    pageY: window.pageYOffset,
    chartTop: Math.round(document.querySelector('#trendchart_single').getBoundingClientRect().top),
    chartText: document.querySelector('#trendchart_single').innerText,
  }));
  ok('隠れていた行をタップしてもページ全体はスクロールしない', afterScroll.pageY === beforeScroll.pageY);
  ok('グラフの位置も動かない(常に画面内のまま)', afterScroll.chartTop === beforeScroll.chartTop);
  ok('グラフの中身は正しく切り替わる', /配当性向/.test(afterScroll.chartText));
  ok('見出し行(指標/年度)はスクロールしても追従する(sticky)', await p.evaluate(() =>
    getComputedStyle(document.querySelector('.trend-scroll table.trend tr:first-child th')).position === 'sticky'));

  // ---- 横スクロールでも指標名列(1列目)が画面外へ流れない(ユーザー指摘、2026-08-20) ----
  const stickyCol = await p.evaluate(() => {
    const scroller = document.querySelector('.trend-scroll');
    const bodyCell = scroller.querySelector('table.trend tr:nth-child(2) td:first-child');
    const headCell = scroller.querySelector('table.trend th:first-child');
    return {
      bodyPosition: getComputedStyle(bodyCell).position,
      headPosition: getComputedStyle(headCell).position,
      bodyLeft: getComputedStyle(bodyCell).left,
      headLeft: getComputedStyle(headCell).left,
    };
  });
  ok('指標名セル(本文側)がposition:stickyでleft:0固定されている', stickyCol.bodyPosition === 'sticky' && stickyCol.bodyLeft === '0px');
  ok('指標名セル(見出し側)もposition:stickyでleft:0固定されている(縦横両方に追従する角セル)', stickyCol.headPosition === 'sticky' && stickyCol.headLeft === '0px');
  const scrolledStillVisible = await p.evaluate(() => {
    const scroller = document.querySelector('.trend-scroll');
    scroller.scrollLeft = 999;
    const cell = scroller.querySelector('table.trend tr:nth-child(2) td:first-child');
    const cellRect = cell.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return { scrolled: scroller.scrollLeft > 0, cellStillAtLeftEdge: Math.abs(cellRect.left - scrollerRect.left) < 1 };
  });
  ok('実際に右へ横スクロールさせても、指標名セルは枠の左端に留まる', scrolledStillVisible.scrolled && scrolledStillVisible.cellStillAtLeftEdge);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
