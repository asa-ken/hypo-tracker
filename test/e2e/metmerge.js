// 指標の整理: 指標名タップ →「ほかの指標にまとめる」「削除」
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

  const reset = async () => {
    await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
    await p.reload(); await p.waitForTimeout(350);
    // 表記揺れを作る: 業績推移に「売上」、スナップショットに「予想PER」
    await p.evaluate(() => {
      DB.metricsMaster.trend.push({ name: '売上', graph: false });
      stock('9001').trend['売上'] = { unit: '百万円', '23年3月期': '380000', '24年3月期': '999' };
      stock('9002').trend['売上'] = { unit: '百万円', '24年12月期': '250000' };
      DB.metricsMaster.snap.push('予想PER');
      stock('9001').metrics['予想PER'] = { v: '19.5', unit: '倍', d: '2026/8/1' };
      save(); render();
    });
  };
  const openEdit = async name => {
    await p.evaluate(() => sheetMetricsMaster());
    await p.waitForTimeout(250);
    await p.evaluate(n => [...document.querySelectorAll('#sheet .met-row .nm')].find(x => x.textContent.trim() === n).click(), name);
    await p.waitForTimeout(250);
  };

  await reset();

  // ---- 一覧: 名前が押せて、押せる目印がある ----
  await p.evaluate(() => sheetMetricsMaster());
  await p.waitForTimeout(300);
  const row = await p.evaluate(() => {
    const n = document.querySelector('#sheet .met-row .nm');
    return { tag: n.tagName, h: Math.round(n.getBoundingClientRect().height), dots: !!n.querySelector('svg.dots') };
  });
  ok('指標名はボタンになっている', row.tag === 'BUTTON');
  ok('タップ領域が44px以上ある', row.h >= 44);
  ok('押せる目印(…)が付いている', row.dots);
  ok('開閉の矢尻は使っていない', await p.evaluate(() => !document.querySelector('#sheet .met-row .nm svg.caret')));
  ok('説明文で名前を押せることを案内している', await p.evaluate(() =>
    /指標名を押すと/.test(document.querySelector('#sheet').textContent)));

  // ---- 編集シート ----
  await openEdit('売上');
  const sheet = await p.evaluate(() => document.querySelector('#sheet').textContent.replace(/\s+/g, ' '));
  ok('どの一覧の指標かが分かる', /業績推移の指標です/.test(sheet));
  ok('データを持つカード数を出す', /2件のカードにデータがあります/.test(sheet));
  ok('似た名前を先に知らせる', /「売上高」と名前が似ています/.test(sheet));
  ok('まとめ先の既定は似た名前', await p.evaluate(() => document.querySelector('#metMergeTo').value === '売上高'));
  ok('自分自身はまとめ先に出ない', await p.evaluate(() =>
    ![...document.querySelectorAll('#metMergeTo option')].some(o => o.value === '売上')));
  ok('消えるデータの件数を予告する', /2件のカードの「売上」のデータも一緒に消えます/.test(sheet));

  // ---- まとめる(業績推移): 年度ごとに合体し、衝突はまとめ先を残す ----
  const before = await p.evaluate(() => JSON.parse(JSON.stringify(stock('9001').trend['売上高'])));
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].find(x => x.textContent.trim() === 'まとめる').click());
  await p.waitForTimeout(250);
  ok('まとめる前に確認が出る', await p.evaluate(() => /「売上」を「売上高」にまとめます/.test(document.querySelector('#sheet').textContent)));
  await p.evaluate(() => runConfirm());
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({
    t9001: stock('9001').trend, t9002: stock('9002').trend,
    master: DB.metricsMaster.trend.map(x => x.name),
  }));
  ok('まとめ元は一覧から消える', !after.master.includes('売上'));
  ok('まとめ元のデータも消える', !after.t9001['売上'] && !after.t9002['売上']);
  ok('無かった年度は引き継がれる', after.t9001['売上高']['23年3月期'] === '380000');
  ok('同じ年度はまとめ先の値を残す', after.t9001['売上高']['24年3月期'] === before['24年3月期']);
  ok('まとめ先が無いカードには新しく作る', after.t9002['売上高'] && after.t9002['売上高']['24年12月期'] === '250000');
  ok('単位も引き継ぐ', after.t9002['売上高'].unit === '百万円');
  ok('件数を添えて知らせる', await p.evaluate(() => /まとめました/.test(document.querySelector('#toast').textContent)));
  ok('一覧に戻る', await p.evaluate(() => /収容指標/.test(document.querySelector('#sheet h3').textContent)));

  // ---- 再読み込みしても復活しない(migrate が戻さない) ----
  await p.reload(); await p.waitForTimeout(400);
  ok('再読み込みしても復活しない', await p.evaluate(() => !DB.metricsMaster.trend.some(t => t.name === '売上')));
  ok('並び順を戻しても復活しない', await p.evaluate(() => {
    const mm = DB.metricsMaster, s0 = seed();
    return !orderByDefault(mm.trend.map(t => t.name), s0.metricsMaster.trend.map(t => t.name)).includes('売上');
  }));

  // ---- まとめる(スナップショット): 取り込み日が新しいほうを残す ----
  await reset();
  await p.evaluate(() => { stock('9001').metrics['PER(予想)'] = { v: '15.0', unit: '倍', d: '2026/1/1' }; save(); });
  await openEdit('予想PER');
  await p.evaluate(() => { document.querySelector('#metMergeTo').value = 'PER(予想)'; });
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].find(x => x.textContent.trim() === 'まとめる').click());
  await p.waitForTimeout(200); await p.evaluate(() => runConfirm());
  await p.waitForTimeout(400);
  ok('新しく取り込んだ値が残る', await p.evaluate(() => stock('9001').metrics['PER(予想)'].v === '19.5'));
  ok('古い値は上書きされる', await p.evaluate(() => stock('9001').metrics['PER(予想)'].d === '2026/8/1'));
  ok('まとめ元のスナップショットは消える', await p.evaluate(() =>
    !stock('9001').metrics['予想PER'] && !DB.metricsMaster.snap.includes('予想PER')));

  // 逆向き: まとめ元のほうが古ければ、まとめ先を残す
  await reset();
  await p.evaluate(() => { stock('9001').metrics['予想PER'].d = '2025/1/1'; stock('9001').metrics['PER(予想)'] = { v: '15.0', unit: '倍', d: '2026/8/1' }; save(); });
  await openEdit('予想PER');
  await p.evaluate(() => { document.querySelector('#metMergeTo').value = 'PER(予想)'; });
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].find(x => x.textContent.trim() === 'まとめる').click());
  await p.waitForTimeout(200); await p.evaluate(() => runConfirm());
  await p.waitForTimeout(400);
  ok('まとめ元が古ければ既存を残す', await p.evaluate(() => stock('9001').metrics['PER(予想)'].v === '15.0'));

  // ---- 削除 ----
  await reset();
  await openEdit('売上');
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].find(x => x.textContent.trim() === '削除する').click());
  await p.waitForTimeout(250);
  ok('削除前に確認が出る', await p.evaluate(() => /元に戻せません/.test(document.querySelector('#sheet').textContent)));
  ok('確認は危険色のボタンになる', await p.evaluate(() =>
    !![...document.querySelectorAll('#sheet button.danger')].find(x => x.textContent.trim() === '削除する')));
  await p.evaluate(() => runConfirm());
  await p.waitForTimeout(400);
  ok('一覧から消える', await p.evaluate(() => !DB.metricsMaster.trend.some(t => t.name === '売上')));
  ok('各カードのデータも消える', await p.evaluate(() => !stock('9001').trend['売上'] && !stock('9002').trend['売上']));
  ok('ほかの指標は残る', await p.evaluate(() =>
    !!stock('9001').trend['売上高'] && DB.metricsMaster.trend.some(t => t.name === '売上高')));

  // ---- 非表示中の指標を消しても、非表示リストに残骸を残さない ----
  await reset();
  await p.evaluate(() => { toggleMetric('trend', '売上'); });
  await p.waitForTimeout(200);
  ok('前提: 非表示中になっている', await p.evaluate(() => (DB.metricsMaster.hiddenTrend || []).includes('売上')));
  await openEdit('売上');
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].find(x => x.textContent.trim() === '削除する').click());
  await p.waitForTimeout(200); await p.evaluate(() => runConfirm());
  await p.waitForTimeout(400);
  ok('非表示の印も一緒に消える', await p.evaluate(() => !(DB.metricsMaster.hiddenTrend || []).includes('売上')));
  await p.reload(); await p.waitForTimeout(400);
  ok('非表示の印が残っていないので復活しない', await p.evaluate(() => !DB.metricsMaster.trend.some(t => t.name === '売上')));

  // ---- 市場・テーマの指標も同じ手順で整理できる ----
  await reset();
  await p.evaluate(() => { openStock('mkt_test1'); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { DB.marketMetricsMaster.snap.push('長期金利'); stock('mkt_test1').metrics['長期金利'] = { v: '1.5', unit: '%', d: '2026/8/1' }; save(); sheetMarketMetricsMaster(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll('#sheet .met-row .nm')].find(x => x.textContent.trim() === '長期金利').click());
  await p.waitForTimeout(250);
  ok('市場の指標でも似た名前を拾う', await p.evaluate(() =>
    /「長期金利\(10年\)」と名前が似ています/.test(document.querySelector('#sheet').textContent)));
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].find(x => x.textContent.trim() === 'まとめる').click());
  await p.waitForTimeout(200); await p.evaluate(() => runConfirm());
  await p.waitForTimeout(400);
  ok('市場の指標もまとめられる', await p.evaluate(() =>
    !DB.marketMetricsMaster.snap.includes('長期金利') && stock('mkt_test1').metrics['長期金利(10年)'].v === '1.5'));
  ok('銘柄用のマスターは巻き込まない', await p.evaluate(() => DB.metricsMaster.snap.includes('PER(予想)')));

  // ---- 唯一の指標なら「まとめる」は出さない ----
  await reset();
  await p.evaluate(() => { DB.metricsMaster.trend = [{ name: '売上高', graph: true }]; save(); });
  await openEdit('売上高');
  ok('まとめ先が無いときは統合を出さない', await p.evaluate(() =>
    !document.querySelector('#metMergeTo') && /削除/.test(document.querySelector('#sheet').textContent)));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
