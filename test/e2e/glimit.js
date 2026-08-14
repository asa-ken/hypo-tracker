// グラフは4件まで。断られた理由を、数秒で消えるトーストではなく設定画面の中に残す
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
  const sheet = () => p.evaluate(() => {
    const w = document.querySelector('#sheet .banner.warn'), n = document.querySelector('#sheet .banner:not(.warn)');
    return { warn: w ? w.textContent.trim() : null, note: n ? n.textContent.trim() : null,
             graphOn: DB.metricsMaster.trend.filter(t => t.graph).map(t => t.name),
             label: (document.querySelector('#sheet').innerText.match(/グラフ表示 \((\d+)\/(\d+)\)/) || []).slice(1) };
  });
  const tapGraph = name => p.evaluate(n => {
    const i = DB.metricsMaster.trend.findIndex(t => t.name === n);
    [...document.querySelectorAll('#sheet .met-row')].find(r => r.querySelector('.nm').textContent.trim() === n)
      .querySelector('button').click();
    return i;
  }, name);

  await p.evaluate(() => { openStock(DB.stocks.find(s => s.name === 'テスト精機').id); sheetMetricsMaster(); });
  await p.waitForTimeout(400);

  // ---- 1. 上限に届いていないうちは何も言わない ----
  const s0 = await sheet();
  ok('既定は3件でグラフON', s0.graphOn.length === 3);
  ok('上限に届いていなければ注意書きを出さない', !s0.warn && !s0.note);
  ok('見出しに件数と上限が出る', JSON.stringify(s0.label) === JSON.stringify(['3', '4']));
  // 右のバッジ(表示中/非表示中)と役割が被って見えるので、左のチェックの記号は置かない。
  // 入/切は塗りつぶしの有無で示す
  ok('チェックボックスの記号は使わない', await p.evaluate(() => !/[☑☐]/.test(document.querySelector('#sheet').innerText)));
  ok('グラフのボタンは残る', await p.evaluate(() =>
    [...document.querySelectorAll('#sheet .met-row button')].filter(b => b.textContent.trim() === 'グラフ').length >= 3));
  ok('入っている指標は塗りつぶしで示す', await p.evaluate(() => {
    const r = [...document.querySelectorAll('#sheet .met-row')].find(x => x.querySelector('.nm').textContent.trim() === '売上高');
    const c = getComputedStyle(r.querySelector('button')).backgroundColor;
    return /^rgb\(1[0-9], 5[0-9], 9[0-9]\)$/.test(c);
  }));

  // ---- 2. 4件目でちょうど上限。上限に達したことを画面に残す ----
  await p.evaluate(() => { DB.metricsMaster.trend.push({ name: 'FCF', graph: false }); save(); sheetMetricsMaster(); });
  await p.waitForTimeout(300);
  await tapGraph('FCF'); await p.waitForTimeout(350);
  const s1 = await sheet();
  ok('4件目は選べる', s1.graphOn.length === 4 && s1.graphOn.includes('FCF'));
  ok('上限に達したことを画面に残す', !!s1.note && /グラフの上限は4件までです/.test(s1.note));
  ok('空け方まで書いてある', /どれかの指標を非表示に変更してください/.test(s1.note));
  ok('この時点では警告色にしない(まだ失敗していない)', !s1.warn);

  // ---- 3. 5件目を選ぶと、その場に理由が残る ----
  await p.evaluate(() => { DB.metricsMaster.trend.push({ name: '純利益', graph: false }); save(); sheetMetricsMaster(); });
  await p.waitForTimeout(300);
  await tapGraph('純利益'); await p.waitForTimeout(350);
  const s2 = await sheet();
  ok('5件目は選べない', s2.graphOn.length === 4 && !s2.graphOn.includes('純利益'));
  ok('押しても見た目がアクティブにならない', await p.evaluate(() => {
    const r = [...document.querySelectorAll('#sheet .met-row')].find(x => x.querySelector('.nm').textContent.trim() === '純利益');
    const on = [...document.querySelectorAll('#sheet .met-row')].find(x => x.querySelector('.nm').textContent.trim() === '売上高');
    return getComputedStyle(r.querySelector('button')).backgroundColor !== getComputedStyle(on.querySelector('button')).backgroundColor;
  }));
  ok('指定どおりの文言で出す', s2.warn === 'グラフの上限は4件までです。どれかの指標を非表示に変更してください。');
  ok('注意書きは警告色で出す', await p.evaluate(() => {
    const c = getComputedStyle(document.querySelector('#sheet .banner.warn')).backgroundColor;
    return c !== 'rgba(0, 0, 0, 0)' && c !== getComputedStyle(document.body).backgroundColor;
  }));
  ok('メッセージは画面内に残る(トーストではない)', await p.evaluate(() =>
    !!document.querySelector('#sheet .banner.warn') && !document.querySelector('#toast.show')));
  ok('チェック欄のすぐ上に出る', await p.evaluate(() => {
    const w = document.querySelector('#sheet .banner.warn').getBoundingClientRect();
    const first = [...document.querySelectorAll('#sheet .met-row')].find(r => /売上高/.test(r.textContent)).getBoundingClientRect();
    return w.bottom <= first.top + 1 && first.top - w.bottom < 40;
  }));

  // 消えるのは次に何か操作したとき(読みっぱなしで消えない)
  await p.evaluate(() => sheetMetricsMaster()); await p.waitForTimeout(300);
  ok('開き直すと一時メッセージは消え、上限の案内だけ残る', await p.evaluate(() =>
    !document.querySelector('#sheet .banner.warn') && !!document.querySelector('#sheet .banner')));

  // ---- 4. 非表示中の指標を選んだときも同じ場所に理由を出す ----
  await p.evaluate(() => { toggleMetric('trend', '純利益'); }); await p.waitForTimeout(300);
  await tapGraph('純利益'); await p.waitForTimeout(350);
  const s3 = await sheet();
  ok('非表示中の指標はグラフに出せない', !s3.graphOn.includes('純利益'));
  ok('非表示中である理由を書く', !!s3.warn && /非表示中なのでグラフに出せません/.test(s3.warn));
  ok('戻し方まで書いてある', /「表示中」にしてから/.test(s3.warn));

  // ---- 5. すでに上限を超えているデータ(旧バージョン由来)にも気づける ----
  await p.evaluate(() => {
    DB.metricsMaster.hiddenTrend = [];
    // 既定の業績推移の件数(2026-08-13にROEが加わり4件)がバージョンで変わっても再現できるよう、
    // ここでちょうど5件に揃えてから全部ONにする
    DB.metricsMaster.trend = DB.metricsMaster.trend.slice(0, 5);
    DB.metricsMaster.trend.forEach(t => t.graph = true);   // 5件ON
    save(); sheetMetricsMaster();
  });
  await p.waitForTimeout(300);
  const s4 = await sheet();
  ok('超過している件数を挙げる', !!s4.warn && /上限の4件を超えています\(5件\)/.test(s4.warn));
  ok('画面がどうなるかも書く', /この5件ぶんのグラフが並びます/.test(s4.warn));
  ok('直し方も同じ言い方で書く', /どれかの指標を非表示に変更してください/.test(s4.warn));
  ok('見出しの表示も実数のまま(5\\/4)', JSON.stringify(s4.label) === JSON.stringify(['5', '4']));
  // 減らせば案内も消える
  await tapGraph('FCF'); await p.waitForTimeout(350);
  const s5 = await sheet();
  ok('1件外すと超過の注意は消える', s5.graphOn.length === 4 && !/超えています/.test(s5.warn || s5.note || ''));

  // ---- 6. 手で足すボタンは置かず、増やし方は「?」で説明する ----
  await p.evaluate(() => sheetMetricsMaster()); await p.waitForTimeout(300);
  ok('「＋ 指標を追加」ボタンは無い', await p.evaluate(() =>
    ![...document.querySelectorAll('#sheet button')].some(b => /指標を追加/.test(b.textContent))));
  ok('見出しの脇に「?」がある', await p.evaluate(() => document.querySelectorAll('#sheet .helpq').length >= 2));
  ok('「?」は44px以上のタップ領域', await p.evaluate(() => {
    const r = document.querySelector('#sheet .helpq').getBoundingClientRect();
    return r.width >= 44 && r.height >= 44;
  }));
  ok('押す前は説明を出さない', await p.evaluate(() => !/外部AIに頼んで取り込めば/.test(document.querySelector('#sheet').innerText)));
  await p.evaluate(() => document.querySelector('#sheet .helpq').click()); await p.waitForTimeout(300);
  ok('「?」を押すと増やし方の説明が出る', await p.evaluate(() =>
    /指標を追加したい場合は、外部AIに頼んで取り込めば自動で追加されます。/.test(document.querySelector('#sheet').innerText)));
  ok('説明は見出しのすぐ下に出る', await p.evaluate(() => {
    const lbl = document.querySelector('#sheet .lbl').getBoundingClientRect();
    const bn = document.querySelector('#sheet .banner').getBoundingClientRect();
    return bn.top >= lbl.bottom - 1 && bn.top - lbl.bottom < 20;
  }));
  await p.evaluate(() => document.querySelector('#sheet .helpq').click()); await p.waitForTimeout(300);
  ok('もう一度押すと閉じる', await p.evaluate(() => !/外部AIに頼んで取り込めば/.test(document.querySelector('#sheet').innerText)));
  // 市場カードの設定にも同じ入口がある
  await p.evaluate(() => { closeSheet(); backFromDetail(); openStock(DB.stocks.find(s => s.kind === '市場').id); sheetMarketMetricsMaster(); });
  await p.waitForTimeout(400);
  ok('市場の設定にも「＋ 指標を追加」は無い', await p.evaluate(() =>
    ![...document.querySelectorAll('#sheet button')].some(b => /指標を追加/.test(b.textContent))));
  await p.evaluate(() => document.querySelector('#sheet .helpq').click()); await p.waitForTimeout(300);
  ok('市場の設定でも「?」で同じ説明が出る', await p.evaluate(() =>
    /外部AIに頼んで取り込めば自動で追加されます。/.test(document.querySelector('#sheet').innerText)));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
