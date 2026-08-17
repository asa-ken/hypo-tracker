// 業績推移の取り込みは「対象項目(指標名)ごと丸ごと置き換え」ではなく「年度ごとの置き換え」
// というルールにする(ユーザー指示、2026-08-17)。以前は貼り付けにある年度だけの塊で
// s.trend[key] をまるごと入れ替えていたため、GPTの回答が一部の年度(例: 予想値だけ)しか
// 含まないと、残りの年度のデータが消えていた(実データで確認)。
// mergeTrendYear() による年度単位マージを、プレビューと実際の取り込みの両方で確認する。
const { chromium } = require('playwright');
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

  // ---- 1. プレビューの「更新後」列は、貼り付け分だけでなく既存年度とのマージ結果を出す ----
  await p.evaluate(() => go('import'));
  await p.waitForTimeout(250);
  const MD = '# 銘柄: テスト精機 (9001)\n## 業績推移\n- 売上高: 27年3月期(予)=999999 | 単位:百万円';
  await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, MD);
  await p.waitForTimeout(400);

  const preview = await p.evaluate(() => {
    const cells = [...document.querySelectorAll('#parseOut table td')].map(td => td.innerText);
    return cells.join('\n');
  });
  ok('プレビューの更新後に既存の他年度(24年3月期)が残る', /24年3月期=412800/.test(preview), preview);
  ok('プレビューの更新後に既存の他年度(25年3月期)が残る', /25年3月期=468300/.test(preview), preview);
  ok('プレビューの更新後に既存の他年度(26年3月期)が残る', /26年3月期=521000/.test(preview), preview);
  ok('プレビューの更新後に新しい値(27年3月期予)が入る', /27年3月期\(予\)=999999/.test(preview), preview);

  // ---- 2. 実際に取り込むと、貼り付けにない年度のデータは消えず、貼り付けた年度だけ更新される ----
  await p.evaluate(() => commitImport());
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => {
    const s = DB.stocks.find(x => x.code === '9001');
    return s.trend['売上高'];
  });
  ok('取り込み後、24年3月期は残る', after['24年3月期'] === '412800', after);
  ok('取り込み後、25年3月期は残る', after['25年3月期'] === '468300', after);
  ok('取り込み後、26年3月期は残る', after['26年3月期'] === '521000', after);
  ok('取り込み後、27年3月期(予)は新しい値に更新される', after['27年3月期(予)'] === '999999', after);
  ok('単位は維持される', after.unit === '百万円', after.unit);

  // ---- 3. 新規指標(既存データが無い)を貼り付けた場合も、指定した年度だけ入る ----
  await p.evaluate(() => go('import'));
  await p.waitForTimeout(250);
  const MD2 = '# 銘柄: テスト精機 (9001)\n## 業績推移\n- 受注残高: 26年3月期=8800 | 単位:百万円';
  await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, MD2);
  await p.waitForTimeout(300);
  await p.evaluate(() => commitImport());
  await p.waitForTimeout(400);
  const newInd = await p.evaluate(() => {
    const s = DB.stocks.find(x => x.code === '9001');
    return s.trend['受注残高'];
  });
  ok('新規指標は貼り付けた年度のみで作られる', newInd && newInd['26年3月期'] === '8800' && Object.keys(newInd).filter(k => k !== 'unit').length === 1, newInd);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
