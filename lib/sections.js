// 分析セクションのマスター構成に関わる純粋関数。
// DB.sectionMaster / DB.marketSectionMaster / DB.metricsMaster は呼び出し側から明示的に渡す。
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  var _date2 = require('./date.js');
  var daysSince = _date2.daysSince;
}

function isMkt(s){return !!(s&&s.kind==='市場');}

// masters = { sectionMaster, marketSectionMaster }
function masterFor(s, masters){ return isMkt(s) ? masters.marketSectionMaster : masters.sectionMaster; }

// 「要更新」= 取得済みだが古いもの。未取得は数えない(どの指標を重視するかは人によるため)。
// 指標は数えない: 四半期開示のBS項目などは決算直後を除き常に30日超になり、
// 構造的に永久に「要更新」になってしまうため。指標は基準日をそのまま見せる方針。
function staleCount(s, metricsMaster){
  let n=0;
  Object.values(s.sections).forEach(v=>{ if(v && daysSince(v.d)>90) n++; });
  return n;
}

function allSubs(sectionMaster){ const a=[]; sectionMaster.forEach(c=>{ if(c.on) c.subs.forEach(su=>a.push({cat:c.cat,sub:su})); }); return a; }
function filledCatCount(s, cat, sectionMaster){ const c=sectionMaster.find(x=>x.cat===cat); if(!c)return 0; return c.subs.filter(su=>s.sections[su]).length; }

// masters = { sectionMaster, marketSectionMaster }
function knownSubs(masters){ const a=[]; masters.sectionMaster.forEach(c=>c.subs.forEach(su=>a.push(su))); (masters.marketSectionMaster||[]).forEach(c=>c.subs.forEach(su=>a.push(su))); return a; }

// 「主要競合(サマリ)」「競争環境: 主要競合(サマリ)」「競争環境: 主要競合(詳細): 本文」いずれも解決する
function resolveSection(rawKey, rawValue, masters){
  let key=String(rawKey||'').trim(), value=String(rawValue||'').trim();
  let layer=null;
  const pick=(s)=>{ const m=s.match(/^(.*?)[（(](サマリ|要点のみ|詳細)[）)]\s*$/); if(m) return {base:m[1].trim(), lay:(m[2]==='詳細'?'詳細':'サマリ')}; return null; };
  // ケースA: キー自体にレイヤー表記がある
  let p=pick(key);
  if(p){ key=p.base; layer=p.lay; }
  // ケースB: キーがカテゴリ名で、値の先頭が「サブ項目(レイヤー): 本文」
  const cats=masters.sectionMaster.map(c=>c.cat).concat((masters.marketSectionMaster||[]).map(c=>c.cat));
  if(cats.includes(key)){
    const m=value.match(/^([^:：]+)[:：]\s*([\s\S]*)$/);
    if(m){ const p2=pick(m[1].trim()); if(p2){ key=p2.base; layer=p2.lay; value=m[2].trim(); } else { key=m[1].trim(); value=m[2].trim(); } }
  }
  // キー内に「カテゴリ: サブ項目」が同居している場合
  if(key.includes(':')||key.includes('：')){
    const parts=key.split(/[:：]/).map(x=>x.trim()).filter(Boolean);
    const last=parts[parts.length-1]; const p3=pick(last);
    if(p3){ key=p3.base; layer=p3.lay; } else { key=last; }
  }
  const subs=knownSubs(masters);
  if(!subs.includes(key)){
    const hit=subs.find(su=>key.includes(su)||su.includes(key));
    if(hit) key=hit; else return {sub:null, layer:layer||'サマリ', value};
  }
  return {sub:key, layer:layer||'サマリ', value};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isMkt, masterFor, staleCount, allSubs, filledCatCount, knownSubs, resolveSection };
}
