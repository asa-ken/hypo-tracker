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

// 説明書が使う見出し語。「#」が落ちた行をこれと突き合わせて見出しに戻す
const BARE_HEADINGS=/^(指標|業績推移|ざっくりまとめ|分析|注目ポイント|メモ|リマインダー|回答フォーマット)$/;

// returns {stock:{name,code}, rows:[{block,key,value,d,src,conf,kind}], failed:[], type, dups:[], memoCandidates:[]}
function parseMd(text, ctx){
  ctx = ctx || {};
  const metricsMaster = ctx.metricsMaster;
  const masters = { sectionMaster: ctx.sectionMaster, marketSectionMaster: ctx.marketSectionMaster };
  const findMarketStockByName = ctx.findMarketStockByName || function(){ return null; };
  const lines=text.split(/\r?\n/); let block=null; let rows=[]; const failed=[]; let stk=null; let type='analysis';
  // 見出しにも箇条書きにも当てはまらない自由文(会話の地の文)は、メモ候補として連続した段落単位にまとめる
  const memoCandidates=[]; let pendingFree=[];
  const flushFree=()=>{ if(pendingFree.length){ memoCandidates.push(pendingFree.join('\n')); pendingFree=[]; } };
  for(let raw of lines){
    let line=raw.replace(/\*\*/g,'').trim();
    if(!line) { flushFree(); continue; }
    if(/^```/.test(line)) continue;                                  // コードブロック境界
    if(/^\[[0-9A-F-]{8,}\]\(https?:\/\//i.test(line)) continue;    // citationリンク行
    if(/^(PR TIMES|\+\d+)\s*`*$/i.test(line)) continue;            // 出典フッタ
    let m;
    // 見出しの「#」は落ちることがある(Markdownとして描画された画面からコピーすると
    // 見出し記号ごと消える)。落ちると銘柄も見出しも判定できず、見出し語がそのまま
    // メモ候補に混ざるので、「#」は無くても見出しとして読む
    // 「銘柄またはテーマ:」は、対象未選択のまま質問文を生成したときにアプリ自身が
    // 埋め込むプレースホルダー見出し(genOrderNew)。AIがこれを字面通り使うことがあるため、
    // 「銘柄:」「テーマ:」と同じものとして読む(コード付きなら銘柄、無ければテーマ扱い)
    if(m=line.match(/^#*\s*銘柄(?:またはテーマ)?[:：]\s*(.+?)\s*[\(（]([A-Za-z0-9]+)[\)）]/)){ stk={name:m[1].trim(),code:m[2].trim()}; flushFree(); continue; }
    if(m=line.match(/^#+\s*(?:銘柄またはテーマ|テーマ)[:：]\s*(.+)$/)){ const nm=m[1].trim(); const mk=findMarketStockByName(nm); stk={name:nm, code:mk?mk.id:nm, isMarket:true}; flushFree(); continue; }
    if(m=line.match(/^##\s*(.+)$/)){ const b=m[1].trim(); block=b; if(/リマインダー/.test(b))type='reminder'; flushFree(); continue; }
    // 「#」が落ちた見出し。既知の見出し語と完全に一致する行だけを対象にして、
    // 同じ語で始まる普通の文章(「分析すると…」など)を巻き込まないようにする
    if(BARE_HEADINGS.test(line)){ block=line; if(/リマインダー/.test(line))type='reminder'; flushFree(); continue; }
    if(line.startsWith('#')) { flushFree(); continue; }
    if(/^[-•*・‣▪]\s*/.test(line)){
      flushFree();
      let body=line.replace(/^[-•*・‣▪]\s*/,'');
      // key: value | d | src | conf   (labels like 出典: 確信度: tolerated)
      let km=body.match(/^([^:：]+)[:：]\s*(.*)$/);
      // メモ・注目ポイントは自由記述なので「キー: 値」の形を強制しない。読めなかった行に
      // 落とすと、往復が1回増える(整形しなおしプロンプト経由)。以前は注目ポイントだけこの
      // 救済が無く、メモとの書式指示の非対称(説明書側は「本文:」を求める)によりGPTが
      // 「本文:」を省いた箇条書きで出すと、まるごと読めなかった行に落ちていた(ユーザー指摘、2026-08-15)
      if(!km && (block==='メモ'||block==='注目ポイント')){ rows.push({block, key:'本文', value:body, d:'', src:'', conf:'', unit:'', raw:raw.trim()}); continue; }
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
    } else { pendingFree.push(line); }
  }
  flushFree();
  // 見出しが無い行の行き先をキーから推定(GPTの分割出力対策)。
  // 「## 分析」の中に財務指標・業績推移の生数値(売上高: 25年3月期=...など)がまとめて
  // 出力され、既存の分析サブ項目名(顧客セグメント・技術力など)と一致せず「その他」に
  // 落ちるケースがあったため、既に分析サブ項目として一致する行以外は「## 分析」配下でも
  // 同じ推定を働かせる(ユーザー報告、2026-08-13)
  rows.forEach(r=>{
    if(r.block && r.block!=='分析') return;
    if(r.block==='分析' && resolveSection(r.key,r.value,masters).sub) return;
    if(metricsMaster.snap.includes(r.key)) r.block='指標';
    else if(/[年][0-9]{1,2}月期\s*(\(予\))?\s*=/.test(r.value)||/FY\d{2}\s*=/.test(r.value)) r.block='業績推移';
    else if(resolveSection(r.key,r.value,masters).sub) r.block='分析';
  });
  // 「## 注目ポイント」: 本文＋(任意)イベント日を1カード分の行にまとめる。
  // 複数回登場する場合も、本文の出現ごとに新しいまとまりとして分離する。
  let merged=[]; let pending=null;
  const flushPending=()=>{ if(pending){ merged.push(pending); pending=null; } };
  rows.forEach(r=>{
    if(r.block!=='注目ポイント'){ flushPending(); merged.push(r); return; }
    if(r.key==='本文'){ flushPending(); pending={block:'注目ポイント', key:'注目ポイント', value:r.value, eventDate:null, raw:r.raw}; }
    else if(/イベント日/.test(r.key) && pending){ pending.eventDate=r.value; }
    // 本文・イベント日以外(出典/確信度など、本文より前に来たイベント日も含む)は
    // カード化するとゴミが増えるため、メモ候補に回してユーザーの判断に委ねる
    else { memoCandidates.push(r.key+': '+r.value); }
  });
  flushPending();
  rows=merged;
  // 「## メモ」: 会話の中で本人が述べた考えを外部AIに拾ってもらうための欄。
  // 保存先はメモ候補と同じなので、ここで候補に合流させて画面で消せるようにする。
  // 見出しの無い自由文より確度が高いので、候補の先頭に置く
  const explicitMemos=[];
  rows=rows.filter(r=>{
    if(r.block!=='メモ') return true;
    // 「- 本文: ◯◯」でも「- ◯◯」でも受ける(ラベルの有無を外部AIに強制しない)
    const t=(/^(本文|メモ)$/.test(r.key)?r.value:(r.key+': '+r.value)).trim();
    if(t) explicitMemos.push(t);
    return false;
  });
  memoCandidates.unshift(...explicitMemos);
  // 重複除外(同じキーで同じ値が複数回=AIの再出力)
  const seen=new Set(); const dups=[];
  const uniq=rows.filter(r=>{ const sig=r.key+'|'+String(r.value).slice(0,80); if(seen.has(sig)){ dups.push(r); return false; } seen.add(sig); return true; });
  return {stock:stk, rows:uniq, failed, type, dups, memoCandidates};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseMd };
}
