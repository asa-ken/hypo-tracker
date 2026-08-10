// 取り込みプレビュー: 表記揺れ(新しく増える指標)の告知。止めずに知らせる
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

const paste = body => `# 銘柄: テスト精機 (9001)\n${body}`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  const feed = async md => {
    await p.evaluate(() => go('import'));
    await p.waitForTimeout(250);
    await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, md);
    await p.waitForTimeout(250);
  };

  // ---- 既存の指標名だけなら、何も知らせない ----
  await feed(paste('## 業績推移\n- 売上高: 25年3月期=400000 | 26年3月期=460000 | 単位:百万円 | 2026/8/1'));
  ok('既知の指標だけなら警告を出さない', await p.evaluate(() => !document.querySelector('.metwarn')));
  ok('既知の指標だけならチップも出ない', await p.evaluate(() =>
    !/新しい指標/.test(document.querySelector('#parseOut').textContent)));

  // ---- 表記揺れ(売上) → 似た既存名を名指しする ----
  await feed(paste('## 業績推移\n- 売上: 25年3月期=400000 | 26年3月期=460000 | 単位:百万円 | 2026/8/1'));
  const box = await p.evaluate(() => {
    const e = document.querySelector('.metwarn');
    if (!e) return null;
    return { txt: e.textContent.replace(/\s+/g, ' ').trim(), hasIcon: !!e.querySelector('svg'),
             btn: !!e.querySelector('button') };
  });
  ok('表記揺れで警告が出る', !!box);
  ok('増える指標名を出す', /売上/.test(box.txt));
  ok('似た既存名を名指しする', /売上高/.test(box.txt));
  ok('どちらの一覧かが分かる', /業績推移/.test(box.txt));
  ok('絵文字ではなく線画アイコンを使う', box.hasIcon && !/⚠/.test(box.txt));
  ok('修正指示のコピーボタンがある', box.btn);
  ok('上部のチップにも件数が出る', await p.evaluate(() =>
    [...document.querySelectorAll('#parseOut .pill-row .chip')].some(c => /新しい指標 1/.test(c.textContent))));
  ok('チップは注意色(amber)になる', await p.evaluate(() =>
    [...document.querySelectorAll('#parseOut .pill-row .chip')].some(c => /新しい指標/.test(c.textContent) && c.classList.contains('amber'))));

  // ---- 位置: プレビューの表より上にある ----
  ok('警告はプレビューの表より上にある', await p.evaluate(() => {
    const w = document.querySelector('.metwarn').getBoundingClientRect().top;
    const t = document.querySelector('#parseOut table').getBoundingClientRect().top;
    return w < t;
  }));
  // 2026-08-10: 貼り付け結果は「取り込み前に確認してください」等の作業順の区分にまとめられ、
  // 警告(.metwarn)はその最初の区分の中に入った。区分の見出し分だけ銘柄チップとの間隔が空くため、
  // 正確な位置(px)ではなく「その区分がチップと表の間にある」ことを見る
  ok('警告は銘柄チップと同じ区分(取り込み前に確認してください)の中にある', await p.evaluate(() => {
    const warn = document.querySelector('.metwarn');
    const sec = warn.closest('.sec');
    const head = sec ? sec.querySelector(':scope > .h') : null;
    return !!head && /取り込み前に確認してください/.test(head.textContent);
  }));
  ok('その区分は銘柄チップのすぐ下にある(表より前)', await p.evaluate(() => {
    const c = document.querySelector('#parseOut .pill-row').getBoundingClientRect().bottom;
    const sec = document.querySelector('.metwarn').closest('.sec');
    const w = sec.getBoundingClientRect().top;
    return w - c >= 0 && w - c < 60;
  }));

  // ---- 止めない: 読み込むボタンは押せる ----
  ok('読み込むボタンは無効化されない', await p.evaluate(() => {
    const btn = [...document.querySelectorAll('#parseOut button')].find(x => /読み込む/.test(x.textContent));
    return !!btn && !btn.disabled;
  }));

  // ---- コピー文言 ----
  const fix = await p.evaluate(() => {
    let got = null;
    const orig = navigator.clipboard.writeText;
    navigator.clipboard.writeText = t => { got = t; return Promise.resolve(); };
    copyMetFix();
    navigator.clipboard.writeText = orig;
    return got;
  });
  ok('コピー文が正しい指標名へ誘導する', /「売上」ではなく「売上高」/.test(fix || ''));
  ok('コピー文に再発防止の指示が入る', /一字一句/.test(fix || ''));

  // ---- 似たものが無い新指標は、警告ではなく控えめな告知 ----
  await feed(paste('## 指標\n- ROIC: 8.4 | 単位:% | 2026/8/1'));
  ok('似た指標が無ければ警告箱は出さない', await p.evaluate(() => !document.querySelector('.metwarn')));
  ok('増えることは控えめに知らせる', await p.evaluate(() =>
    /新しい指標が 1件 増えます: ROIC/.test(document.querySelector('#parseOut').textContent)));
  ok('その場合のチップは注意色にしない', await p.evaluate(() =>
    [...document.querySelectorAll('#parseOut .pill-row .chip')].some(c => /新しい指標/.test(c.textContent) && !c.classList.contains('amber'))));

  // ---- スナップショットの表記揺れ ----
  await feed(paste('## 指標\n- 予想PER: 18.2 | 単位:倍 | 2026/8/1'));
  ok('スナップショット指標の揺れも拾う', await p.evaluate(() => {
    const e = document.querySelector('.metwarn'); return !!e && /PER\(予想\)/.test(e.textContent);
  }));
  ok('スナップショット側は「指標」と表示する', await p.evaluate(() => {
    const e = document.querySelector('.metwarn .r .chip'); return e && e.textContent.trim() === '指標';
  }));

  // ---- 同じ名前が複数行でも1件 ----
  await feed(paste('## 業績推移\n- 売上: 25年3月期=1 | 単位:百万円 | 2026/8/1\n- 売上: 26年3月期=2 | 単位:百万円 | 2026/8/1'));
  ok('同名が複数行でも1件だけ知らせる', await p.evaluate(() =>
    document.querySelectorAll('.metwarn .r').length === 1));

  // ---- 市場カードは業績推移を持たない ----
  await p.evaluate(() => go('import'));
  await p.waitForTimeout(200);
  await p.evaluate(() => {
    document.querySelector('#mdIn').value = '# テーマ: テスト市場・AIサイクル\n## 業績推移\n- 売上: 25年3月期=1 | 単位:百万円 | 2026/8/1';
    parseAndPreview();
  });
  await p.waitForTimeout(250);
  ok('市場カードでは業績推移の警告を出さない', await p.evaluate(() => !document.querySelector('.metwarn')));

  // ---- 実際に取り込めること(止めていない) ----
  await feed(paste('## 業績推移\n- 売上: 25年3月期=400000 | 単位:百万円 | 2026/8/1'));
  await p.evaluate(() => commitImport());
  await p.waitForTimeout(400);
  ok('警告が出ていても取り込める', await p.evaluate(() =>
    DB.metricsMaster.trend.some(t => t.name === '売上') && !!stock('9001').trend['売上']));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
