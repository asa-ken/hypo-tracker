// 貼り付け文に銘柄行が無いとき: プルダウンで選ぶと「更新前」も出る
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

// 銘柄行を付けない貼り付け(テスト精機は PER(予想)=18.4 / 売上高を保持している)
const NOHEAD = `## 指標
- PER(予想): 20.1 | 単位:倍 | 2026/8/7
- ROE: 15.2 | 単位:% | 2026/8/7
## 業績推移
- 売上高: 25年3月期=468300 | 26年3月期=521000 | 単位:百万円 | 2026/8/7`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  const rowsOf = () => p.evaluate(() =>
    [...document.querySelectorAll('#parseOut table tr')].slice(1).map(tr => ({
      name: tr.children[0].firstChild.textContent.trim(),
      before: tr.children[1].textContent.trim(),
      isNew: /新規/.test(tr.children[0].textContent),
    })));

  // ---- 銘柄行が無い状態で貼る ----
  await p.evaluate(() => go('import')); await p.waitForTimeout(250);
  await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, NOHEAD);
  await p.waitForTimeout(300);

  ok('銘柄を特定できないと出る', await p.evaluate(() =>
    /銘柄を特定できません/.test(document.querySelector('#parseOut').textContent)));
  ok('プルダウンが出る', await p.evaluate(() => !!document.querySelector('#importStockPick')));
  ok('選ぶ前は「更新前」を出せない旨を案内する', await p.evaluate(() =>
    /選ぶまでは比較相手が決まらない/.test(document.querySelector('#parseOut').textContent)));
  const pre = await rowsOf();
  ok('選ぶ前は更新前が空(全行が新規)', pre.length === 3 && pre.every(r => r.before === '—' && r.isNew));

  // ---- プルダウンで選ぶ ----
  await p.selectOption('#importStockPick', '9001');
  await p.waitForTimeout(350);
  const post = await rowsOf();
  ok('選ぶと更新前が出る', post.every(r => !(r.name === 'PER(予想)' && r.before === '—')));
  ok('PER(予想)の更新前は 18.4', /18\.4/.test((post.find(r => r.name === 'PER(予想)') || {}).before || ''));
  ok('ROEの更新前は 13.7', /13\.7/.test((post.find(r => r.name === 'ROE') || {}).before || ''));
  ok('既存の指標は「新規」と出なくなる', !post.find(r => r.name === 'PER(予想)').isNew);
  ok('業績推移の更新前も出る', /468300|412800/.test((post.find(r => r.name === '売上高') || {}).before || ''));

  // ---- 選んだ状態が画面に残る ----
  ok('プルダウンの選択が保たれる', await p.evaluate(() => document.querySelector('#importStockPick').value === '9001'));
  ok('チップが取り込み先を示す', await p.evaluate(() =>
    /対象の銘柄: テスト精機 に取り込みます/.test(document.querySelector('#parseOut').textContent)));
  ok('チップが緑になる', await p.evaluate(() => {
    const c = [...document.querySelectorAll('#parseOut .pill-row .chip')].find(x => /対象の銘柄/.test(x.textContent));
    return !!c && c.classList.contains('green');
  }));
  // 2026-08-11: 「読取N行」チップは、それ単体を見ても取り込み判断の材料にならないため削除した(ユーザー指摘)
  ok('選び直せるようプルダウンは残る', await p.evaluate(() => !!document.querySelector('#importStockPick')));
  ok('案内文が切り替わる', await p.evaluate(() =>
    /選び直すと、読み込みプレビューの「更新前」も/.test(document.querySelector('#parseOut').textContent)));

  // ---- 選び直すと比較相手も変わる ----
  await p.selectOption('#importStockPick', '9002');   // サンプル半導体(PER(予想)を持たない)
  await p.waitForTimeout(350);
  const p2 = await rowsOf();
  ok('別の銘柄に切り替わる', await p.evaluate(() =>
    /対象の銘柄: サンプル半導体/.test(document.querySelector('#parseOut').textContent)));
  ok('切替先が持つ値に入れ替わる', /31\.6/.test(p2.find(r => r.name === 'PER(予想)').before));
  ok('切替先が持つ指標は更新前が出る', /298000|352000/.test((p2.find(r => r.name === '売上高') || {}).before || ''));

  // ---- 「— 選択 —」に戻せる ----
  await p.selectOption('#importStockPick', '');
  await p.waitForTimeout(350);
  ok('未選択に戻すと警告表示に戻る', await p.evaluate(() =>
    /銘柄を特定できません/.test(document.querySelector('#parseOut').textContent)));
  ok('未選択に戻すと更新前も消える', (await rowsOf()).every(r => r.before === '—'));

  // ---- 表記揺れの警告も選択後に働く ----
  await p.evaluate(() => { document.querySelector('#mdIn').value = '## 業績推移\n- 売上: 25年3月期=1 | 単位:百万円 | 2026/8/7'; parseAndPreview(); });
  await p.waitForTimeout(300);
  ok('選ぶ前は表記揺れの警告を出さない', await p.evaluate(() => !document.querySelector('.metwarn')));
  await p.selectOption('#importStockPick', '9001');
  await p.waitForTimeout(350);
  ok('選ぶと表記揺れの警告が出る', await p.evaluate(() => {
    const e = document.querySelector('.metwarn'); return !!e && /売上高/.test(e.textContent);
  }));

  // ---- 選んだ銘柄に実際に取り込まれる ----
  await p.evaluate(() => { document.querySelector('#mdIn').value = '## 指標\n- PER(予想): 22.2 | 単位:倍 | 2026/8/7'; parseAndPreview(); });
  await p.waitForTimeout(250);
  await p.selectOption('#importStockPick', '9003');   // ダミー商事
  await p.waitForTimeout(300);
  await p.evaluate(() => commitImport());
  await p.waitForTimeout(500);
  ok('選んだ銘柄に取り込まれる', await p.evaluate(() => stock('9003').metrics['PER(予想)'].v === '22.2'));
  ok('ほかの銘柄は書き換わらない', await p.evaluate(() => stock('9001').metrics['PER(予想)'].v === '18.4'));

  // ---- 画面を移ると選択は持ち越さない ----
  await p.evaluate(() => go('home')); await p.waitForTimeout(250);
  await p.evaluate(() => go('import')); await p.waitForTimeout(250);
  ok('タブを移ると選択がリセットされる', await p.evaluate(() => !STATE._importPick));
  await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, NOHEAD);
  await p.waitForTimeout(300);
  ok('新しい貼り付けは未選択から始まる', await p.evaluate(() =>
    document.querySelector('#importStockPick').value === ''));

  // ---- クリアでも選択が消える ----
  await p.selectOption('#importStockPick', '9001'); await p.waitForTimeout(300);
  await p.evaluate(() => clearPaste()); await p.waitForTimeout(200);
  ok('クリアで選択も消える', await p.evaluate(() => !STATE._importPick));

  // ---- 銘柄行がある場合は従来どおり(プルダウンを出さない) ----
  await p.evaluate(() => { document.querySelector('#mdIn').value = '# 銘柄: テスト精機 (9001)\n## 指標\n- PER(予想): 20.1 | 単位:倍 | 2026/8/7'; parseAndPreview(); });
  await p.waitForTimeout(300);
  ok('銘柄行があればプルダウンは出ない', await p.evaluate(() => !document.querySelector('#importStockPick')));
  ok('銘柄行があれば従来どおり更新前が出る', /18\.4/.test((await rowsOf())[0].before));

  // ---- 「銘柄またはテーマ:」見出し(genOrderNewが対象未選択時に埋め込むプレースホルダー) ----
  // 2026-08-13: このプレースホルダーをAIがそのまま使って回答すると「銘柄またはテーマ:」という
  // 見出しになり、従来は「銘柄:」「テーマ:」に一致せず「銘柄を特定できません」に落ちて
  // 新規登録ボタンも出なかった(ユーザー報告)。コード付きなら銘柄、無ければテーマとして読む
  await p.evaluate(() => { document.querySelector('#mdIn').value =
    '# 銘柄またはテーマ: 日東工器（6151）／AIデータセンター液冷技術\n## 指標\n- PBR: 3.2 | 単位:倍 | 2026/8/13';
    parseAndPreview(); });
  await p.waitForTimeout(300);
  ok('「銘柄またはテーマ:」もコード付きなら銘柄として認識する(特定できませんに落ちない)', await p.evaluate(() =>
    /未登録: 日東工器/.test(document.querySelector('#parseOut').textContent)));
  ok('未登録の銘柄なら新規登録ボタンが出る', await p.evaluate(() =>
    [...document.querySelectorAll('#parseOut button')].some(b => /新規銘柄として登録/.test(b.textContent))));

  await p.evaluate(() => { document.querySelector('#mdIn').value =
    '# 銘柄またはテーマ: AIデータセンター液冷技術\n## 指標\n- 市場規模: 1.2 | 単位:兆円 | 2026/8/13';
    parseAndPreview(); });
  await p.waitForTimeout(300);
  ok('コードが無ければテーマとして認識する', await p.evaluate(() =>
    /未登録: AIデータセンター液冷技術/.test(document.querySelector('#parseOut').textContent)));
  ok('テーマなら新規テーマ登録ボタンが出る', await p.evaluate(() =>
    [...document.querySelectorAll('#parseOut button')].some(b => /新規テーマとして登録/.test(b.textContent))));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
