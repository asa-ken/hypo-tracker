// コンポーネントの登録検査。
//
// トークン(色17個・文字6段階・gap4段階)は `design.js` / `colortoken.js` が検査していたが、
// そのトークンを使う「部品」の側には一次定義も検査も無かった。その結果、同じ役割のカードが
// 2実装(`.failbox` と `.candbox`)並存しても、色・文字サイズ・タップ領域はどちらも正しいため
// 既存の検査は全部通ってしまい、ユーザー指摘まで誰も気づかなかった(2026-08-22、PR #155で統合)。
//
// このスイートは「カード状のコンテナ」が勝手に増えていないかだけを見る。
// デザインハーネスの言い方では、制約層の「使ってよいコンポーネントを列挙し、それ以外を選ばせない」と、
// フィードバック層の「独自UIが増えるならコンポーネントを足す」を機械的に強制する部分にあたる。
//
// 検出条件は「単独クラス1個だけのセレクタ」かつ「border-radius と background:var(--*) を両方持つ」。
// 子孫セレクタ(`.candbox .cbx-head` など)や複合セレクタ(`.card.tap` など)は既存部品の内部なので対象外。
// 小さな操作部品(`.btn`/`.sw`/`.dot`)もこの条件に当たるが、除外条件を増やすと検出漏れの穴になるため、
// 除外せず一覧へ載せる方針にした。増えたときに一度立ち止まることが目的で、分類の厳密さは目的ではない。
const fs = require('fs');
const ok = (label, v, d) =>
  console.log((v ? '✅' : '❌') + ' ' + label + ' → ' + JSON.stringify(v) + (d === undefined ? '' : ' ' + JSON.stringify(d)));

// 登録済みのカード状コンテナ。増やすときは、まず既存コンポーネントで代替できないかを検討し、
// それでも要るなら下のどちらかへ追記したうえで理由を DECISIONS.md に残す。

// (1) DESIGN_SYSTEM.md「Components」に一次定義があるもの。
// 複数箇所で使われる構造的な部品で、使い分けを誤ると画面間の一貫性が崩れる。
const DOCUMENTED = [
  '.banner',   // 消えない注意書き
  '.candbox',  // 取り込み画面の確認カード
  '.card',     // 汎用の白カード
  '.failbox',  // 非推奨。「調べる項目を選ぶ」1箇所のみ残存
  '.list',     // 一覧の外枠
  '.nodata',   // 枠の中身が空(画面全体が空なら .empty)
  '.sheet',    // 下から出るシート
  '.toast',    // 数秒で消える通知(消えて困るなら .banner)
];

// (2) 検出条件には当たるが、一次定義は持たせないと判断したもの(2026-08-22確定)。
// 小さな操作部品か、用途が1つに固定されていて「どれを使うか」を誤る余地が無い。
// 一次定義は「複数の選択肢から誤ったものを選ばないため」に置くものなので、
// 選択肢が無いものに書いても文書が長くなるだけで、守るべきことは増えない。
// 増減の検査自体は下の REGISTERED に入るのでこちらにも効いている。
const UNDOCUMENTED_OK = [
  '.btn',               // ボタン
  '.dot',               // ページャの点
  '.exit-confirm-card', // 離脱確認ダイアログ
  '.mine',              // 自分の書き込みの吹き出し
  '.sw',                // トグルスイッチ
];

const REGISTERED = [...DOCUMENTED, ...UNDOCUMENTED_OK].sort();

const src = fs.readFileSync(__dirname + '/../../index.html', 'utf8');
const style = src.match(/<style>([\s\S]*?)<\/style>/)[1];
const s = style.replace(/\/\*[\s\S]*?\*\//g, '');

const found = new Set();
for (const m of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim(), decl = m[2];
  if (sel.startsWith('@')) continue;
  for (const one of sel.split(',').map(x => x.trim())) {
    if (!/^\.[a-zA-Z][a-zA-Z0-9_-]*$/.test(one)) continue;
    if (!/border-radius/.test(decl)) continue;
    if (!/background:\s*var\(--/.test(decl)) continue;
    found.add(one);
  }
}

const got = [...found].sort();
const added = got.filter(c => !REGISTERED.includes(c));
const gone = REGISTERED.filter(c => !got.includes(c));

ok('カード状のコンテナが未登録のまま増えていない(増やすならDESIGN_SYSTEM.mdとこの一覧に追記する)',
  added.length === 0, added.length ? { 未登録: added } : undefined);
ok('登録済みのコンテナが消えていない(消したなら一覧からも消す)',
  gone.length === 0, gone.length ? { 実装に無い: gone } : undefined);

// ---- 取り込み画面のカード3種が同じ構造を共有していること(PR #155の回帰) ----
// 「読めなかった行」が独自実装(.failbox)に戻ると、また同じ不統一が生まれる
const importUsesFailbox = /grp1\s*\+=\s*`?<div class="failbox/.test(src);
ok('取り込み画面が旧.failboxへ戻っていない', !importUsesFailbox);
ok('.candbox に外枠(border)を復活させていない',
  !/\.candbox\s*\{[^}]*border:\s*1px/.test(s));
ok('.candbox の行(.rrow)に区切り線を復活させていない',
  !/\.candbox\s+\.rrow\s*\{[^}]*border-top:\s*1px/.test(s));

// ---- DESIGN_SYSTEM.md に Components の節があること ----
const ds = fs.readFileSync(__dirname + '/../../docs/design/DESIGN_SYSTEM.md', 'utf8');
ok('DESIGN_SYSTEM.md に Components の節がある', /^##\s*Components/m.test(ds));
const undocumented = DOCUMENTED.filter(c => !ds.includes('`' + c + '`'));
ok('一次定義を持つコンテナがすべて DESIGN_SYSTEM.md に載っている',
  undocumented.length === 0, undocumented.length ? { 未記載: undocumented } : undefined);

console.log('JSエラー: []');
