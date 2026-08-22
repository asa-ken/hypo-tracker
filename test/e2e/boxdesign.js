// 取り込み画面のカード(似た指標・読めなかった行・メモ候補)のデザイン刷新を検証する。
// ユーザー指摘: 「読めなかった行のエリアが似た名前の指標とデザインが違う」
//            「取り込む画面全般的に枠線やエリアの境界線が多くてビジー感がある」
// 対策(②案): 外枠(border)と行の区切り線を廃止し、見出し+説明文のエリア(.cbx-head)と
// 内訳のエリア(.cbx-body)を背景色の切り替えだけで示す。見出しの地色はメモ候補と同じ--bgに
// 統一し、警告であることの合図は色ではなく文字色・アイコン側で持たせる(ユーザー指示、2026-08-22)。
const { chromium } = require('playwright');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

const MD = `# 銘柄: テスト精機 (9001)
## 指標
- 配当利回り: 2.1 | 単位:% | 基準日 2026/8/20
- これは形式に沿っていない行です

これは見出しにも箇条書きにも当てはまらない自由文です。メモ候補として拾われます。
`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => go('import'));
  await p.waitForTimeout(250);
  await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, MD);
  await p.waitForTimeout(400);

  const boxes = await p.evaluate(() => {
    const get = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const head = el.querySelector('.cbx-head');
      const body = el.querySelector('.cbx-body');
      return {
        found: true,
        outerBorder: getComputedStyle(el).borderStyle,
        headBg: head ? getComputedStyle(head).backgroundColor : null,
        bodyBg: body ? getComputedStyle(body).backgroundColor : null,
        rowBorderTop: el.querySelector('.rrow') ? getComputedStyle(el.querySelector('.rrow')).borderTopStyle : null,
      };
    };
    return {
      metwarn: get('.candbox.metwarn'), // 似た指標(近い名前があるため必ず出る想定)
      memobox: get('.candbox.memobox'),
    };
  });

  ok('似た指標(.metwarn)は.candbox構造で見つかる', !!(boxes.metwarn && boxes.metwarn.found), boxes.metwarn);
  ok('メモ候補(.memobox)は.candbox構造で見つかる', !!(boxes.memobox && boxes.memobox.found), boxes.memobox);
  ok('似た指標の外枠(border)は無い', boxes.metwarn && (boxes.metwarn.outerBorder === 'none' || boxes.metwarn.outerBorder === ''), boxes.metwarn);
  ok('メモ候補の外枠(border)は無い', boxes.memobox && (boxes.memobox.outerBorder === 'none' || boxes.memobox.outerBorder === ''), boxes.memobox);
  ok('似た指標の行に区切り線(border-top)は無い', boxes.metwarn && (boxes.metwarn.rowBorderTop === 'none' || boxes.metwarn.rowBorderTop === ''), boxes.metwarn);
  ok('似た指標とメモ候補で、見出しエリアの背景色が同じ(クリーム色に差別化しない)', boxes.metwarn && boxes.memobox && boxes.metwarn.headBg === boxes.memobox.headBg, { metwarn: boxes.metwarn && boxes.metwarn.headBg, memobox: boxes.memobox && boxes.memobox.headBg });
  ok('見出しエリアと内訳エリアの背景色は異なる(領域の違いを背景色で示す)', boxes.metwarn && boxes.metwarn.headBg !== boxes.metwarn.bodyBg, boxes.metwarn);

  // ---- 読めなかった行が「似た指標」と同じ構造・同じ色になっている(元の指摘への対応) ----
  const failBoxInfo = await p.evaluate(() => {
    const boxes = [...document.querySelectorAll('.candbox.metwarn')];
    const failBox = boxes.find(b => /読めなかった行/.test(b.textContent));
    if (!failBox) return null;
    const head = failBox.querySelector('.cbx-head');
    const nearBox = boxes.find(b => /似た名前の指標/.test(b.textContent));
    const nearHead = nearBox ? nearBox.querySelector('.cbx-head') : null;
    return {
      hasCbxHead: !!head,
      hasCbxBody: !!failBox.querySelector('.cbx-body'),
      hasRrow: !!failBox.querySelector('.rrow'),
      sameHeadBgAsNear: nearHead ? getComputedStyle(head).backgroundColor === getComputedStyle(nearHead).backgroundColor : null,
      isOldFailboxClass: !!document.querySelector('.failbox'),
    };
  });
  ok('読めなかった行は.candbox(metwarn)構造で見つかる', !!failBoxInfo, failBoxInfo);
  ok('読めなかった行にも.cbx-head/.cbx-bodyがある', failBoxInfo && failBoxInfo.hasCbxHead && failBoxInfo.hasCbxBody, failBoxInfo);
  ok('読めなかった行の各行は.rrow(似た指標と同じ行の型)で表示される', failBoxInfo && failBoxInfo.hasRrow, failBoxInfo);
  ok('読めなかった行の見出し背景色は「似た指標」と同じ', failBoxInfo && failBoxInfo.sameHeadBgAsNear, failBoxInfo);
  ok('取り込み画面はもう旧.failboxを使っていない', failBoxInfo && !failBoxInfo.isOldFailboxClass, failBoxInfo);

  // ---- メモ候補が0件のときは、空のcbx-bodyを出さない ----
  await p.evaluate(() => { clearPaste(); });
  await p.waitForTimeout(200);
  await p.evaluate(t => { document.querySelector('#mdIn').value = '# 銘柄: テスト精機 (9001)\n## 指標\n- PBR: 3.5 | 基準日 2026/8/20'; parseAndPreview(); });
  await p.waitForTimeout(300);
  const emptyMemo = await p.evaluate(() => {
    const box = document.querySelector('.candbox.memobox');
    return { hasBody: !!(box && box.querySelector('.cbx-body')), text: box ? box.textContent : null };
  });
  ok('メモ候補0件のときは.cbx-bodyを出さない(空の白い余白を作らない)', !emptyMemo.hasBody, emptyMemo);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
