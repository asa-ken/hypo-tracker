// 業績推移のグラフ切り替えを、横スワイプだけでなく表の行タップでもできるようにする
//  ・判定は指標名だけでなく、実数を含めた行全体
//  ・いまグラフに出ている行は表側にも印を付け、スワイプで送っても追従する
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
    cap: (document.querySelector('#trendchart_cap') || {}).textContent,
    onRows: [...document.querySelectorAll('#view tr.trend-tap.on')].map(r => r.querySelector('td').textContent.trim()),
    // 内部の状態ではなく、画面のドットの点灯位置で「いま何枚目か」を見る
    idx: (() => { const d = [...document.querySelectorAll('#trendchart_dots .dot')]; const i = d.findIndex(x => x.classList.contains('on')); return i < 0 ? null : i; })(),
    tappable: [...document.querySelectorAll('#view table.trend tr')].slice(1)
      .map(r => ({ name: ((r.querySelector('td').firstChild || {}).textContent || '').trim(),
                   tap: r.classList.contains('trend-tap'), noChart: r.classList.contains('no-chart') })),
  }));
  // 行の中の、指定した列のセルの真ん中を実際にクリックする
  // 指標名のセルには「表のみ」のチップが入ることがあるので、先頭のテキストだけで探す
  const tapCell = (name, col) => p.evaluate(([n, c]) => {
    const nameOf = r => ((r.querySelector('td').firstChild || {}).textContent || '').trim();
    const tr = [...document.querySelectorAll('#view table.trend tr')].find(r => r.querySelector('td') && nameOf(r) === n);
    const tds = tr.querySelectorAll('td'); const r = tds[Math.min(c, tds.length - 1)].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, [name, col]).then(b => p.mouse.click(b.x, b.y)).then(() => p.waitForTimeout(700));

  // ---- 1. グラフのある指標の行だけが押せる ----
  const s0 = await state();
  ok('どの行も押せる', s0.tappable.every(r => r.tap));
  ok('グラフのある3指標は送り先を持つ', s0.tappable.filter(r => !r.noChart).length === 3);
  ok('最初は1枚目のグラフ', s0.cap === '1 / 3' && s0.idx === 0);
  ok('表側にも1行だけ印が付く', JSON.stringify(s0.onRows) === JSON.stringify(['売上高']));
  ok('行の高さは44px以上ある', await p.evaluate(() =>
    [...document.querySelectorAll('#view table.trend tr')].slice(1).every(r => r.getBoundingClientRect().height >= 44)));
  ok('押せることが文章でも案内される', await p.evaluate(() => /表の行をタップするとそのグラフに切り替わります/.test(document.querySelector('#view').innerText)));

  // ---- 2. 指標名をタップして切り替わる ----
  await tapCell('営業利益', 0);
  const s1 = await state();
  ok('指標名のタップで切り替わる', s1.idx === 1 && s1.cap === '2 / 3');
  ok('印も一緒に動く', JSON.stringify(s1.onRows) === JSON.stringify(['営業利益']));
  ok('グラフの中身も入れ替わる', await p.evaluate(() => {
    const pg = [...document.querySelectorAll('#trendchart_pages > .page')];
    return /営業利益/.test(pg[1].innerText);
  }));

  // ---- 3. 実数のセルをタップしても切り替わる(本題) ----
  await tapCell('EPS', 3);
  const s2 = await state();
  ok('いちばん右の実数セルでも切り替わる', s2.idx === 2 && s2.cap === '3 / 3');
  ok('印はEPSに移る', JSON.stringify(s2.onRows) === JSON.stringify(['EPS']));
  await tapCell('売上高', 2);
  const s3 = await state();
  ok('真ん中あたりの実数セルでも切り替わる', s3.idx === 0 && JSON.stringify(s3.onRows) === JSON.stringify(['売上高']));

  // ---- 4. 印は常に1行だけ ----
  ok('印が付くのは常に1行だけ', s0.onRows.length === 1 && s1.onRows.length === 1 && s2.onRows.length === 1 && s3.onRows.length === 1);

  // ---- 5. スワイプ(送りボタン)で送っても表側の印が追従する ----
  // 送りボタンは廃止したので、実際に横スクロールさせて確かめる
  await p.evaluate(() => { const el = document.getElementById('trendchart_pages'); el.scrollLeft = el.clientWidth; });
  await p.waitForTimeout(700);
  const s4 = await state();
  ok('横に送るとグラフが進む', s4.idx === 1);
  ok('スワイプ側から送っても表の印が追従する', JSON.stringify(s4.onRows) === JSON.stringify(['営業利益']));
  ok('丸に矢尻の送りボタンは無い', await p.evaluate(() => !document.querySelector('.navbtn')));
  ok('位置を示すドットは残る', await p.evaluate(() => document.querySelectorAll('#trendchart_dots .dot').length >= 2));

  // ---- 6. グラフに出していない指標の行は押せない ----
  await p.evaluate(() => {
    DB.metricsMaster.trend.push({ name: 'ROE', graph: false });
    const s = stock(STATE.stockId); s.trend['ROE'] = { unit: '%', '24年3月期': '11.2', '25年3月期': '12.5', '26年3月期': '13.7', '27年3月期(予)': '14.1' };
    save(); render();
  });
  await p.waitForTimeout(400);
  const s5 = await state();
  ok('グラフに出していない指標も表には出る', s5.tappable.some(r => r.name === 'ROE' && r.noChart));
  ok('その行には印は付かない', !s5.onRows.some(n => n.startsWith('ROE')));
  ok('押す前から「表のみ」と分かる', await p.evaluate(() =>
    [...document.querySelectorAll('#view table.trend tr')].some(r => /ROE/.test(r.textContent) && /表のみ/.test(r.textContent))));
  // 押しても無反応にはしない。グラフは変えず、理由を返す
  const before = s5.idx;
  await tapCell('ROE', 2);
  const noChart = await p.evaluate(() => (document.querySelector('#trendNote') || {}).innerText || '');
  ok('押してもグラフは入れ替わらない', (await state()).idx === before);
  ok('押すと理由が出る(無反応にならない)', /「ROE」はグラフに出していません/.test(noChart));
  ok('上限の件数も書く', /グラフは4件までです/.test(noChart));
  ok('設定を開く入口も出す', /グラフに出す指標を選ぶ/.test(noChart));
  ok('その入口から設定が開く', await p.evaluate(() => {
    document.querySelector('#trendNote button').click();
    return document.querySelector('#scrim').classList.contains('show');
  }));
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(300);
  // グラフのある行を押すと理由の表示は消える
  await tapCell('売上高', 1);
  ok('グラフのある行を押すと説明は消える', await p.evaluate(() =>
    !(document.querySelector('#trendNote') || {}).innerText));

  // ---- 7. 数値の無い指標でも、グラフに出していれば行から送れる ----
  await p.evaluate(() => {
    DB.metricsMaster.trend.forEach(t => { if (t.name === 'ROE') t.graph = false; });
    DB.metricsMaster.trend.push({ name: '純利益', graph: true });   // データなし・グラフあり
    save(); render();
  });
  await p.waitForTimeout(400);
  ok('データなしの行も押せる', await p.evaluate(() =>
    [...document.querySelectorAll('#view table.trend tr.trend-tap')].some(r => /純利益/.test(r.textContent) && /データなし/.test(r.textContent))));
  await tapCell('純利益', 1);
  const s6 = await state();
  ok('データなしのグラフにも送れる', JSON.stringify(s6.onRows) === JSON.stringify(['純利益']));
  ok('送った先はデータなしのグラフ', await p.evaluate(() => {
    const pg = [...document.querySelectorAll('#trendchart_pages > .page')];
    const i = [...document.querySelectorAll('#trendchart_dots .dot')].findIndex(x => x.classList.contains('on'));
    return /データなし/.test(pg[i].innerText);
  }));

  // ---- 8. グラフが1枚だけのときも印は付く(ページャーが無い) ----
  await p.evaluate(() => {
    DB.metricsMaster.trend.forEach(t => t.graph = (t.name === '売上高'));
    save(); render();
  });
  await p.waitForTimeout(400);
  const s7 = await state();
  ok('グラフ1枚のときはページャーを出さない', await p.evaluate(() => !document.querySelector('#trendchart_pages')));
  ok('1枚のときも表側に印が付く', JSON.stringify(s7.onRows) === JSON.stringify(['売上高']));
  ok('1枚のときは案内文を出さない', await p.evaluate(() => !/表の行をタップするとそのグラフに切り替わります/.test(document.querySelector('#view').innerText)));
  await tapCell('売上高', 1);
  ok('1枚のときに押しても壊れない', errs.length === 0 && (await state()).onRows.length === 1);

  // ---- 9. グラフに出ていない指標があることを、銘柄詳細でも説明する ----
  await p.evaluate(() => {
    // グラフ4件 + グラフ外2件 の状態を作る
    DB.metricsMaster.trend = [
      { name: '売上高', graph: true }, { name: '営業利益', graph: true }, { name: 'EPS', graph: true },
      { name: 'FCF', graph: true }, { name: '純利益', graph: false }, { name: 'ROE', graph: false },
    ];
    save(); render();
  });
  await p.waitForTimeout(400);
  const note = await p.evaluate(() => {
    const e = [...document.querySelectorAll('#view .muted')].find(x => /グラフに出せるのは/.test(x.textContent));
    return e ? e.innerText.replace(/\s+/g, ' ') : null;
  });
  ok('グラフに出ていない指標があると理由を書く', !!note);
  ok('上限が何件かを書く', /グラフに出せるのは4件までです/.test(note || ''));
  ok('あと何件が表だけなのかを書く', /残り2件は表で見られます/.test(note || ''));
  ok('入れ替え方の入口も書く', /「編集」で変えられます/.test(note || ''));
  ok('表には全指標が出ている', await p.evaluate(() =>
    document.querySelectorAll('#view table.trend tr').length - 1 === trendInds(DB.metricsMaster).length));
  // 全部グラフに出ているときは書かない
  await p.evaluate(() => {
    DB.metricsMaster.trend = [{ name: '売上高', graph: true }, { name: '営業利益', graph: true }];
    save(); render();
  });
  await p.waitForTimeout(400);
  ok('全部グラフに出ているときは書かない', await p.evaluate(() =>
    !/グラフに出せるのは/.test(document.querySelector('#view').innerText)));

  // ---- 10. グラフの見出しはグラフの上・中央 ----
  await p.evaluate(() => {
    DB.metricsMaster.trend = [{ name: '売上高', graph: true }, { name: '営業利益', graph: true }, { name: 'EPS', graph: true }];
    save(); render();
  });
  await p.waitForTimeout(400);
  const cap = await p.evaluate(() => {
    const page = document.querySelector('#trendchart_pages > .page');
    const bars = page.querySelector('div[style*="align-items:flex-end"]') || page.children[1];
    const title = page.firstElementChild;
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
                       - (page.getBoundingClientRect().left + page.getBoundingClientRect().right) / 2) < 2,
    };
  });
  ok('見出しはグラフより上にある', cap.aboveBars);
  ok('左右中央揃えになっている', cap.align === 'center' && cap.centered);
  ok('指標名が読める大きさ・太さになっている', cap.nameSize === '13px' && +cap.nameWeight >= 700);
  ok('単位と凡例は小さく添える', cap.subSize === '11px');
  ok('見出しに指標名・単位・凡例が入る', /売上高.*百万円.*点線=予想/.test(cap.text));
  ok('グラフの下に見出しは残っていない', await p.evaluate(() => {
    const page = document.querySelector('#trendchart_pages > .page');
    return !/点線=予想/.test(page.lastElementChild.textContent);
  }));

  // ---- 11. 送っている間、途中の行が一瞬光らない ----
  // 滑らかに送る途中で通り過ぎるグラフの分だけ onscroll が走るため、
  // 印を素直に追わせると「押した行 → 手前の行 → 押した行」と寄り道して見える
  await p.evaluate(() => {
    DB.metricsMaster.trend = [{ name: '売上高', graph: true }, { name: '営業利益', graph: true },
                              { name: 'EPS', graph: true }, { name: 'FCF', graph: true }];
    const st = stock(STATE.stockId);
    st.trend['FCF'] = { unit: '百万円', '24年3月期': '10', '25年3月期': '20', '26年3月期': '30', '27年3月期(予)': '40' };
    st.trend['EPS'] = st.trend['EPS'] || { unit: '円', '24年3月期': '1', '25年3月期': '2', '26年3月期': '3', '27年3月期(予)': '4' };
    save(); render();
  });
  await p.waitForTimeout(400);
  // 印が付いている行の移り変わりを1フレームずつ記録する
  const trackTap = (name) => p.evaluate(n => new Promise(res => {
    const rows = [...document.querySelectorAll('#view table.trend tr.trend-tap')];
    const nameOf = r => r.querySelector('td').textContent.trim();
    const seq = [];
    let stop = false;
    const sample = () => {
      const lit = rows.filter(r => r.classList.contains('on')).map(nameOf).join('+') || '(なし)';
      if (seq[seq.length - 1] !== lit) seq.push(lit);
      if (!stop) requestAnimationFrame(sample);
    };
    sample();
    rows.find(r => nameOf(r) === n).click();
    setTimeout(() => { stop = true; res(seq); }, 1200);
  }), name);

  // 1枚目(売上高)から3枚目(EPS)へ飛ぶ = 途中に営業利益がある
  await p.evaluate(() => { const r = [...document.querySelectorAll('#view table.trend tr.trend-tap')]
    .find(x => /売上高/.test(x.textContent)); r.click(); });
  await p.waitForTimeout(800);
  const seq1 = await trackTap('EPS');
  ok('2つ以上先へ送っても印は寄り道しない', JSON.stringify(seq1) === JSON.stringify(['売上高', 'EPS']));
  ok('最後は押した行に落ち着く', seq1[seq1.length - 1] === 'EPS');

  // 逆向き(下から上へ)も同じ
  const seq2 = await trackTap('売上高');
  ok('上へ戻すときも寄り道しない', JSON.stringify(seq2) === JSON.stringify(['EPS', '売上高']));

  // いちばん端まで飛ばす
  const seq3 = await trackTap('FCF');
  ok('端まで飛ばしても寄り道しない', JSON.stringify(seq3) === JSON.stringify(['売上高', 'FCF']));

  // 送りが終わったあとは、スワイプ(送りボタン)にちゃんと追従する
  await p.evaluate(() => { const el = document.getElementById('trendchart_pages'); el.scrollLeft = el.clientWidth * 2; });
  await p.waitForTimeout(900);
  ok('送り終わったあとはスワイプに追従する', await p.evaluate(() =>
    [...document.querySelectorAll('#view table.trend tr.trend-tap.on')].map(r => r.querySelector('td').textContent.trim())
      .join() === 'EPS'));
  ok('印は1行だけのまま', await p.evaluate(() => document.querySelectorAll('#view table.trend tr.trend-tap.on').length === 1));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
