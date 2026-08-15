// 外部AIへ渡す全プロンプトと、アプリ内の定義(指標マスター・分析セクション・
// リマインダーのカテゴリ/頻度)の整合を機械的に検査する。
//
// なぜ要るか: プロンプトは「アプリが受け取れる形」を外部AIに指示する契約書だが、
// 一部が固定文で書かれているため、既定を入れ替えると文面だけが古くなる。
// 実際に、既定の指標一覧から「営業利益率」を外したあとも説明書に
// 『✕「営業利益率」があるのに…』が残り、存在しない指標を引き合いに出していた
// (2026-08-13の全プロンプト監査で検出)。固定文をやめて動的生成にしたうえで、
// 二度と乖離しないようここで縛る。
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

  // ============ 1. 新規インストール(既定のまま)での整合 ============
  await p.evaluate(() => localStorage.removeItem('hypo_tracker_proto_v1'));
  await p.reload(); await p.waitForTimeout(400);

  const A = await p.evaluate(() => {
    const brief = briefingText();
    const grab = re => ((brief.match(re) || [])[1] || '').split(' / ').map(s => s.trim()).filter(Boolean);
    return {
      briefSnap: grab(/銘柄の話のときの指標名: (.+)/),
      briefMkt: grab(/市場全体の話のときの指標名: (.+)/),
      briefInd: grab(/業界の話のときの指標名: (.+)/),
      briefTrend: grab(/指標名は下記の一覧から、一字一句そのままの表記で選んでください: (.+)/),
      snap: snapKeys(DB.metricsMaster),
      mkt: snapKeys(DB.marketMetricsMaster),
      ind: snapKeys(DB.industryMetricsMaster),
      trend: trendInds(DB.metricsMaster).map(t => t.name),
    };
  });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok('説明書の銘柄指標 = 指標マスター', eq(A.briefSnap, A.snap), { brief: A.briefSnap, master: A.snap });
  ok('説明書の市場指標 = 市場マスター', eq(A.briefMkt, A.mkt), { brief: A.briefMkt, master: A.mkt });
  ok('説明書の業界指標 = 業界マスター', eq(A.briefInd, A.ind), { brief: A.briefInd, master: A.ind });
  ok('説明書の業績推移 = 業績推移マスター', eq(A.briefTrend, A.trend), { brief: A.briefTrend, master: A.trend });

  // ---- 「✕ Xがあるのに」の X は実在しなければならない ----
  const B = await p.evaluate(() => {
    const brief = briefingText();
    const all = [...snapKeys(DB.metricsMaster), ...trendInds(DB.metricsMaster).map(t => t.name),
                 ...snapKeys(DB.marketMetricsMaster), ...snapKeys(DB.industryMetricsMaster)];
    const forbid = [...brief.matchAll(/✕「([^」]+)」があるのに「([^」]+)」/g)].map(m => ({ have: m[1], wrong: m[2] }));
    return {
      forbid,
      stale: forbid.filter(f => !all.includes(f.have)),
      // アプリが検知できる別名(METRIC_ALIASES)のうち、正名がマスターに在るものは
      // 説明書でも名指しで禁止していないと、外部AIは日本語表記を選んでしまう
      unmentioned: METRIC_ALIASES.filter(g => all.includes(g[0])).flatMap(g => g.slice(1)).filter(a => !brief.includes(a)),
      // 逆に、マスターに無い正名の別名を禁止すると、存在しない指標の話になる
      phantom: METRIC_ALIASES.filter(g => !all.includes(g[0])).flatMap(g => g.slice(1)).filter(a => brief.includes(a)),
    };
  });
  ok('✕の例が1件以上ある(検査の前提)', B.forbid.length > 0, B.forbid.length);
  ok('✕の例に出る指標はすべて実在する(古い固定文が残っていない)', B.stale.length === 0, B.stale);
  ok('マスターに在る指標の別名は、説明書でも名指しで禁止している', B.unmentioned.length === 0, B.unmentioned);
  ok('マスターに無い指標の別名は、説明書に書かない', B.phantom.length === 0, B.phantom);

  // ---- 説明書が名指しする分析項目は、すべて取り込みで解決できる ----
  const C = await p.evaluate(() => {
    const brief = briefingText();
    const subs = [...brief.matchAll(/【[^】]+】 (.+)/g)].flatMap(m => m[1].split(' / ').map(s => s.trim()));
    return { count: subs.length, unresolved: subs.filter(su => !resolveSection(su, '本文').sub) };
  });
  ok('説明書の分析項目が1件以上ある(検査の前提)', C.count > 0, C.count);
  ok('説明書の分析項目はすべてresolveSectionで解決できる(その他に落ちない)', C.unresolved.length === 0, C.unresolved);

  // ============ 2. 説明書どおりに書いた回答が、そのまま取り込めるか ============
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);
  const D = await p.evaluate(() => {
    const brief = briefingText();
    const grab = re => ((brief.match(re) || [])[1] || '').split(' / ').map(s => s.trim()).filter(Boolean);
    const snap = grab(/銘柄の話のときの指標名: (.+)/), trend = grab(/指標名は下記の一覧から、一字一句そのままの表記で選んでください: (.+)/);
    const subs = [...brief.matchAll(/【[^】]+】 (.+)/g)].flatMap(m => m[1].split(' / ').map(s => s.trim()));
    const md = '# 銘柄: テスト精機 (9001)\n## 指標\n'
      + snap.map(k => `- ${k}: 1.2 | 単位:倍 | 2026/8/13`).join('\n')
      + '\n## 業績推移\n' + trend.map(k => `- ${k}: 25年3月期=1 | 26年3月期=2 | 単位:百万円 | 2026/8/13`).join('\n')
      + '\n## 分析\n' + subs.map(k => `- ${k}(サマリ): 本文 | 2026/8/13`).join('\n')
      + '\n## 注目ポイント\n- 本文: 決算を確認する\n- イベント日: 2026/11/12'
      + '\n## メモ\n- 本文: 自分の見立て';
    const r = parseMd(md);
    return {
      failed: r.failed,
      snapMisrouted: r.rows.filter(x => snap.includes(x.key) && !/指標/.test(x.block || '')).map(x => ({ k: x.key, b: x.block })),
      trendMisrouted: r.rows.filter(x => trend.includes(x.key) && !/業績|推移/.test(x.block || '')).map(x => ({ k: x.key, b: x.block })),
      orphanSubs: r.rows.filter(x => /分析/.test(x.block || '') && x._res && !x._res.sub).map(x => x.key),
      newMets: newMetricsIn(r.rows, stock('9001')).map(x => x.name),
      watch: r.rows.filter(x => /注目ポイント/.test(x.block || '')).length,
      memo: r.memoCandidates.length,
    };
  });
  ok('説明書どおりの回答に読めなかった行が出ない', D.failed.length === 0, D.failed);
  ok('説明書の指標名は「指標」ブロックに入る', D.snapMisrouted.length === 0, D.snapMisrouted);
  ok('説明書の業績推移名は「業績推移」ブロックに入る', D.trendMisrouted.length === 0, D.trendMisrouted);
  ok('説明書の分析項目は「その他」に落ちない', D.orphanSubs.length === 0, D.orphanSubs);
  ok('説明書の指標名は「新しい指標」警告にならない(マスターと一致している)', D.newMets.length === 0, D.newMets);
  ok('注目ポイント・メモの書式も取り込める', D.watch === 1 && D.memo === 1, { watch: D.watch, memo: D.memo });

  // ---- 別名(日本語表記)で書かれたら、取り込み前に警告が出る(安全網) ----
  const E = await p.evaluate(() => {
    const snap = snapKeys(DB.metricsMaster), trend = trendInds(DB.metricsMaster).map(t => t.name);
    return METRIC_ALIASES.filter(g => snap.includes(g[0]) || trend.includes(g[0])).flatMap(g => g.slice(1).map(alias => {
      const inTrend = trend.includes(g[0]);
      const md = `# 銘柄: テスト精機 (9001)\n## ${inTrend ? '業績推移' : '指標'}\n- ${alias}: ${inTrend ? '25年3月期=1' : '1.2'} | 単位:倍 | 2026/8/13`;
      const hit = newMetricsIn(parseMd(md).rows, stock('9001')).find(x => x.name === alias);
      return { alias, warnedAs: hit && hit.near ? hit.near.name : null, expect: g[0] };
    }));
  });
  ok('別名で書かれたら取り込み前に正しい名前を名指しできる', E.length > 0 && E.every(x => x.warnedAs === x.expect), E);

  // ============ 3. 質問文(genOrderNew)の指標名がマスターと一致 ============
  const F = await p.evaluate(() => {
    openStock('9001');
    snapKeys(DB.metricsMaster).forEach(k => { delete stock('9001').metrics[k]; });
    DB.askPrefs.picks = {}; DB.askPrefs.picks[DB.sectionMaster.find(c => c.on).subs[0]] = 'sum';
    save(); genOrderNew('9001');
    const q = (document.querySelector('#sheet textarea') || {}).value || '';
    closeSheet();
    const asked = [...q.matchAll(/^- (.+?): \s*$/gm)].map(m => m[1]);
    const trendLine = (q.match(/直近4期\+予想1期\(yy年mm月期表記\)の (.+) を年度ごとに。/) || [])[1];
    const snap = snapKeys(DB.metricsMaster);
    return {
      unknownAsked: asked.filter(k => !snap.includes(k) && !/\(サマリ\)|\(詳細\)$/.test(k)),
      trendAsked: trendLine ? trendLine.split(' / ') : [],
      trendMaster: trendInds(DB.metricsMaster).map(t => t.name),
    };
  });
  ok('質問文が挙げる指標名はすべてマスターにある', F.unknownAsked.length === 0, F.unknownAsked);
  ok('質問文の業績推移 = 業績推移マスター', eq(F.trendAsked, F.trendMaster), F);

  // ============ 4. リマインダー設計プロンプト ⇄ parseReminder の往復 ============
  const G = await p.evaluate(() => {
    sheetAddReminder('9001');
    const el = document.querySelector('#rm_md');
    if (!el) return { error: 'rm_mdが無い' };
    // 設計プロンプトが指示している出力フォーマットのとおりに書いた回答
    el.value = `## リマインダー
- タイトル: テスト監視
- コメント: 何が起きたら動くのか
- カテゴリ: 決算プレビュー
- 開始日: 2026/9/1
- 終了日: 2026/12/31
- 頻度: 週次(火)
- 時間: 09:00, 15:30

## 頻度変更1
- 条件: 1Q決算 2026/11/12 になったら
- 変更後頻度: 毎日
- 変更後時間: 08:30

## 実行プロンプト
受注残を確認してください。

## 変更後の実行プロンプト1
決算の実績と反応を評価してください。`;
    document.querySelector('#rm_stock').value = '9001';
    const before = DB.reminders.length;
    parseReminder();
    const r = DB.reminders[DB.reminders.length - 1];
    return {
      added: DB.reminders.length === before + 1,
      title: r.title, cat: r.cat, freq: r.freq, times: r.times,
      start: r.startDate, end: r.endDate,
      catValid: CATS.includes(r.cat), freqValid: FREQS.includes(r.freq),
      changes: r.changes.length, changePrompt: !!(r.changes[0] || {}).prompt,
      prompt: r.prompt, nextFire: r.nextFire,
    };
  });
  ok('設計プロンプトの出力フォーマットがそのまま登録できる', G.added, G);
  ok('タイトル・コメント・日付が取れる', G.title === 'テスト監視' && G.start === '2026/9/1' && G.end === '2026/12/31', G);
  ok('カテゴリがアプリの選択肢(CATS)に存在する', G.catValid, G.cat);
  ok('頻度がアプリの選択肢(FREQS)に存在する', G.freqValid, G.freq);
  ok('時間が配列として取れる', JSON.stringify(G.times) === JSON.stringify(['09:00', '15:30']), G.times);
  ok('頻度変更と変更後プロンプトが紐づく', G.changes === 1 && G.changePrompt, G);
  ok('実行プロンプトが取れる', /受注残/.test(G.prompt || ''), G.prompt);
  ok('次回発火が計算できる(頻度・時間が解釈できている)', !!G.nextFire, G.nextFire);

  // ---- 設計プロンプトが提示する選択肢が、アプリの定義と食い違っていない ----
  const H = await p.evaluate(() => {
    sheetAddReminder('9001');
    let got = null;
    const orig = navigator.clipboard.writeText;
    navigator.clipboard.writeText = t => { got = t; return Promise.resolve(); };
    document.querySelector('#rm_stock').value = '9001';
    document.querySelector('#rm_memo').value = '';
    copyRegPrompt();
    navigator.clipboard.writeText = orig;
    closeSheet();
    const catLine = (got.match(/- カテゴリ: \(([^)]+) から1つ\)/) || [])[1] || '';
    const cats = catLine.split('/').map(s => s.trim()).filter(Boolean);
    const freqLine = (got.match(/- 頻度: \((.+)\)\n/) || [])[1] || '';
    return {
      cats, CATS,
      unknownCats: cats.filter(c => !CATS.includes(c)),
      missingCats: CATS.filter(c => !cats.includes(c)),
      // 頻度は「週次(曜日)」のような総称で書くので、代表形が全部読めるかで見る
      freqLine,
      freqUnreadable: FREQS.filter(f => {
        const base = f.replace(/\(.+\)$/, '');
        return !new RegExp(base).test(freqLine);
      }),
    };
  });
  ok('設計プロンプトのカテゴリ一覧 = アプリのCATS', H.unknownCats.length === 0 && H.missingCats.length === 0, H);
  ok('設計プロンプトの頻度一覧がFREQSを網羅している', H.freqUnreadable.length === 0, H);

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
