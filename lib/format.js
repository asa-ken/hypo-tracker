// 文字列・数値の整形/正規化ユーティリティ。DOM・DB非依存の純粋関数のみ。
function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

function fmtNum(v){ const s=String(v).replace(/,/g,''); if(!/^-?\d+(\.\d+)?$/.test(s)) return v; const p=s.split('.'); return Number(p[0]).toLocaleString('en-US')+(p[1]?'.'+p[1]:''); }

// citation付きMarkdownリンクやURLを除去し、ドメイン名程度に短縮する
function shortSrc(s){
  if(!s) return '';
  let x=String(s);
  x=x.replace(/\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g, (m,label,url)=>{
    try{ const h=url.match(/^https?:\/\/([^\/\?]+)/); return (h?h[1].replace(/^www\./,''):(label||'')); }catch(e){ return label||''; }
  });
  x=x.replace(/https?:\/\/\S+/g,'').replace(/\s{2,}/g,' ').replace(/\s*\/\s*$/,'').trim();
  // 重複ドメインの除去
  const parts=[...new Set(x.split(/[\/、,]\s*/).map(y=>y.trim()).filter(Boolean))];
  x=parts.join(' / ');
  return x.length>40?x.slice(0,40)+'…':x;
}

// 値が「単独の数値(+単位)」に見えるか。文章は false。
function isNumericValue(v){
  const s=String(v).trim();
  if(s.length>24) return false;                       // 長い=文章
  if(/[。、！？]/.test(s)) return false;               // 句読点=文章
  if(/[ぁ-んァ-ヶ]{3,}/.test(s)) return false;         // かな連続=文章
  return /^[\-\d,.,]+\s*(兆|億|万)?\s*[\d,.]*\s*(億円|百万円|百万USD|万円|円|倍|%|USD|ドル|\$[BM]?)?\s*$/.test(s);
}

// 日本語の位取り単位を正規化: 「1兆3425億円」→ {v:13425, unit:'億円'} 等
// 文章(isNumericValueがfalseを返す値)は一切加工しない
function normalizeValueUnit(value, unit){
  if(!isNumericValue(value)) return {v:String(value), unit:String(unit||'')};   // 文章は加工しない
  let v=String(value).trim(); let u=String(unit||'').trim();
  if(/兆|億|万/.test(v)){
    let total=0; let m;
    if(m=v.match(/([\d,\.]+)\s*兆/)) total+=parseFloat(m[1].replace(/,/g,''))*10000;   // 兆→億換算
    if(m=v.match(/([\d,\.]+)\s*億/)) total+=parseFloat(m[1].replace(/,/g,''));
    if(total>0){ return {v:String(Math.round(total*100)/100), unit:'億円'}; }
  }
  const um=v.match(/^([\-\d,\.]+)\s*(億円|百万円|百万USD|万円|円|倍|%|USD|\$[BM]?)$/);
  if(um){ return {v:um[1].replace(/,/g,''), unit:um[2]}; }
  return {v:v.replace(/,/g,''), unit:u};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, fmtNum, shortSrc, isNumericValue, normalizeValueUnit };
}
