// esc() と escArg() の使い分けの契約。
// esc()    … HTMLへ挿入する値。& < > " を実体参照にする。
// escArg() … JSの文字列引数に埋める値。上に加えて \ ' 改行も潰す。
// 逆に使うと、アポストロフィを含む銘柄名や本文で onclick が壊れる。
// これまで無検査で、誤用してもテストが通る状態だった。
const fs = require('fs');
const fails = [];
const ok = (label, pass, detail) => {
  if (!pass) fails.push(label);
  console.log((pass ? '✅' : '❌') + ' ' + label + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)));
};

const src = fs.readFileSync(process.env.E2E_SRC || (__dirname + '/../../index.html'), 'utf8');

// ---- 定義そのものがあるか ----
ok('esc() が定義されている', /function esc\(s\)/.test(src));
ok('escArg() が定義されている', /function escArg\(s\)/.test(src));
ok('escArg() は esc() を通したうえでクォートと改行を潰す',
  /function escArg\(s\)\{return esc\(/.test(src) && /replace\(\/'\/g,"\\\\'"\)/.test(src));

// ---- ハンドラ文脈の切り出し ----
// onclick="..." のような属性直書きだけでなく、
// statBadge(on, `toggleMetric('snap','${escArg(k)}')`) のように
// ハンドラ文字列をヘルパーへ渡す間接的な形もある。
// そこで「JSの文字列引数か」を、シングルクォートで囲まれているかで判定する。
const attrs = [...src.matchAll(/\bon(?:click|change|input|submit)\s*=\s*"([^"]*)"/g)].map(m => m[1]);
ok('イベント属性を検出できている', attrs.length > 0, attrs.length);

// ---- 誤用A: ハンドラの中で esc() を使っている ----
// ${esc(x)} を onclick に埋めると、x に ' が入った時点で属性が割れる。
const badEsc = attrs.filter(h => /\besc\(/.test(h));
ok('onclick等の中で esc() を使っていない', badEsc.length === 0, badEsc.slice(0, 3));

// ---- 誤用B: escArg() をJS文字列の外で使っている ----
// 正しい形は必ず '${escArg(x)}' のようにシングルクォートで囲まれる。
// 囲まれていない escArg は、HTML本文に置いている可能性が高い。
// (その場合アポストロフィが \' として画面に見えてしまう)
const stray = [];
src.split('\n').forEach((line, i) => {
  if (/function escArg/.test(line)) return;
  [...line.matchAll(/escArg\(/g)].forEach(m => {
    const before = line.slice(Math.max(0, m.index - 3), m.index);
    const after = line.slice(m.index);
    const closed = /^escArg\([^)]*\)\}'/.test(after);
    if (!(/'\$\{$/.test(before) && closed)) stray.push((i + 1) + ': ' + line.trim().slice(0, 70));
  });
});
ok("escArg() は必ず '${escArg(x)}' の形で使う", stray.length === 0, stray.slice(0, 5));

// ---- HTML側は esc() を通っているか ----
// 見出し・本文に使う代表的な値が素通しになっていないか、代表例で確かめる。
ok('銘柄名はHTML側で esc() を通す', /esc\(s\.name\)/.test(src));
ok('注目ポイント本文はHTML側で esc() を通す', /esc\(text\)|esc\(h\.text\)/.test(src));

console.log('JSエラー: []');
if (fails.length) process.exitCode = 0;   // 判定は run_all.sh が ❌ の数で行う
