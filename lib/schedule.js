// リマインダーの発火スケジュール計算。DOM・DB非依存(リマインダーオブジェクトと日時を引数で受ける)。
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  var _date = require('./date.js');
  var parseD = _date.parseD, matchFreq = _date.matchFreq;
}

// 現時点で適用される実行プロンプト(頻度変更で切り替わる)
function activePrompt(r, at){
  const now=at||new Date();
  let text=r.prompt||'', label='';
  (r.changes||[]).forEach((c,i)=>{
    const m=String(c.cond||'').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if(!m) return;
    const d=new Date(+m[1], +m[2]-1, +m[3]);
    if(now>=d && c.prompt){ text=c.prompt; label='変更'+(i+1)+'適用中'; }
  });
  return {text, label};
}

// 頻度変更(条件日付)を考慮し、指定時点で有効な頻度定義を返す
function activeSchedule(r, at){
  let freq=r.freq, times=r.times||[];
  (r.changes||[]).forEach(c=>{
    const m=String(c.cond||'').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if(!m) return;
    const d=new Date(+m[1], +m[2]-1, +m[3]);
    if(at>=d){ // 条件日を過ぎていれば適用(後の変更ほど優先)
      if(c.freq) freq=c.freq;
      if(c.times) times=String(c.times).split(',').map(x=>x.trim()).filter(Boolean);
    }
  });
  return {freq, times};
}

// 現在時刻以降の最初の発火日時を返す(最大400日先まで探索)。開始日(startDate)前は発火しない。
function calcNextFire(r, from){
  const now=from||new Date();
  const st=r.startDate?parseD(r.startDate):null;
  const en=r.endDate?parseD(r.endDate):null;
  if(en && now>new Date(en.getFullYear(),en.getMonth(),en.getDate(),23,59)) return null;
  // 探索の起点は「今」と「開始日」の遅い方
  const base=(st&&st>now)?st:now;
  for(let i=0;i<400;i++){
    const d=new Date(base.getFullYear(), base.getMonth(), base.getDate()+i);
    if(st && d<new Date(st.getFullYear(),st.getMonth(),st.getDate())) continue;
    if(en && d>new Date(en.getFullYear(),en.getMonth(),en.getDate())) return null;
    const sch=activeSchedule(r, d);
    if(!matchFreq(sch.freq, d)) continue;
    let times=(sch.times&&sch.times.length?sch.times:['09:00']).slice().sort();
    if(/毎時間/.test(sch.freq)){
      // 「9:00-15:00」形式ならその時間帯、単一時刻なら以降その日の終わりまで、指定なしは9-15時
      const rg=String(sch.times&&sch.times[0]||'').match(/(\d{1,2}):(\d{2})\s*[-〜~]\s*(\d{1,2}):(\d{2})/);
      const sH=rg?+rg[1]:9, eH=rg?+rg[3]:15, mn=rg?rg[2]:'00';
      times=[]; for(let hh=sH; hh<=eH; hh++) times.push(String(hh).padStart(2,'0')+':'+mn);
    }
    for(const tm of times){
      const mm=String(tm).match(/(\d{1,2}):(\d{2})/); if(!mm) continue;
      const cand=new Date(d.getFullYear(), d.getMonth(), d.getDate(), +mm[1], +mm[2]);
      if(cand>now && (!st || cand>=st)) return cand;
    }
  }
  return null;
}

function fmtFire(d){
  if(!d) return '—';
  const wd=['日','月','火','水','木','金','土'][d.getDay()];
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}(${wd}) ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { activePrompt, activeSchedule, calcNextFire, fmtFire };
}
