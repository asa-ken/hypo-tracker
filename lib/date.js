// 日付関連の純粋関数。DOM・DB非依存。
function today(){return new Date();}

function parseD(s){ if(!s)return null; const m=String(s).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); if(!m)return null; return new Date(+m[1],+m[2]-1,+m[3]); }

// now を省略すると today() (=実行時の現在時刻) を基準にする。テストからは明示的に注入できる。
function daysSince(s, now){ const d=parseD(s); if(!d)return 999; const base=now||today(); return Math.floor((base-d)/86400000); }

function matchFreq(freq, d){
  const w=d.getDay(); // 0=日
  if(/毎時間/.test(freq)) return true;
  if(/毎日/.test(freq)) return true;
  if(/平日/.test(freq)) return w>=1&&w<=5;
  if(/土日/.test(freq)) return w===0||w===6;
  if(/週次/.test(freq)){
    const m=String(freq).match(/[（(]([日月火水木金土])[）)]/);
    if(!m) return w===1; // 曜日指定なしは月曜
    return ['日','月','火','水','木','金','土'].indexOf(m[1])===w;
  }
  if(/月次/.test(freq)){
    const m=String(freq).match(/(\d{1,2})日/);
    return m ? d.getDate()===+m[1] : d.getDate()===1;
  }
  if(/単発/.test(freq)){
    const m=String(freq).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if(!m) return false;
    return d.getFullYear()===+m[1] && d.getMonth()===+m[2]-1 && d.getDate()===+m[3];
  }
  return false;
}

function toISO(s){ const d=parseD(s); if(!d) return ''; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fromISO(s){ const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!m) return ''; return `${+m[1]}/${+m[2]}/${+m[3]}`; }

// AIの回答に基準日が無い場合のフォールバック(このプロトタイプの「今日」固定値)
function normD(d){ if(!d)return '2026/7/13'; if(/^\d{1,2}\/\d{1,2}$/.test(d))return '2026/'+d; return d; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { today, parseD, daysSince, matchFreq, toISO, fromISO, normD };
}
