// ホームの区分の中身は、市場・銘柄分析トップや銘柄詳細の分析セクションと同じ見せ方にすること
//
// 構造化された情報(区分見出し+中身)は、画面が違っても同じ視覚言語にする。
// ホームの「今日のリマインダー」「期限切れ」だけが白カード・枠線・地色を持ち、
// 他画面の区分(市場・銘柄分析トップの「保有」「ウォッチ」等)は外枠なしの
// フラットな行(.list.flat)だった。ホームだけ浮いていたため揃える。
// 状態の重さ(期限切れ/今日)は色で示さず、見出しの言葉で伝える。
const { chromium } = require('playwright');
// 実行環境ごとに違うので環境変数で差し替えられるようにする
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v, d) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));
const isTransparent = c => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  // 期限切れ2銘柄・今日1銘柄で、多銘柄/単一銘柄どちらの形も検査する
  await p.evaluate(() => {
    const t = fmtToday();
    const mk = (id, sid, ti, f) => ({ id, stockId: sid, hypoIds: [], title: ti, comment: null,
      cat: '決算プレビュー', freq: f, times: ['23:59'], startDate: null, endDate: null, paused: false,
      changes: [], prompt: ti, src: 'テスト', srcDate: t, log: [], nextFire: null });
    DB.reminders = [mk('e1', '9001', '期限切れA', '単発 2020/1/1'), mk('e2', '9002', '期限切れB', '単発 2020/1/2'),
                    mk('t1', 'TSTC', '本日A', '単発 ' + t)];
    save(); go('home');
  }); await p.waitForTimeout(400);

  // 参照: 市場・銘柄分析トップの「保有」区分の中身のスタイル
  const anaRef = await p.evaluate(() => {
    go('analysis');
    const list = document.querySelector('#view .list.flat');
    const st = getComputedStyle(list);
    return { bg: st.backgroundColor, border: st.borderTopWidth, radius: st.borderRadius };
  });
  await p.waitForTimeout(200);

  const home = await p.evaluate(() => {
    go('home');
    // groupBlock は見出し+中身を1つの div にまとめず、兄弟要素として並べて返す。
    // 中身は「次の見出しが出るまで」の兄弟要素すべてなので、そこを走査する
    const get = (name) => {
      const l = [...document.querySelectorAll('#view .lbl.grp')].find(x => new RegExp(name).test(x.textContent));
      const parts = [];
      for (let e = l.nextElementSibling; e && !e.classList.contains('lbl'); e = e.nextElementSibling) parts.push(e);
      if (!parts.length) return { bodyBg: 'rgba(0, 0, 0, 0)', bodyBorder: '0px 0px', listFlatClass: null, listBg: null, rowExists: false };
      const list = parts.find(e => e.classList.contains('list'));
      const row = parts.find(e => e.classList.contains('list-row')) || (list && list.querySelector('.list-row'));
      const bg = parts.map(e => getComputedStyle(e).backgroundColor).find(c => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') || 'rgba(0, 0, 0, 0)';
      const border = parts.map(e => { const s = getComputedStyle(e); return s.borderTopWidth + ' ' + s.borderLeftWidth; }).find(b => b !== '0px 0px') || '0px 0px';
      return {
        bodyBg: bg, bodyBorder: border,
        listFlatClass: list ? list.className.includes('flat') : null,
        listBg: list ? getComputedStyle(list).backgroundColor : null,
        rowExists: !!row,
      };
    };
    return { expired: get('期限切れ'), today: get('今日のリマインダー') };
  });
  await p.waitForTimeout(200);

  ok('市場・銘柄分析の区分の中身は透明な地色(参照)', isTransparent(anaRef.bg), anaRef);
  ok('市場・銘柄分析の区分の中身は角丸を持たない(参照)', anaRef.radius === '0px', anaRef);

  ok('期限切れの中身に外枠が付かない', home.expired.bodyBorder === '0px 0px', home.expired);
  ok('期限切れの中身の地色はページと同じ(透明)', isTransparent(home.expired.bodyBg), home.expired);
  ok('今日のリマインダーの中身に外枠が付かない', home.today.bodyBorder === '0px 0px', home.today);
  ok('今日のリマインダーの中身の地色はページと同じ(透明)', isTransparent(home.today.bodyBg), home.today);

  // 期限切れは2銘柄なので .list.flat の行として並ぶはず
  ok('期限切れ(複数銘柄)は市場・銘柄分析と同じ .list.flat を使う', home.expired.listFlatClass === true, home.expired);
  ok('その中の行も透明な地色', isTransparent(home.expired.listBg), home.expired);

  // ---- 色による状態の区別が無いこと(Color=1 の意味衝突も解消) ----
  const noColorDiff = await p.evaluate(() => {
    const v = document.querySelector('#view');
    return { expiredClass: !!v.querySelector('.expired'), attnClass: !!v.querySelector('.card.attn'),
      hasRedBg: [...v.querySelectorAll('*')].some(e => getComputedStyle(e).backgroundColor === 'rgb(251, 230, 228)'),
      hasNavyBg: [...v.querySelectorAll('*')].some(e => getComputedStyle(e).backgroundColor === 'rgb(232, 239, 245)') };
  });
  ok('期限切れ専用の地色クラスは使わない', !noColorDiff.expiredClass, noColorDiff);
  ok('カード型の地色は使わない(.card.attn)', !noColorDiff.attnClass, noColorDiff);
  ok('赤地(--red-bg)を状態の区別に使わない', !noColorDiff.hasRedBg, noColorDiff);

  // ---- 情報・操作は保たれていること ----
  const text = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('期限切れの内容は読める', /期限切れA|期限切れB/.test(text));
  ok('今日の内容は読める', /本日A/.test(text));
  const taps = await p.evaluate(() => [...document.querySelectorAll('#view button,#view .list-row,#view [onclick]')]
    .map(e => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; })
    .filter(x => x.w > 0));
  ok('44px未満のタップ要素がない', taps.filter(x => x.h < 44).length === 0, taps.filter(x => x.h < 44));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
