// 分析トップの「ざっくりまとめ」(旧:エグゼクティブサマリー)の一連を確認
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

const MD_SUMMARY = `# 銘柄: テスト精機 (9001)

## ざっくりまとめ
- 本文: 受注残は堅調だが、中国向け売上の減速が次の決算の焦点。 | 2026/7/28

## 分析
- ビジネスモデル(サマリ): 装置と消耗品を組み合わせて売る構造。 | 2026/7/28
`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  // ---- 1. 銘柄詳細: 分析のトップに出る ----
  const sid = await p.evaluate(() => { const s = DB.stocks.find(x => x.name === 'テスト精機'); openStock(s.id); return s.id; });
  await p.waitForTimeout(300);
  const pos = await p.evaluate(() => {
    const v = document.querySelector('#view');
    const lbl = [...v.querySelectorAll('.lbl')].find(x => x.textContent.trim().startsWith('分析'));
    const cardText = [...v.querySelectorAll('.card')].map(c => c.textContent).find(t => /ざっくりまとめ/.test(t));
    const firstSec = v.querySelector('.sec');
    return {
      hasLabel: !!lbl,
      hasCard: !!cardText,
      cardBeforeSec: (() => {
        const cards = [...v.children];
        const summaryCard = cards.find(c => /ざっくりまとめ/.test(c.textContent) && c.classList.contains('card'));
        if (!summaryCard || !firstSec) return null;
        return Array.from(v.children).indexOf(summaryCard) < Array.from(v.children).indexOf(firstSec);
      })(),
    };
  });
  ok('「分析」見出しがある', pos.hasLabel);
  ok('「ざっくりまとめ」カードが出る', pos.hasCard);

  // ---- 3. 空のときの案内文 ----
  const emptyText = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('空のときは「まだありません」の案内', /まだありません。会話を取り込むと/.test(emptyText));
  ok('空のときも「エグゼクティブサマリー」は出ない', !/エグゼクティブサマリー/.test(emptyText));

  // ---- 4. 手動編集 ----
  await p.evaluate(sid => sheetSummary(sid), sid);
  await p.waitForTimeout(200);
  const sheetText = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok('編集シートのタイトルは「ざっくりまとめ」', /ざっくりまとめ/.test(sheetText));
  ok('編集シートの説明も平易(専門用語なし)', /この会社を一言でどう見ているか/.test(sheetText));
  await p.evaluate(() => { document.querySelector('#sm_t').value = '受注残は堅調。価格転嫁の遅れが利益率の重し。'; doSaveSummary(document.querySelector('#sm_t').closest('.sheet') ? STATE.stockId : null); });
  await p.waitForTimeout(300);
  const afterSave = await p.evaluate(() => stock(STATE.stockId).summary);
  ok('保存すると s.summary に入る', afterSave && afterSave.t === '受注残は堅調。価格転嫁の遅れが利益率の重し。');
  const rendered = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('保存後は本文が表示される', /受注残は堅調。価格転嫁の遅れが利益率の重し。/.test(rendered));

  // 削除
  await p.evaluate(sid => sheetSummary(sid), sid);
  await p.waitForTimeout(200);
  await p.evaluate(sid => delSummary(sid), sid);
  await p.waitForTimeout(300);
  ok('削除すると空状態に戻る', await p.evaluate(() => !stock(STATE.stockId).summary));

  // ---- 5. 取り込み(パース→プレビュー→保存) ----
  await p.evaluate(() => go('import'));
  await p.waitForTimeout(200);
  await p.evaluate(md => { document.querySelector('#mdIn').value = md; parseAndPreview(); }, MD_SUMMARY);
  await p.waitForTimeout(300);
  const preview = await p.evaluate(() => document.querySelector('#parseOut').innerText);
  ok('プレビューに「ざっくりまとめ」が新規行として出る', /ざっくりまとめ/.test(preview) && /新規/.test(preview));
  await p.evaluate(() => commitImport());
  await p.waitForTimeout(400);
  const committed = await p.evaluate(() => stock(DB.stocks.find(s => s.name === 'テスト精機').id).summary);
  ok('取り込みで s.summary に保存される', committed && /受注残は堅調/.test(committed.t));

  // ---- 6. 同一内容の再取り込みは「変更なし」扱い ----
  await p.evaluate(() => go('import'));
  await p.waitForTimeout(200);
  await p.evaluate(md => { document.querySelector('#mdIn').value = md; parseAndPreview(); }, MD_SUMMARY);
  await p.waitForTimeout(300);
  const preview2 = await p.evaluate(() => document.querySelector('#parseOut').innerText);
  ok('同じ内容の再取り込みは「変更なし」と出る', /変更なし/.test(preview2));

  // ---- 7. 説明書(プロンプト)に反映されている ----
  const brief = await p.evaluate(() => briefingText());
  ok('説明書に「ざっくりまとめ」の書式が載る', /## ざっくりまとめ/.test(brief) && /- 本文: 1〜2文で全体像/.test(brief));
  ok('説明書で「■ ざっくりまとめ」が「■ 分析」より先に来る', brief.indexOf('■ ざっくりまとめ') < brief.indexOf('■ 分析(定性的な内容)'));
  ok('説明書に平易な言葉で書く指示がある', /専門用語.*使わずに書いて/.test(brief));
  ok('説明書に「エグゼクティブサマリー」という語は出ない', !/エグゼクティブサマリー/.test(brief));

  // ---- 8. 市場カードでも同様に出る ----
  const mktCheck = await p.evaluate(() => {
    const s = DB.stocks.find(x => x.kind === '市場'); openStock(s.id);
    return document.querySelector('#view').innerText;
  });
  await p.waitForTimeout(200);
  ok('市場カードにも「ざっくりまとめ」が出る', /ざっくりまとめ/.test(mktCheck));
  ok('市場カードの空状態は「この市場」という文言になる', /この市場を一言で/.test(mktCheck));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
