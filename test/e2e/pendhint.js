// 日付つきの注目ポイントでリマインダー未登録のものを、どの画面に置くか
//
// もともとホームの区分として最上位付近に出していたが、登録しないことを選んでいる人には
// 「無意味なものが常に最上位にある」状態になる。リマインダーを作るかどうかは
// リマインダー画面で決めることなので、そちらへ移した。
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
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  ok('未登録の注目ポイントがある(テスト前提)', await p.evaluate(() => pendingHints().length > 0),
    await p.evaluate(() => pendingHints().map(x => x.remindHint.date)));

  // ---- 1. ホームには出さない ----
  await p.evaluate(() => go('home')); await p.waitForTimeout(350);
  const home = await p.evaluate(() => ({
    heads: [...document.querySelectorAll('#view .lbl.grp')].map(e => e.textContent.trim().replace(/\s+/g, ' ')),
    text: document.querySelector('#view').innerText,
  }));
  ok('ホームに「リマインド未登録」の区分が無い', !home.heads.some(h => /リマインド未登録/.test(h)), home.heads);
  ok('ホームの区分はリマインダーの状態だけになる',
    home.heads.every(h => /期限切れ|今日のリマインダー|今週の予定/.test(h)), home.heads);

  // ---- 2. リマインダー画面に出す ----
  await p.evaluate(() => go('reminder')); await p.waitForTimeout(350);
  const rem = await p.evaluate(() => {
    const lbls = [...document.querySelectorAll('#view .lbl')].map(e => e.textContent.trim().replace(/\s+/g, ' '));
    const l = [...document.querySelectorAll('#view .lbl')].find(x => /リマインド未登録/.test(x.textContent));
    const rows = l ? [...l.nextElementSibling.querySelectorAll('.list-row')] : [];
    return { lbls, count: rows.length,
      texts: rows.map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 24)),
      ons: rows.map(r => r.getAttribute('onclick')),
      heights: rows.map(r => Math.round(r.getBoundingClientRect().height)) };
  });
  ok('リマインダー画面に「リマインド未登録」がある', rem.lbls.some(x => /リマインド未登録/.test(x)), rem.lbls);
  ok('件数が見出しに出る', rem.lbls.some(x => /リマインド未登録 \(\d+\)/.test(x)), rem.lbls);
  ok('未登録の行が並ぶ', rem.count > 0, rem);
  ok('行から銘柄へ行ける', rem.ons.length > 0 && rem.ons.every(o => /^openStock\(/.test(o || '')), rem.ons);
  ok('行のタップ領域は44px以上', rem.heights.every(h => h >= 44), rem.heights);
  ok('日付が読める', rem.texts.every(t => /\d{4}\/\d{1,2}\/\d{1,2}/.test(t)), rem.texts);

  // ---- 3. 銘柄で絞り込んでいるときは、その銘柄の分だけ出す ----
  const filtered = await p.evaluate(() => {
    openRem('9001');
    const l = [...document.querySelectorAll('#view .lbl')].find(x => /リマインド未登録/.test(x.textContent));
    const rows = l ? [...l.nextElementSibling.querySelectorAll('.list-row')] : [];
    return { shown: rows.length, all: pendingHints().length,
      only9001: pendingHints().filter(x => x.stockId === '9001').length };
  });
  await p.waitForTimeout(250);
  ok('絞り込み中は、その銘柄の未登録だけを出す', filtered.shown === filtered.only9001, filtered);

  // ---- 4. 未登録が無いときは、区分ごと出さない(0件の見出しを残さない) ----
  const none = await p.evaluate(() => {
    go('reminder');
    (DB.hypotheses || []).forEach(h => { if (h.remindHint) h.remindHint = null; });
    save(); go('reminder');
    return { pend: pendingHints().length,
      hasLbl: [...document.querySelectorAll('#view .lbl')].some(x => /リマインド未登録/.test(x.textContent)) };
  });
  await p.waitForTimeout(250);
  ok('未登録が0件になった(テスト前提)', none.pend === 0, none);
  ok('未登録が無いときは区分ごと出さない', !none.hasLbl, none);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
