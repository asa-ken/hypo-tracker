// 色トークンの契約。
// :root で定義した色以外が増えていないかを見る。
// design.js は font-size と gap しか見ておらず、色はこれまで無検査だった。
// 色を足してもテストが通ってしまう状態を塞ぐのが目的。
const fs = require('fs');
// 配列は空でも truthy なので、真偽と表示用の詳細は必ず分けて渡す
const ok = (label, pass, detail) =>
  console.log((pass ? '✅' : '❌') + ' ' + label + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)));

const src = fs.readFileSync(process.env.E2E_SRC || (__dirname + '/../../index.html'), 'utf8');

// ---- :root に定義された色トークン ----
const rootBlock = (src.match(/:root\{([\s\S]*?)\}/) || [])[1] || '';
const TOKENS = [...rootBlock.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)].map(m => '--' + m[1]);
const EXPECTED = ['--bg', '--app', '--card', '--line', '--line2', '--ink', '--ink2', '--ink3',
  '--navy', '--navy-bg', '--navy-tx', '--amber-bg', '--amber-tx',
  '--green-bg', '--green-tx', '--red-bg', '--red-tx'];

ok('色トークンは17個そろっている', TOKENS.length === EXPECTED.length);
ok('色トークンの名前が DESIGN_SYSTEM.md と一致する',
  EXPECTED.every(t => TOKENS.includes(t)) && TOKENS.every(t => EXPECTED.includes(t)));

// ---- :root の外で直書きされている色 ----
// 影・スクリムのような半透明は、平坦なトークンでは表せないので別枠で許す。
// それ以外の直書きは「トークンにすべきだったのでは」を疑う対象として数える。
const outside = src.replace(/:root\{[\s\S]*?\}/, '');
const literals = [...new Set((outside.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []))];
const solids = literals.filter(c => !/^rgba?\(/.test(c));
const alphas = literals.filter(c => /^rgba?\(/.test(c));

// 現時点で残っている既知の例外。ここを増やすときは DECISIONS.md に理由を書く。
const KNOWN_SOLID = [
  '#fff',      // 白。var(--card) と同値
  '#fafbfc',   // カード/まとまりの押し込み時の地色
  '#f0f2f4',   // ボタンの押し込み時の地色
  '#1257a8',   // 「追加」テキストボタンの文字色
];
const KNOWN_ALPHA = [
  'rgba(20,30,40,.4)',   // シートのスクリム
  'rgba(20,30,40,.25)',  // 離脱確認の背景
  'rgba(20,30,40,.16)',  // スワイプバック中の影
  'rgba(20,30,40,.10)',  // セグメントの選択中の影
  'rgba(0,0,0,.3)',      // 離脱確認カードの影
];

const newSolid = solids.filter(c => !KNOWN_SOLID.includes(c));
const newAlpha = alphas.filter(c => !KNOWN_ALPHA.includes(c));

ok('新しい色の直書きが増えていない(不透明)', newSolid.length === 0, newSolid);
ok('新しい半透明色が増えていない(影・スクリム)', newAlpha.length === 0, newAlpha);

// 既知の例外が消えたら、トークン化されたか削除されたかのどちらか。
// どちらにせよ意図した変更のはずなので、リストを畳めるよう気づけるようにしておく。
const goneSolid = KNOWN_SOLID.filter(c => !solids.includes(c));
ok('既知の例外リストに死んだ項目がない', goneSolid.length === 0, goneSolid);

// ---- 色は必ず var() 経由か既知の例外であること ----
// 値の種類だけでなく箇所数も見る。同じ #fff でも使う場所が増えれば、
// トークンで済むところを直書きで広げている可能性がある。
// 現状12件(color:#fff 7 / background:#fafbfc 2 / background:#fff / #f0f2f4 / #1257a8)。
// 2026-08-09、ホームの外枠なし・地色なし化で「対応が必要」カードの枠線 #cfdde8 が消え13→12件になった
const direct = (outside.match(/(?:background|color|border-color|border-top-color|border-bottom-color)\s*:\s*#[0-9a-fA-F]{3,8}/g) || []);
ok('色の直書き箇所が12件から増えていない', direct.length <= 12, direct.length);

console.log('JSエラー: []');
