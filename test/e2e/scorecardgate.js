// スコアカード必須ゲート。
// これまで「ユーザーの直接指摘への反応PR」は Phase 1〜9 のループを経由せず、
// index.html を直接変更して即PRにできてしまっていた(該当箇所は DECISIONS.md
// 「スコアカードを省略していた手順違反」「11次元チェックが実施されなかった原因の考察」参照)。
// UI_REVIEW_LOOP.md の Stop Conditions は「Phase 1 のスコアカードが揃っていない」を
// 検査対象に挙げているが、npm test / npm run e2e のどちらもそれ自体を検査していなかった。
//
// このスイートは、index.html に変更があるのに DECISIONS.md へ11次元そろったスコアカードが
// 追加されていない状態を機械的に検出する。対象は「UIらしい変更かどうか」を人手で判定させず、
// index.html への変更すべてとする(判定を人に委ねると同じ形で省略が起きるため)。
const { execSync } = require('child_process');
const ROOT = __dirname + '/../..';
const ok = (label, pass, detail) =>
  console.log((pass ? '✅' : '❌') + ' ' + label + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)));

const sh = cmd => {
  try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return null; }
};

const DIMENSIONS = ['認知負荷', '情報構造', '視覚的ノイズ', '情報密度', 'Typography', 'Spacing',
  'Hit Area', 'Color', 'Accessibility', '一貫性', '実運用摩擦'];

// origin/main を基準にする。ローカルに無ければ一度だけ取得を試みる。
// それでも参照できない(オフライン等)場合は、判定不能としてチェック自体を素通りさせる
// (このゲートのせいで無関係な理由でnpm run e2eが落ち続ける事態を避ける)。
let base = sh('git merge-base HEAD origin/main');
if (!base) {
  sh('git fetch origin main');
  base = sh('git merge-base HEAD origin/main');
}

if (!base) {
  console.log('⚠ origin/main を参照できないため、スコアカード必須ゲートをスキップしました');
} else {
  const changed = (sh(`git diff --name-only ${base} -- index.html`) || '').split('\n').filter(Boolean);
  const htmlChanged = changed.includes('index.html');

  if (!htmlChanged) {
    ok('index.html に変更が無いため、このゲートの対象外', true);
  } else {
    const decisionsDiff = sh(`git diff ${base} -- docs/design/DECISIONS.md`) || '';
    const added = decisionsDiff.split('\n')
      .filter(l => l.startsWith('+') && !l.startsWith('+++'))
      .join('\n');

    const dimRe = d => new RegExp('\\|\\s*\\*{0,2}' + d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\*{0,2}\\s*\\|');
    const missing = DIMENSIONS.filter(d => !dimRe(d).test(added));

    ok('index.html の変更に対応して DECISIONS.md に11次元そろったスコアカードが追加されている',
      missing.length === 0,
      missing.length ? { base, missing } : { base });
  }
}
