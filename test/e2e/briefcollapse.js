// 取り込み画面「① このアプリの説明書をAIに渡す(最初の1回だけ)」は、完了状態を記憶せず
// 毎回全展開・中心ワークフロー「②会話を貼り付ける」と同じ視覚重量で最上部に居座り続けていた
// (DESIGN_PRINCIPLES.md「取り込み」: 中心ワークフローである②を優先すべき、に反する)。
//
// 同じ「低頻度・補助的な情報」を畳むという意図を持つ「困ったときは」セクションは既に .sec で
// 開閉できるのに、①だけ開閉できず一貫していなかった(一貫性=1)。
//
// 対応: ①を「困ったときは」と同じ低頻度セクションの開閉パターンに揃える。
// 見た目は②と同じ plain .lbl のまま保ち(ホームの太字区分見出しは使わない)、開閉だけを追加する。
// 初回(まだ説明書をコピーしていない)は展開、コピー済みなら次回訪問時から折りたたむ。
// 情報は削除しない(いつでもタップで再展開・再コピーできる)。
//
// ただし toggleGroup() は render() で画面全体を作り直すため、②の貼り付け欄に入力途中の
// テキストがあると消えてしまう。この画面では既存コードも同じ理由で render() を避け、
// parseAndPreview() で #parseOut だけを更新している。①の開閉もこれに合わせ、
// render() を呼ばずDOM操作だけで開閉することを検証する。
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

  const briefState = () => p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .lbl')].find(x => /① /.test(x.textContent));
    if (!head) return null;
    const body = head.nextElementSibling;
    const btn = body ? [...body.querySelectorAll('button')].find(b => /説明書をコピー/.test(b.textContent)) : null;
    return {
      headText: head.textContent.trim().replace(/\s+/g, ' '),
      bodyVisible: !!body && getComputedStyle(body).display !== 'none',
      copyBtnVisible: !!btn && btn.offsetParent !== null,
      caretOpen: head.querySelector('svg.caret').classList.contains('open'),
    };
  });

  // ---- 1. 初回(説明書を未コピー)は展開状態で、②も同一画面に見える ----
  await p.evaluate(() => go('import')); await p.waitForTimeout(250);
  const s0 = await briefState();
  ok('①の見出しが「① このアプリの説明書をAIに渡す(最初の1回だけ)」', /① このアプリの説明書をAIに渡す/.test(s0?.headText || ''), s0);
  ok('初回は展開されている(ヒント・コピーボタンが見える)', s0 && s0.bodyVisible && s0.copyBtnVisible, s0);
  ok('初回は矢尻が開いた向き', s0 && s0.caretOpen, s0);
  const step2Visible = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl')].find(x => /② 会話を貼り付ける/.test(x.textContent));
    return !!l;
  });
  ok('②の見出しも同時に存在する(情報は削っていない)', step2Visible);

  // ---- 2. 見出しをタップすると畳まれる(render()を経由しないDOM操作) ----
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .lbl')].find(x => /① /.test(x.textContent));
    head.click();
  });
  await p.waitForTimeout(150);
  const s1 = await briefState();
  ok('タップで畳まれる(ヒント・コピーボタンが消える)', s1 && !s1.bodyVisible && !s1.copyBtnVisible, s1);
  ok('畳むと矢尻が閉じた向きになる', s1 && !s1.caretOpen, s1);

  // ---- 3. もう一度タップすれば再展開できる(情報は消えていない、到達経路が残る) ----
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .lbl')].find(x => /① /.test(x.textContent));
    head.click();
  });
  await p.waitForTimeout(150);
  const s2 = await briefState();
  ok('再タップで再展開できる', s2 && s2.bodyVisible && s2.copyBtnVisible, s2);

  // ---- 4. #mdInに入力中でも①の開閉でその内容が消えない(render()を避けているかの検証) ----
  await p.evaluate(() => { document.querySelector('#mdIn').value = '入力途中のテキスト'; });
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .lbl')].find(x => /① /.test(x.textContent));
    head.click();
  });
  await p.waitForTimeout(150);
  const mdVal = await p.evaluate(() => document.querySelector('#mdIn').value);
  ok('①の開閉で②に入力済みのテキストが消えない', mdVal === '入力途中のテキスト', mdVal);
  // 元に戻す(次のケースに影響しないよう)
  await p.evaluate(() => { document.querySelector('#mdIn').value = ''; });
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .lbl')].find(x => /① /.test(x.textContent));
    if (!head.querySelector('svg.caret').classList.contains('open')) head.click();
  });
  await p.waitForTimeout(150);

  // ---- 5. 説明書をコピーすると、次回訪問時から畳まれた状態になる ----
  await p.evaluate(() => { window._copied = null; navigator.clipboard.writeText = (t) => { window._copied = t; return Promise.resolve(); }; });
  await p.evaluate(() => copyBriefing());
  await p.waitForTimeout(200);
  const afterCopy = await briefState();
  ok('コピー直後は(このセッション内では)まだ畳まれない(render()を呼んでいない証拠)', afterCopy && afterCopy.bodyVisible, afterCopy);
  const closedKeys = await p.evaluate(() => DB.uiPrefs.anaClosed.slice());
  ok('コピー後は次回用の畳み設定が保存される', closedKeys.includes('import:説明書'), closedKeys);

  // 画面を再訪問(go('import')を再実行)すると畳まれた状態で描画される
  await p.evaluate(() => go('home'));
  await p.waitForTimeout(150);
  await p.evaluate(() => go('import'));
  await p.waitForTimeout(250);
  const s3 = await briefState();
  ok('次回訪問時は①が畳まれた状態で始まる', s3 && !s3.bodyVisible, s3);
  ok('畳まれていても②はすぐ見える(情報は削っていない)', await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl')].find(x => /② 会話を貼り付ける/.test(x.textContent));
    return !!l && l.getBoundingClientRect().top < 844;
  }));

  // ---- 6. 畳んだ状態でも②の貼り付けボタン・textareaは44px以上を保つ ----
  // .lbl は「②会話を貼り付ける」のような非クリックの見出しにも付くクラスなので、
  // タップ領域として見るのは実際にクリック可能な要素(onclick付き)だけに絞る
  // (design.jsの観点Dが button/.list-row/.sub-row/.sec .h だけを見ているのと同じ考え方)
  const smallTap = await p.evaluate(() => [...document.querySelectorAll('#view button,#view textarea,#view .lbl[onclick]')]
    .map(e => { const r = e.getBoundingClientRect(); return { c: e.className, h: Math.round(r.height), w: Math.round(r.width) }; })
    .filter(x => x.w > 0 && x.h < 44));
  ok('畳んだ状態でも44px未満のタップ要素がない', smallTap.length === 0, smallTap);

  // ---- 7. 畳んだ状態でも再展開してコピーし直せる(到達経路が残る) ----
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .lbl')].find(x => /① /.test(x.textContent));
    head.click();
  });
  await p.waitForTimeout(150);
  const s4 = await briefState();
  ok('畳んだ状態からでも再展開してコピーボタンに到達できる', s4 && s4.bodyVisible && s4.copyBtnVisible, s4);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
