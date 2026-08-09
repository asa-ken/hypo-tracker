// ホームの「対応が必要」で、対象(銘柄・市場)ごとの分割コピーと一括コピーの両方を確認
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

  // テストデータの r_t1・r_t2(9001)・r_t4(TSTC)を「今日発火」にする。
  // 元は休止していない全リマインダーを「今日」扱いにしていたため何もしなくても
  // このフィクスチャが「今日」の対象になっていたが、今日のリマインダーは実際に
  // 今日発火するものだけを指すよう修正した(2026-08-09 DECISIONS.md)ため、
  // 実行日に依存せず「今日」を再現できるよう単発の期日を実行時の今日の日付に書き換える
  await p.evaluate(() => {
    const t = fmtToday();
    ['r_t1', 'r_t2', 'r_t4'].forEach(id => {
      const r = DB.reminders.find(x => x.id === id);
      r.freq = '単発 ' + t; r.times = ['23:59'];
    });
    save();
  });

  // テストデータは 9001(2件)・TSTC(1件) の2対象にまたがる想定
  await p.evaluate(() => go('home')); await p.waitForTimeout(250);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#view .card.attn .list-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  ok('対象ごとの行が複数出る(2対象)', rows.length === 2);
  ok('テスト精機の行がある(2件)', rows.some(t => /テスト精機/.test(t) && /2件/.test(t)));
  ok('TESTCOの行がある(1件)', rows.some(t => /TESTCO/.test(t) && /1件/.test(t)));
  ok('案内文がある', /チャットを対象ごとに分けている場合/.test(await p.evaluate(() => document.querySelector('#view').innerText)));
  ok('一括コピーのボタンもある', /全部まとめて一括コピー/.test(await p.evaluate(() => document.querySelector('#view').innerText)));

  // 分割コピー: テスト精機分だけコピーされる
  await p.evaluate(() => { window._copied = null; navigator.clipboard.writeText = t => { window._copied = t; return Promise.resolve(); }; });
  const btn9001 = await p.evaluate(() => { const row = [...document.querySelectorAll('#view .list-row')].find(r => /テスト精機/.test(r.textContent)); const b = row.querySelector('button'); b.click(); return true; });
  await p.waitForTimeout(200);
  const copied1 = await p.evaluate(() => window._copied);
  ok('テスト精機分だけがコピーされる(TESTCOを含まない)', /1Q決算|受注残|関連ニュース/.test(copied1) && !/TESTCO/.test(copied1));
  ok('2件とも含まれる', copied1.split('\n\n').filter(x => /^\d\) /.test(x)).length === 2);

  // 一括コピー: 両方含まれる
  const bulkClicked = await p.evaluate(() => { document.querySelectorAll('#view button').forEach(b => { if (/全部まとめて一括コピー/.test(b.textContent)) b.click(); }); return true; });
  await p.waitForTimeout(200);
  const copied2 = await p.evaluate(() => window._copied);
  ok('一括コピーは両方の対象を含む', /テスト精機|受注残/.test(copied2) === false ? false : true);
  ok('一括コピーの件数は3件', copied2.split('\n\n').filter(x => /^\d\) /.test(x)).length === 3);

  // 対象が1つだけの場合は従来どおり単一ボタン
  await p.evaluate(() => { DB.reminders.forEach(r => { if (r.stockId !== '9001') r.paused = true; }); save(); go('home'); });
  await p.waitForTimeout(250);
  const single = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('対象が1つだけなら「確認プロンプトをコピー」の単一ボタンに戻る', /確認プロンプトをコピー/.test(single) && !/全部まとめて一括コピー/.test(single));
  ok('対象が1つのときは案内文が出ない', !/チャットを対象ごとに分けている場合/.test(single));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
