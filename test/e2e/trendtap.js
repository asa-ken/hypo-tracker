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
  const tapCell = (name, col) => p.evaluate(([n, c]) => {
    const tr = [...document.querySelectorAll('#view table.trend tr')].find(r => r.dataset.name === n);
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

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
