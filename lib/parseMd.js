// 外部AIの回答(Markdown箇条書き)をパースする。DOM非依存。
// DB由来のマスター類は ctx で明示的に渡す:
//   ctx.metricsMaster            DB.metricsMaster
//   ctx.sectionMaster            DB.sectionMaster
//   ctx.marketSectionMaster      DB.marketSectionMaster
//   ctx.findMarketStockByName    (name) => 既存の市場・テーマカード(あれば) 省略可
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  var _format = require('./format.js');
  var isNumericValue = _format.isNumericValue, normalizeValueUnit = _format.normalizeValueUnit, shortSrc = _format.shortSrc;
  var _sections = require('./sections.js');
  var resolveSection = _sections.resolveSection;
}

// returns {stock:{name,code}, rows:[{block,key,value,d,src,conf,kind}], failed:[], type, dups:[]}
function parseMd(text, ctx){
  ctx = ctx || {};
  const metricsMaster = ctx.metricsMaster;
  const masters = { sectionMaster: ctx.sectionMaster, marketSectionMaster: ctx.marketSectionMaster };
  const findMarketStockByName = ctx.findMarketStockByName || function(){ return null; };
  const lines=text.split(/\r?\n/); let block=null; const rows=[]; const failed=[]; let stk=null; let type='analysis';
  for(let raw of lines){
    let line=raw.replace(/\*\*/g,'').trim();
    if(!line) continue;
    if(/^```/.test(line)) continue;                                  // コードブロック境界
    if(/^\[[0-9A-F-]{8,}\]\(https?:\/\//i.test(line)) continue;    // citationリンク行
    if(/^(PR TIMES|\+\d+)\s*`*$/i.test(line)) continue;            // 出典フッタ
    let m;
    if(m=line.match(/^#\s*銘柄[:：]\s*(.+?)\s*[\(（]([A-Za-z0-9]+)[\)）]/)){ stk={name:m[1].trim(),code:m[2].trim()}; continue; }
    if(m=line.match(/^#\s*テーマ[:：]\s*(.+)$/)){ const nm=m[1].trim(); const mk=findMarketStockByName(nm); stk={name:nm, code:mk?mk.id:nm, isMarket:true}; continue; }
    if(m=line.match(/^##\s*(.+)$/)){ const b=m[1].trim(); block=b; if(/リマインダー/.test(b))type='reminder'; continue; }
    if(line.startsWith('#')) continue;
    if(/^[-•*・‣▪]\s*/.test(line)){
      let body=line.replace(/^[-•*・‣▪]\s*/,'');
      // key: value | d | src | conf   (labels like 出典: 確信度: tolerated)
      let km=body.match(/^([^:：]+)[:：]\s*(.*)$/);
      if(!km){ failed.push(raw.trim()); continue; }
      let key=km[1].trim(); let rest=km[2].trim();
      let parts=rest.split('|').map(x=>x.trim());
      let value=parts[0]||'';
      let d='',src='',conf='',unit='';
      parts.slice(1).forEach(p=>{
        if(/月期/.test(p)&&p.includes('=')){ value+=' | '+p; return; }
        const confM=p.match(/確信度[:：]\s*(高|中|低)/); if(confM){ conf=confM[1]; return; }
        p=p.replace(/^(出典|確信度|基準日|単位)[:：]\s*/,'');
        if(/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(p)||/^\d{1,2}\/\d{1,2}$/.test(p)) d=p;
        else if(/^(高|中|低)$/.test(p)) conf=p;
        else if(/^単位/.test(parts.find(x=>x.includes(p))||'')||/円|USD|ドル|\$|%/.test(p)&&p.length<8) unit=p.replace(/単位[:：]/,'');
        else src=src?src+' / '+p:p;
      });
      src=shortSrc(src);
      // 数値項目(指標・業績推移)のみ単位を正規化する。分析セクションの本文は一切加工しない。
      const isTrendRow = /[年][0-9]{1,2}月期/.test(value) && value.includes('=');
      const isAnalysisRow = /分析/.test(block||'') || /[（(](サマリ|要点のみ|詳細)[）)]/.test(key);
      if(isTrendRow){
        const segs=value.split('|').map(x=>x.trim()).filter(Boolean);
        const outs=[]; let segUnit='';
        segs.forEach(sg=>{ const mm=sg.split('='); if(mm.length!==2){outs.push(sg);return;}
          const nv=normalizeValueUnit(mm[1].trim(), '');
          if(nv.unit&&!segUnit) segUnit=nv.unit;
          outs.push(mm[0].trim()+'='+nv.v); });
        value=outs.join(' | ');
        if(segUnit&&(!unit||unit==='円')) unit=segUnit;
      } else if(!isAnalysisRow && isNumericValue(value)){
        const nv=normalizeValueUnit(value, unit);
        value=nv.v; if(nv.unit) unit=nv.unit;
      }
      rows.push({block,key,value,d,src,conf,unit, raw:raw.trim()});
    } else { failed.push(raw.trim()); }
  }
  // 見出しが無い行の行き先をキーから推定(GPTの分割出力対策)
  rows.forEach(r=>{
    if(r.block) return;
    if(metricsMaster.snap.includes(r.key)) r.block='指標';
    else if(/[年][0-9]{1,2}月期\s*(\(予\))?\s*=/.test(r.value)||/FY\d{2}\s*=/.test(r.value)) r.block='業績推移';
    else if(resolveSection(r.key,r.value,masters).sub) r.block='分析';
  });
  // 重複除外(同じキーで同じ値が複数回=AIの再出力)
  const seen=new Set(); const dups=[];
  const uniq=rows.filter(r=>{ const sig=r.key+'|'+String(r.value).slice(0,80); if(seen.has(sig)){ dups.push(r); return false; } seen.add(sig); return true; });
  return {stock:stk, rows:uniq, failed, type, dups};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseMd };
}
