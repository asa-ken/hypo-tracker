// 取り込みプレビューで、日付つきの注目ポイントをリマインダーにするか決める
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

const MD = `# 銘柄: テスト精機 (9001)
## 注目ポイント
- 本文: 1Q決算で受注残が前年同期を上回って維持できているか。
- イベント日: 2026/11/12
## 注目ポイント
- 本文: 最大顧客1社への依存が3割のまま。
- イベント日: 2026/11/12
## 注目ポイント
- 本文: 次期中計での設備投資計画。
- イベント日: 2026/9/18
## 注目ポイント
- 本文: 日付のない観点。競合の新型機が出たときの価格競争。`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');

  const feed = async () => {
    await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
    await p.reload(); await p.waitForTimeout(400);
    await p.evaluate(() => go('import')); await p.waitForTimeout(220);
    await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); }, MD);
    await p.waitForTimeout(320);
  };
  // 2026-08-10: 日付(.d)/本文(.b)という独自クラス名を、個別銘柄側のリマインダー一覧と
  // 同じ.ttl(本文)/.meta(日付)に統一した(同じ機能は同じデザインにする、ユーザー指摘)
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#parseOut .rembox .rrow')].map(e => ({
    on: e.querySelector('.sw').classList.contains('on'),
    date: e.querySelector('.meta').textContent.trim(),
    text: e.querySelector('.ttl').textContent.trim().slice(0, 12),
  })));

  await feed();

  // ---- 欄が出る ----
  // 2026-08-11: 見出しは区分名「取り込むリマインダー/メモを選択してください」と語を合わせ、
  // 「日付つきの注目ポイント」→「リマインダー登録」に変更した(ユーザー指摘)。
  // 取り込み元(日付ありの注目ポイント)の説明は下の案内文に移した
  ok('リマインダー欄が出る', await p.evaluate(() => !!document.querySelector('#parseOut .rembox')));
  ok('件数を出す(区分名と語を合わせた見出し)', await p.evaluate(() =>
    /リマインダー登録 3件/.test(document.querySelector('#parseOut .rembox').textContent)));
  ok('取り込み元(注目ポイント)の説明が案内文にある', await p.evaluate(() =>
    /日付ありの注目ポイントを/.test(document.querySelector('#parseOut .rembox').textContent)));
  const r0 = await rows();
  ok('日付つきの3件だけ並ぶ', r0.length === 3);
  ok('日付のない注目ポイントは並ばない', !r0.some(x => /日付のない/.test(x.text)));
  ok('既定はすべてオン', r0.every(x => x.on));
  ok('まとまる旨を案内する', await p.evaluate(() =>
    /同じ日は1つにまとまります/.test(document.querySelector('#parseOut .rembox').textContent)));
  ok('プレビューの表より上にある', await p.evaluate(() =>
    document.querySelector('#parseOut .rembox').getBoundingClientRect().top
    < document.querySelector('#parseOut table').getBoundingClientRect().top));
  // 2026-08-22(3周目レビューで発見): この検査は.rrow(外側の行)の高さしか見ておらず、
  // .rrowはCSSのmin-height:44pxで常に44px以上になるため、実際のタップ対象である
  // .tx(本文)と.swtap(トグル)がその内側で18px/28pxまで縮んでいても検出できなかった
  // (border-box内のpaddingがalign-self:stretchの計算対象から外れるため)。
  // .rrowではなく実際にonclickを持つ.tx/.swtapそれぞれの高さを見るよう修正した
  ok('本文(.tx)のタップ領域は44px以上', await p.evaluate(() =>
    [...document.querySelectorAll('#parseOut .rembox .rrow .tx')].every(e => e.getBoundingClientRect().height >= 44)));
  ok('トグル(.swtap)のタップ領域は44px以上', await p.evaluate(() =>
    [...document.querySelectorAll('#parseOut .rembox .rrow .swtap')].every(e => e.getBoundingClientRect().height >= 44)));
  // 2026-08-10: トグルは左側にあり一般的なON/OFF配置(ラベル左・トグル右)と逆だった(ユーザー指摘)。
  // 本文・日付(.tx)を左、つまみ(.sw)を右に置くよう直したので、位置関係を実測で固定する
  ok('つまみはラベルより右側にある(一般的なトグル配置)', await p.evaluate(() => {
    const row = document.querySelector('#parseOut .rembox .rrow');
    const tx = row.querySelector('.tx').getBoundingClientRect();
    const sw = row.querySelector('.sw').getBoundingClientRect();
    return sw.left > tx.left;
  }));

  // ---- 個別に切り替え ----
  await p.evaluate(() => document.querySelectorAll('#parseOut .rembox .rrow')[2].querySelector('.swtap').click());
  await p.waitForTimeout(300);
  const r1 = await rows();
  ok('押した行だけオフになる', r1[2].on === false && r1[0].on && r1[1].on);
  ok('オフにすると一括の文言が変わる', await p.evaluate(() =>
    /すべてオン/.test(document.querySelector('#parseOut .rembox .lnk').textContent)));

  // ---- 一括 ----
  await p.evaluate(() => document.querySelector('#parseOut .rembox .lnk').click());
  await p.waitForTimeout(300);
  ok('「すべてオン」で全部オンになる', (await rows()).every(x => x.on));
  await p.evaluate(() => document.querySelector('#parseOut .rembox .lnk').click());
  await p.waitForTimeout(300);
  ok('「すべてオフ」で全部オフになる', (await rows()).every(x => !x.on));

  // ---- 選んだ分だけ登録される(同じ日はまとまる) ----
  await feed();
  await p.evaluate(() => document.querySelectorAll('#parseOut .rembox .rrow')[2].querySelector('.swtap').click());  // 9/18 をオフ
  await p.waitForTimeout(300);
  await p.evaluate(() => commitImport());
  await p.waitForTimeout(600);
  const after = await p.evaluate(() => {
    const rs = DB.reminders.filter(r => r.src === '取り込み');
    return { made: rs.length,
             linked: rs.map(r => (r.hypoIds || []).length),
             dates: rs.map(r => r.startDate),
             titles: rs.map(r => r.title),
             hints: DB.hypotheses.filter(h => h.stockId === '9001' && h.remindHint).map(h => h.remindHint.date) };
  });
  ok('オンの2件が1つのリマインダーになる', after.made === 1 && after.linked[0] === 2);
  ok('日付が引き継がれる', after.dates[0] === '2026/11/12');
  ok('まとまりのタイトルに件数が入る', /2点/.test(after.titles[0]));
  ok('オフにした分は登録されない', !after.dates.includes('2026/9/18'));
  ok('オフにした分は候補日として残る', after.hints.includes('2026/9/18'));
  ok('登録した分の候補日は消える', !after.hints.includes('2026/11/12'));
  ok('読み込み後に登録シートを出さない', await p.evaluate(() =>
    !document.querySelector('#scrim').classList.contains('show')));
  ok('登録件数を知らせる', await p.evaluate(() =>
    /リマインダー1件を登録/.test(document.querySelector('#toast').textContent)));

  // ---- 自動設定 ----
  await feed();
  await p.evaluate(() => document.querySelector('#parseOut .rembox .lnk.foot').click());
  await p.waitForTimeout(350);
  ok('設定が保存される', await p.evaluate(() => DB.settings.autoRemind === true));
  ok('自動のときは一覧を出さない', await p.evaluate(() =>
    document.querySelectorAll('#parseOut .rembox .rrow').length === 0));
  ok('自動のときはその旨を出す', await p.evaluate(() =>
    /すべてリマインダーに登録します/.test(document.querySelector('#parseOut .rembox').textContent)));
  ok('毎回選ぶ設定に戻せる', await p.evaluate(() =>
    /毎回選ぶように戻す/.test(document.querySelector('#parseOut .rembox').textContent)));
  await p.evaluate(() => commitImport());
  await p.waitForTimeout(600);
  ok('自動なら全件が登録される(日付ごとに2つ)', await p.evaluate(() =>
    DB.reminders.filter(r => r.src === '取り込み').length === 2));
  ok('自動でも確認シートは出さない', await p.evaluate(() =>
    !document.querySelector('#scrim').classList.contains('show')));
  ok('自動なら候補日は残らない', await p.evaluate(() =>
    !DB.hypotheses.some(h => h.stockId === '9001' && h.remindHint && /2026\/(11\/12|9\/18)/.test(h.remindHint.date))));

  // 設定を戻すと一覧が復活する
  await p.evaluate(() => setAutoRemind(false)); await p.waitForTimeout(200);
  await feed();
  ok('設定を戻すと一覧が復活する', (await rows()).length === 3);

  // ---- 日付つきが無ければ欄ごと出さない ----
  await p.evaluate(() => { document.querySelector('#mdIn').value = '# 銘柄: テスト精機 (9001)\n## 指標\n- PBR: 2.5 | 単位:倍 | 2026/8/7'; parseAndPreview(); });
  await p.waitForTimeout(300);
  ok('日付つきが無ければ欄を出さない', await p.evaluate(() => !document.querySelector('#parseOut .rembox')));

  // ---- タップの目印(tapmark): 実際に3行を超えて隠れているときだけ出す ----
  // 2026-08-11(ユーザー指摘): タップで展開できることの視認性を上げるため、既存の矢尻を
  // 3行クランプの右下に表示する。ただし隠れている行が無いのに出すと誤解を招くため、
  // -webkit-line-clampはscrollHeightで切り詰め検出できない(実測で判明)ことを踏まえ、
  // 一時的にクランプを外して実高さを比較する方式(markClip3Truncated)で判定する
  await p.evaluate(t => { document.querySelector('#mdIn').value = t; parseAndPreview(); },
    `# 銘柄: テスト精機 (9001)\n## 注目ポイント\n- 本文: 短い注目ポイント\n- イベント日: 2026/11/12\n## 注目ポイント\n- 本文: 1Q決算で受注残が前年同期を上回って維持できているかを確認する。仮に下回った場合は、期初計画からの下方修正リスクも合わせて点検し、通期見通しへの影響を試算する必要がある。\n- イベント日: 2026/9/18`);
  await p.waitForTimeout(300);
  const marks = await p.evaluate(() => [...document.querySelectorAll('#parseOut .rembox .ttl.clip3')].map(el => ({
    short: el.textContent.length < 20,
    show: !!el.querySelector('.tapmark.show'),
  })));
  ok('短い本文にはタップの目印を出さない', marks.some(m => m.short && !m.show), marks);
  ok('3行を超えて隠れている本文にはタップの目印を出す', marks.some(m => !m.short && m.show), marks);
  ok('目印は既存の矢尻(caretSvg)を流用している', await p.evaluate(() =>
    !!document.querySelector('#parseOut .rembox .tapmark svg.caret')));
  // タップして展開すると、目印の向きが反転する(閉=下向き→開=上向き)ことをCSSの回転量で確認
  const rot = () => p.evaluate(() => {
    const el = [...document.querySelectorAll('#parseOut .rembox .ttl.clip3')].find(e => e.querySelector('.tapmark.show'));
    return getComputedStyle(el.querySelector('.tapmark svg')).transform;
  });
  const rotBefore = await rot();
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('#parseOut .rembox .ttl.clip3')].find(e => e.querySelector('.tapmark.show'));
    el.closest('.tx').click();
  });
  await p.waitForTimeout(150);
  const rotAfter = await rot();
  ok('展開すると目印が回転する(開いたことが分かる)', rotBefore !== rotAfter, { rotBefore, rotAfter });

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
