// 仮説カード(kind:'memo'|'watch')の表示に関わる純粋関数。DOM非依存。
function kindLabel(kind){ return kind==='watch' ? '注目' : 'メモ'; }
function kindChipColor(kind){ return kind==='watch' ? 'amber' : 'gray'; }
function showsEvent(kind){ return kind==='watch'; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kindLabel, kindChipColor, showsEvent };
}
