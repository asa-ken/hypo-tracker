// 取り込み画面「① このアプリの説明書をAIに渡す(最初の1回だけ)」は、完了状態を記憶せず
// 毎回全展開・中心ワークフロー「②会話を貼り付ける」と同じ視覚重量で最上部に居座り続けていた
// (DESIGN_PRINCIPLES.md「取り込み」: 中心ワークフローである②を優先すべき、に反する)。
//
// 同じ「低頻度・補助的な情報」を畳むという意図を持つ「困ったときは」セクションは既に .sec で
// 開閉できるのに、①だけ開閉できず一貫していなかった(一貫性=1)。
//
// 対応: ①を「困ったときは」と同じ .sec / .sec.open の開閉パターンに揃える(2026-08-10、PR#112)。
// 当初は「初回(まだ説明書をコピーしていない)は展開、コピー済みなら次回訪問時から折りたたむ」
// だったが、2026-08-22にユーザー指摘で見直した:①は最初の1回使えばよく、②(会話を貼り付ける)
// ほど使用頻度が高くない。「コピーするまでは開いていた方が見つけやすい」という前提自体を
// 疑い、初回から畳んだ状態で始めるように変更した。情報は削除しない(いつでもタップで
// 再展開・再コピーできる)。一度でも自分で開いたことがあれば(DB.uiPrefs.briefEverOpened)、
// 以降は通常の開閉記憶(closedGroups)に従う。「自分で開いたのに次に見たらまた畳まれていた」
// という逆向きの驚きを避けるため。
//
// ただし toggleGroup() は render() で画面全体を作り直すため、②の貼り付け欄に入力途中の
// テキストがあると消えてしまう。この画面では既存コードも同じ理由で render() を避け、
// parseAndPreview() で #parseOut だけを更新している。①の開閉もこれに合わせ、
// render() を呼ばずDOM操作だけで開閉することを検証する。
//
// 2026-08-10 追記(ユーザー指摘): ①②困ったときはの3区分は同格なのに、当初は①②を
// 軽い .lbl、困ったときはを重い .sec .h と見た目が揃っていなかった。加えて①の中の入れ子
// 「説明書の中身を見る」が親の①より重く見える階層の逆転も起きていた。
// ①②困ったときはを同じ重さ(.sec .h相当)に揃え、中身を見るはそれより軽い見た目に格下げした。
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

  // ①の見出しは「困ったときは」と同じ .sec > .h 構造になった
  const briefState = () => p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .sec > .h')].find(x => /① /.test(x.textContent));
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

  // ---- 1. 初回(未使用)は畳まれた状態で始まり、②はすぐ見える ----
  await p.evaluate(() => go('import')); await p.waitForTimeout(250);
  const s0 = await briefState();
  ok('①の見出しが「① このアプリの説明書をAIに渡す(最初の1回だけ)」', /① このアプリの説明書をAIに渡す/.test(s0?.headText || ''), s0);
  ok('初回は畳まれている(ヒント・コピーボタンが見えない)', s0 && !s0.bodyVisible && !s0.copyBtnVisible, s0);
  ok('初回は矢尻が閉じた向き', s0 && !s0.caretOpen, s0);
  const step2Visible = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl')].find(x => /② 会話を貼り付ける/.test(x.textContent));
    return !!l && l.getBoundingClientRect().top < 844;
  });
  ok('②の見出しがすぐ見える(①を開かなくても中心ワークフローに到達できる)', step2Visible);

  // ---- 2. 見出しをタップすると展開する(render()を経由しないDOM操作) ----
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .sec > .h')].find(x => /① /.test(x.textContent));
    head.click();
  });
  await p.waitForTimeout(150);
  const s1 = await briefState();
  ok('タップで展開する(ヒント・コピーボタンが見える)', s1 && s1.bodyVisible && s1.copyBtnVisible, s1);
  ok('展開すると矢尻が開いた向きになる', s1 && s1.caretOpen, s1);
  ok('自分で開いたことがDB.uiPrefs.briefEverOpenedに記録される', await p.evaluate(() => !!DB.uiPrefs.briefEverOpened));

  // ---- 3. もう一度タップすれば畳める(情報は消えていない、到達経路が残る) ----
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .sec > .h')].find(x => /① /.test(x.textContent));
    head.click();
  });
  await p.waitForTimeout(150);
  const s2 = await briefState();
  ok('再タップで畳める', s2 && !s2.bodyVisible && !s2.copyBtnVisible, s2);

  // ---- 3b. 一度開いたことがあれば、コピーせず再訪問しても畳まれたまま(直前に閉じた状態を記憶) ----
  await p.evaluate(() => go('home')); await p.waitForTimeout(150);
  await p.evaluate(() => go('import')); await p.waitForTimeout(250);
  const s2b = await briefState();
  ok('直前に自分で畳んだ状態は、再訪問後も引き継がれる', s2b && !s2b.bodyVisible, s2b);

  // ---- 3c. 逆に開いたまま離れれば、再訪問時も開いたまま(強制的に畳み直さない) ----
  // briefEverOpenedが立っている限り、初回専用の「強制的に畳む」処理は効かなくなることを確認する
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .sec > .h')].find(x => /① /.test(x.textContent));
    head.click();
  });
  await p.waitForTimeout(150);
  await p.evaluate(() => go('home')); await p.waitForTimeout(150);
  await p.evaluate(() => go('import')); await p.waitForTimeout(250);
  const s2c = await briefState();
  ok('自分で開いたまま離れた場合は、再訪問後も開いたまま(逆向きの驚きが無い)', s2c && s2c.bodyVisible, s2c);

  // ---- 4. #mdInに入力中でも①の開閉でその内容が消えない(render()を避けているかの検証) ----
  await p.evaluate(() => { document.querySelector('#mdIn').value = '入力途中のテキスト'; });
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .sec > .h')].find(x => /① /.test(x.textContent));
    head.click();
  });
  await p.waitForTimeout(150);
  const mdVal = await p.evaluate(() => document.querySelector('#mdIn').value);
  ok('①の開閉で②に入力済みのテキストが消えない', mdVal === '入力途中のテキスト', mdVal);
  // 元に戻す(次のケースに影響しないよう)
  await p.evaluate(() => { document.querySelector('#mdIn').value = ''; });
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .sec > .h')].find(x => /① /.test(x.textContent));
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
  const smallTap = await p.evaluate(() => [...document.querySelectorAll('#view button,#view textarea,#view .sec > .h,#view .lbl')]
    .map(e => { const r = e.getBoundingClientRect(); return { c: e.className, h: Math.round(r.height), w: Math.round(r.width) }; })
    .filter(x => x.w > 0 && x.h < 44));
  ok('畳んだ状態でも44px未満のタップ要素がない', smallTap.length === 0, smallTap);

  // ---- 7. 畳んだ状態でも再展開してコピーし直せる(到達経路が残る) ----
  await p.evaluate(() => {
    const head = [...document.querySelectorAll('#view .sec > .h')].find(x => /① /.test(x.textContent));
    head.click();
  });
  await p.waitForTimeout(150);
  const s4 = await briefState();
  ok('畳んだ状態からでも再展開してコピーボタンに到達できる', s4 && s4.bodyVisible && s4.copyBtnVisible, s4);

  // ---- 8. 階層: ①②は同格なので見た目の重さが揃っている ----
  // 2026-08-11: 「調べることが思いつかない時は」は①②と同格の独立区分だったが、実際には
  // ①(説明書を渡す)に付随する補助機能のため、①の入れ子(「説明書の中身を見る」と同じ階層)に
  // 移した(ユーザー指摘)。同格の区分は①②の2つだけになった
  const hier = await p.evaluate(() => {
    const pick = (re) => {
      const el = [...document.querySelectorAll('#view .sec > .h, #view .lbl')].find(x => re.test(x.textContent));
      if (!el) return null;
      const st = getComputedStyle(el);
      return { fontSize: st.fontSize, color: st.color, fontWeight: st.fontWeight, borderTop: st.borderTopWidth };
    };
    return { s1: pick(/① /), s2: pick(/② /) };
  });
  ok('①②の見出しは同じ文字サイズ', hier.s1 && hier.s2 && hier.s1.fontSize === hier.s2.fontSize, hier);
  ok('①②の見出しは同じ文字色', hier.s1 && hier.s2 && hier.s1.color === hier.s2.color, hier);
  ok('①②の見出しは同じ太さの上枠線', hier.s1 && hier.s2 &&
    hier.s1.borderTop === hier.s2.borderTop && parseFloat(hier.s1.borderTop) > 0, hier);

  // ---- 9. 階層: 「説明書の中身を見る」「調べることが思いつかない時は」は入れ子なので①より軽い見た目 ----
  // 2つの入れ子項目は互いに同じ軽さで揃っている
  const nested = await p.evaluate(() => {
    const s1 = [...document.querySelectorAll('#view .sec > .h')].find(x => /① /.test(x.textContent));
    const inner1 = [...document.querySelectorAll('#view .sec .sec > .h')].find(x => /説明書の中身を見る/.test(x.textContent));
    const inner2 = [...document.querySelectorAll('#view .sec .sec > .h')].find(x => /調べることが思いつかない時は/.test(x.textContent));
    const g = (el) => { const st = getComputedStyle(el); return { fontSize: parseFloat(st.fontSize), color: st.color, borderTop: st.borderTopWidth }; };
    return { outer: s1 ? g(s1) : null, inner1: inner1 ? g(inner1) : null, inner2: inner2 ? g(inner2) : null,
             inner2InsideOuter: inner2 ? !!inner2.closest('.sec > .b .sec') : false };
  });
  ok('「説明書の中身を見る」は①より文字が小さい(入れ子として軽い見た目)',
    nested.outer && nested.inner1 && nested.inner1.fontSize < nested.outer.fontSize, nested);
  ok('「説明書の中身を見る」は①と違う(薄い)文字色', nested.outer && nested.inner1 && nested.inner1.color !== nested.outer.color, nested);
  ok('「調べることが思いつかない時は」も①の入れ子で、同じ軽さ',
    nested.inner1 && nested.inner2 && nested.inner1.fontSize === nested.inner2.fontSize && nested.inner1.color === nested.inner2.color, nested);
  ok('「調べることが思いつかない時は」は①の中(入れ子)にある', nested.inner2InsideOuter, nested);

  // ---- 9b. 展開記号: 入れ子2項目は矢尻ではなく＋×(plusSvg)を使う ----
  const marks = await p.evaluate(() => {
    const has = (re, sel) => { const h = [...document.querySelectorAll('#view .sec .sec > .h')].find(x => re.test(x.textContent)); return h ? !!h.querySelector(sel) : false; };
    return {
      innerHasPlus: has(/説明書の中身を見る/, 'svg.plusmark') && has(/調べることが思いつかない時は/, 'svg.plusmark'),
      innerHasCaret: has(/説明書の中身を見る/, 'svg.caret') || has(/調べることが思いつかない時は/, 'svg.caret'),
    };
  });
  ok('入れ子2項目は矢尻ではなく＋×を使う', marks.innerHasPlus && !marks.innerHasCaret, marks);

  // ---- 10. バグ修正: ①が開いていても「説明書の中身を見る」自体の開閉ボタンが機能する ----
  // .sec .b / .sec.open .b が子孫セレクタだと、外側①の.sec.openが内側(入れ子)の.h/.bにも
  // 一致してしまい、内側を畳んでも外側が開いている限り中身が強制的に見えたままになる
  // (ユーザー報告: 「説明書を見る展開ボタンが機能してない」)。.sec > .h / .sec > .b(直下)に
  // 絞ることで、内側の開閉が外側の状態に引きずられないことを検証する
  await p.evaluate(() => {
    // ①を確実に開いた状態にする
    const outer = [...document.querySelectorAll('#view .sec')].find(s => /① /.test(s.querySelector(':scope > .h').textContent));
    if (!outer.classList.contains('open')) outer.querySelector(':scope > .h').click();
  });
  await p.waitForTimeout(150);
  const nestedState = () => p.evaluate(() => {
    const innerH = [...document.querySelectorAll('#view .sec .sec > .h')].find(x => /説明書の中身を見る/.test(x.textContent));
    const innerSec = innerH.closest('.sec');
    const innerB = innerSec.querySelector(':scope > .b');
    return { open: innerSec.classList.contains('open'), bodyVisible: getComputedStyle(innerB).display !== 'none' };
  });
  const beforeToggle = await nestedState();
  ok('①が開いていても、中身を見るは最初は閉じている(外側に引きずられない)', !beforeToggle.open && !beforeToggle.bodyVisible, beforeToggle);
  await p.evaluate(() => {
    const innerH = [...document.querySelectorAll('#view .sec .sec > .h')].find(x => /説明書の中身を見る/.test(x.textContent));
    innerH.click();
  });
  await p.waitForTimeout(150);
  const afterOpen = await nestedState();
  ok('中身を見るをタップすると開く(展開ボタンが機能する)', afterOpen.open && afterOpen.bodyVisible, afterOpen);
  await p.evaluate(() => {
    const innerH = [...document.querySelectorAll('#view .sec .sec > .h')].find(x => /説明書の中身を見る/.test(x.textContent));
    innerH.click();
  });
  await p.waitForTimeout(150);
  const afterClose = await nestedState();
  ok('もう一度タップすると畳める', !afterClose.open && !afterClose.bodyVisible, afterClose);

  // ---- 11. 「調べることが思いつかない時は」も同じ入れ子構造で独立して開閉できる ----
  const otherState = () => p.evaluate(() => {
    const h = [...document.querySelectorAll('#view .sec .sec > .h')].find(x => /調べることが思いつかない時は/.test(x.textContent));
    const sec = h.closest('.sec');
    const body = sec.querySelector(':scope > .b');
    return { open: sec.classList.contains('open'), bodyVisible: getComputedStyle(body).display !== 'none' };
  });
  const otherBefore = await otherState();
  ok('①が開いていても、調べることが思いつかない時はは最初は閉じている', !otherBefore.open && !otherBefore.bodyVisible, otherBefore);
  await p.evaluate(() => {
    const h = [...document.querySelectorAll('#view .sec .sec > .h')].find(x => /調べることが思いつかない時は/.test(x.textContent));
    h.click();
  });
  await p.waitForTimeout(150);
  const otherAfter = await otherState();
  ok('調べることが思いつかない時はをタップすると開く', otherAfter.open && otherAfter.bodyVisible, otherAfter);
  ok('調べる項目を選ぶボタンに到達できる', await p.evaluate(() => !!document.querySelector('#view button[onclick^="sheetOrderNew"]')));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
