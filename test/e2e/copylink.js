// ホームの銘柄別コピーは、バッジ(chip)ではなく個別リマインダー画面と同じ
// アイコン付き細字テキストリンクにすること
//
// 最初は件数を chip(バッジ)自体に持たせてタップ対象にしたが、それだと
// 市場・銘柄分析トップ等の情報表示専用バッジと同じ見た目のものに、画面によって
// 操作があったり無かったりすることになるため撤回した(2026-08-09 DECISIONS.md)。
// 件数はバッジにせず、行の文字情報(.meta)の中で「元の表現」どおり伝える。
// コピーは、枠なし・細字(通常の太さ)・個別リマインダー画面と同じアイコンつきの
// テキストリンクとして置く。区分見出しの一括コピーも同じアイコン・同じ細さに揃える。
//
// アイコンは元は「⧉」の文字グリフだったが、奥・手前どちらの四角も輪郭のみで
// 塗りが無く軽すぎるとの指摘を受け、SVGアイコン(copyIconSvg())に差し替えた。
// 奥の四角は輪郭のみ、手前の四角は塗りつぶし(currentColor)。
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

  // 今日: 9001に2件・9002に3件(複数銘柄)。期限切れ: TSTCに1件だけ(単一銘柄)
  await p.evaluate(() => {
    const t = fmtToday();
    const mk = (id, sid, ti, f) => ({ id, stockId: sid, hypoIds: [], title: ti, comment: null,
      cat: '決算プレビュー', freq: f, times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: ti + 'のプロンプト', src: 'テスト', srcDate: t, log: [], nextFire: null });
    DB.reminders = [
      mk('t1', '9001', '本日A', '単発 ' + t), mk('t2', '9001', '本日B', '単発 ' + t),
      mk('t3', '9002', '本日C', '単発 ' + t), mk('t4', '9002', '本日D', '単発 ' + t), mk('t5', '9002', '本日E', '単発 ' + t),
      mk('e1', 'TSTC', '期限切れA', '単発 2020/1/1'),
    ];
    save(); go('home');
  }); await p.waitForTimeout(400);

  // groupBlock は見出し+中身を1つの div にまとめず兄弟要素として並べる。
  // 中身は「次の見出しが出るまで」の兄弟要素すべてなので、そこを走査する
  await p.evaluate(() => {
    window._rowsOf = (name) => {
      const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => new RegExp(name).test(x.textContent));
      const rows = [];
      for (let e = l.nextElementSibling; e && !e.classList.contains('lbl'); e = e.nextElementSibling)
        rows.push(...e.querySelectorAll('.list-row'));
      return rows;
    };
  });

  // ---- 1. バッジ(chip)はもう使わない。件数は行の文字情報の中で伝える(元の表現) ----
  const multiRows = await p.evaluate(() => {
    const rows = window._rowsOf('今日のリマインダー');
    return rows.map(r => {
      const link = r.querySelector('.copylink');
      const st = link ? getComputedStyle(link) : null;
      const icon = link ? link.querySelector('svg.copy-ic') : null;
      const rects = icon ? [...icon.querySelectorAll('rect')].map(rc => getComputedStyle(rc).fill) : [];
      return { meta: r.querySelector('.meta') ? r.querySelector('.meta').textContent.trim() : null,
        hasChip: !!r.querySelector('.chip'), hasBtn: !!r.querySelector('button'),
        linkText: link ? link.textContent.trim() : null, linkOn: link ? link.getAttribute('onclick') : null,
        fontWeight: st ? st.fontWeight : null, border: st ? st.borderWidth : null, bg: st ? st.backgroundColor : null,
        h: link ? Math.round(link.getBoundingClientRect().height) : 0, hasIcon: !!icon, rectFills: rects };
    });
  });
  ok('今日は2銘柄の行がある(テスト前提)', multiRows.length === 2, multiRows);
  ok('もうバッジ(chip)は使わない', multiRows.every(r => !r.hasChip), multiRows);
  ok('もう .btn(枠線ボタン)も使わない', multiRows.every(r => !r.hasBtn), multiRows);
  ok('件数は行の文字情報(.meta)に「N件・」として出る(元の表現)',
    multiRows.some(r => /^2件・/.test(r.meta)) && multiRows.some(r => /^3件・/.test(r.meta)), multiRows);
  ok('コピーは枠なし(border 0)のテキストリンク', multiRows.every(r => parseFloat(r.border) === 0), multiRows);
  ok('コピーの地色も付かない', multiRows.every(r => r.bg === 'rgba(0, 0, 0, 0)' || r.bg === 'transparent'), multiRows);
  ok('コピーは太字にしない(通常の太さ)', multiRows.every(r => +r.fontWeight <= 400), multiRows);
  ok('コピーは「コピー」の文字とアイコンで構成される', multiRows.every(r => r.linkText === 'コピー' && r.hasIcon), multiRows);
  ok('アイコンは奥・手前の四角2つで構成される(テスト前提)', multiRows.every(r => r.rectFills.length === 2), multiRows);
  ok('奥の四角は輪郭のみ(塗りは透過のまま)', multiRows.every(r => r.rectFills[0] === 'none'), multiRows);
  ok('手前の四角は塗りつぶし(透過にしない)', multiRows.every(r => r.rectFills[1] !== 'none' && r.rectFills[1] !== 'rgba(0, 0, 0, 0)'), multiRows);
  ok('コピーのタップ領域は44px以上', multiRows.every(r => r.h >= 44), multiRows);
  ok('コピーに copyBriefFor が仕込まれている', multiRows.every(r => /copyBriefFor/.test(r.linkOn || '')), multiRows);

  // 行を押すと遷移、コピーリンクを押すとコピーだけ(伝播が分かれていること)
  await p.evaluate(() => { window._rowsOf('今日のリマインダー')[0].querySelector('.copylink').click(); });
  await p.waitForTimeout(250);
  ok('コピーリンクを押すとコピーされる', /コピーしました/.test(await p.evaluate(() => document.querySelector('#toast').textContent)));
  ok('コピーしても画面遷移しない(一覧のまま)', await p.evaluate(() => /今日のリマインダー/.test(document.querySelector('#view').innerText)));

  // ---- 2. 単一銘柄(期限切れ)の行: バッジも無く、コピーリンクも無い(元の表現に戻す) ----
  const single = await p.evaluate(() => {
    const row = window._rowsOf('期限切れ')[0];
    return { rowOn: row.getAttribute('onclick'), ttl: row.querySelector('.ttl').textContent.trim(),
      hasChip: !!row.querySelector('.chip'), hasCopylink: !!row.querySelector('.copylink'),
      hasArrow: !!row.querySelector('.arrow') };
  });
  ok('単一銘柄の行にバッジは無い', !single.hasChip, single);
  ok('単一銘柄の行にコピーリンクも無い(区分見出しの一括コピーで足りる)', !single.hasCopylink, single);
  ok('行自体は本体へ遷移する', /openReminder\(/.test(single.rowOn || ''), single);
  ok('遷移を示す矢尻は残る', single.hasArrow);

  // ---- 3. 区分見出しの一括コピーも同じ細さ・同じアイコンに揃える ----
  const head = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => /今日のリマインダー/.test(x.textContent));
    const btn = l.querySelector('.grp-edit');
    const st = getComputedStyle(btn);
    const icon = btn.querySelector('svg.copy-ic');
    const rects = icon ? [...icon.querySelectorAll('rect')].map(rc => getComputedStyle(rc).fill) : [];
    return { text: btn.textContent.trim(), fontWeight: st.fontWeight, on: btn.getAttribute('onclick'), hasIcon: !!icon, rectFills: rects };
  });
  ok('見出しの一括コピーは「一括コピー」とアイコンで構成される', head.text === '一括コピー' && head.hasIcon, head.text);
  ok('見出しのアイコンも手前の四角が塗りつぶし', head.rectFills[1] !== 'none' && head.rectFills[1] !== 'rgba(0, 0, 0, 0)', head.rectFills);
  ok('見出しの一括コピーも細字(「編集」「追加」等の太字とは別)', +head.fontWeight <= 400, head.fontWeight);
  ok('押すと区分ぜんぶをコピーする', /copyBrief\(\)/.test(head.on || ''), head.on);

  // ---- 4. 全体の測定 ----
  const taps = await p.evaluate(() => [...document.querySelectorAll('#view button,#view .list-row,#view [onclick],#view .copylink')]
    .map(e => { const r = e.getBoundingClientRect(); return { c: e.className, h: Math.round(r.height), w: Math.round(r.width) }; })
    .filter(x => x.w > 0));
  ok('44px未満のタップ要素がない', taps.filter(x => x.h < 44).length === 0, taps.filter(x => x.h < 44));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
