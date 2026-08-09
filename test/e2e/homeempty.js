// ホームの空状態の表し方が、他の画面と揃っていること(一貫性)
//
// 2026-08-09 の4区分再構成で、ホームだけ次の2点が他画面とずれた。
//  1. 同じ「空」を「なし」と「予定はありません」の2通りで書いていた
//  2. 市場・銘柄分析 / 取り込み / リマインダー一覧にはある .empty の案内が、ホームだけ無くなった
//     → 新規ユーザーが最初に見る画面が「(0) なし」の羅列になり、次にすることが分からない
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

  // ---- 1. 区分ごとの「空」は1通りの書き方に揃える ----
  // 期限切れを1件だけ持たせ、今日と今週の予定を空にする。
  // 「空の区分2つ」と「中身のある区分1つ」が同居し、画面全体は空ではない。
  // この状態でしか文言の混在は見えない(全部空にすると案内に置き換わるため)。
  // 今週の予定の空表現もここで検査対象に入る
  await p.evaluate(() => {
    DB.reminders = [{ id: 'r_he', stockId: '9001', hypoIds: [], title: '期限切れ検証', comment: null,
      cat: '決算プレビュー', freq: '単発 2020/1/1', times: ['08:30'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: 'p', src: 'テスト', srcDate: fmtToday(), log: [], nextFire: null }];
    save(); go('home');
  }); await p.waitForTimeout(350);
  const mixed = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#view .lbl.grp').forEach(l => {
      const n = l.nextElementSibling;
      if (n && !n.classList.contains('lbl') && /\(0\)/.test(l.textContent)) out.push(n.textContent.trim());
    });
    return out;
  });
  ok('空の区分が複数ある(テスト前提)', mixed.length >= 2, mixed);
  ok('空の区分の文言が1通りに揃っている', new Set(mixed).size === 1, mixed);

  // ---- 2. 市場・銘柄分析の空の区分と同じ言葉を使う ----
  // 「ウォッチ」を空にすると、あちらも同じ groupBlock で空の区分を描く
  const anaWord = await p.evaluate(() => {
    DB.stocks.filter(s => s.kind === 'ウォッチ').forEach(s => s.kind = '保有'); save(); go('analysis');
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /\(0\)/.test(x.textContent));
    return l ? l.nextElementSibling.textContent.trim() : null;
  });
  await p.waitForTimeout(250);
  ok('市場・銘柄分析にも空の区分がある(テスト前提)', !!anaWord, anaWord);
  ok('ホームと市場・銘柄分析で空の言葉が同じ', mixed[0] === anaWord, { home: mixed[0], analysis: anaWord });

  // ---- 3. 何も無いときは、他画面と同じ形の案内を出す ----
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  const zero = await p.evaluate(() => {
    const snap = t => { go(t); const v = document.querySelector('#view');
      const e = v.querySelector('.empty');
      return { empty: !!e, big: e ? !!e.querySelector('.big') : false,
               headline: e && e.querySelector('.big') ? e.querySelector('.big').textContent.trim() : null,
               guide: e ? e.textContent.replace(e.querySelector('.big') ? e.querySelector('.big').textContent : '', '').trim() : null };
    };
    DB.stocks = []; DB.reminders = []; DB.hypotheses = []; save();
    return { home: snap('home'), analysis: snap('analysis'), import: snap('import'), reminder: snap('reminder') };
  });
  await p.waitForTimeout(250);
  ok('市場・銘柄分析はゼロ状態に案内を出す(既存)', zero.analysis.empty);
  ok('取り込みはゼロ状態に案内を出す(既存)', zero.import.empty);
  ok('リマインダー一覧はゼロ状態に案内を出す(既存)', zero.reminder.empty);
  ok('ホームもゼロ状態に案内を出す', zero.home.empty, zero.home);
  ok('案内は他画面と同じ作り(.empty > .big の見出し)', zero.home.big, zero.home);
  ok('見出しに続けて次にすることを書く', !!zero.home.guide && zero.home.guide.length > 0, zero.home.guide);
  // 「まだ何もない」ことを責める言い方にしない(BACKGROUND 7.1 義務感を与えない)
  ok('案内に義務感を与える語を使わない',
    !/未取得|要更新|不足|してください。$/.test(zero.home.headline + ' ' + (zero.home.guide || '')),
    zero.home.headline);

  // ---- 4. 何かあるときは案内を出さない ----
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => go('home')); await p.waitForTimeout(300);
  const withData = await p.evaluate(() => ({
    empty: !!document.querySelector('#view .empty'),
    heads: document.querySelectorAll('#view .lbl.grp').length,
  }));
  ok('中身があるときはゼロ状態の案内を出さない', !withData.empty);
  ok('中身があるときは3区分の見出しが出る', withData.heads === 3, withData);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
