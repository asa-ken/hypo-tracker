// 仮説カード(kind:'memo'|'watch')の表示に関わる純粋関数。DOM非依存。
function kindLabel(kind){ return kind==='watch' ? '注目' : 'メモ'; }
function kindChipColor(kind){ return kind==='watch' ? 'amber' : 'gray'; }
// リマインダーを紐づけられるのは注目ポイントだけ。
// 以前は「イベント日を表示するか(showsEvent)」だったが、日付の管理はリマインダーに一本化した
function canRemind(kind){ return kind==='watch'; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kindLabel, kindChipColor, canRemind };
}
