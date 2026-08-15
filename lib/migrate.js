// 初期データ(seed)と、旧バージョンのデータ構造を現行構造へ変換するmigrate。DOM非依存。
function seed(){
  return {
    // ROEは指標(単年)と業績推移(複数年)の両方に登録されると、外部AIへの説明書が
    // 「ROEは指標としても業績推移としても書ける」と伝えてしまい表記ゆれの温床になるため、
    // 業績推移側だけに置く(ユーザー指摘・確認の上、2026-08-13)
    metricsMaster:{
      snap:['PER(予想)','PBR','自己資本比率','配当利回り(予想)'],
      trend:[{name:'売上高'},{name:'営業利益'},{name:'EPS'},{name:'ROE'}],
      hiddenSnap:[], hiddenTrend:[]
    },
    // 市場カードは粒度(scope)ごとに語彙が違うので、指標マスターを分けて持つ。
    // 例: 「日本株市場」に騰落レシオは効くが「データセンター業界」には無意味
    marketMetricsMaster:{   // scope:'市場' … 日本株市場、米国株市場など
      // 日次で動く株価指数・移動平均は入れない(証券アプリの役割)。
      // 数か月単位で水準を比べられるもの＝バリュエーション・金利・為替・過熱度に絞る
      snap:['予想PER(市場全体)','長期金利(10年)','為替(USD/JPY)'],
      hiddenSnap:[]
    },
    // scope:'業界'。生成AIは業種別の中央値を自力で算出できず捏造しやすいため、
    // 公表値が手に入るバリュエーションだけに絞る。ROE・営業利益率などの水準は
    // 数値ではなく分析セクションに文章で残す方針
    industryMetricsMaster:{
      snap:['PER','PBR'],
      hiddenSnap:[]
    },
    themeMetricsMaster:{    // scope:'テーマ' … AI、脱炭素など。数値化しにくいので既定は置かず取り込みで育てる
      snap:[],
      hiddenSnap:[]
    },
    sectionMaster:[
      {cat:'ビジネスモデル', on:true, subs:['収益モデル','顧客セグメント','提供価値','事業構造','収益の安定性']},
      {cat:'財務', on:true, subs:['実績財務(PL/BS/CF)','財務健全性・効率性']},
      {cat:'市場環境', on:true, subs:['市場規模(TAM/SAM/SOM)','市場成長率','産業構造','技術トレンド','マクロ要因']},
      {cat:'競争環境', on:true, subs:['主要競合','競争優位性・差別化']},
      {cat:'技術', on:true, subs:['技術力','技術ロードマップ','模倣困難性','生産・オペレーション技術','技術依存リスク','技術トレンド整合性']},
      {cat:'ガバナンス', on:false, subs:['経営陣の質','取締役会構成','インセンティブ設計','ESG']},
      {cat:'リスク要因', on:true, subs:['事業リスク','財務リスク','市場リスク','オペレーションリスク','法務リスク']},
      {cat:'株主還元', on:false, subs:['配当方針','自社株買い','総還元性向','資本政策']}
    ],
    marketSectionMaster:[   // scope:'市場'
      {cat:'現状認識', on:true, subs:['何が起きているか','市場コンセンサス']},
      {cat:'金融環境', on:true, subs:['金利・金融政策','流動性']},
      {cat:'需給', on:true, subs:['投資主体別動向','ポジション・センチメント']},
      {cat:'割高・割安の水準', on:true, subs:['市場全体の割高・割安','セクター別の割高・割安']},
      {cat:'注目イベント', on:true, subs:['注目日程','想定シナリオ']},
      {cat:'強弱シナリオ', on:true, subs:['強気シナリオ','弱気シナリオ','転換の観測ポイント']},
      {cat:'自分の銘柄への影響', on:true, subs:['保有・ウォッチ銘柄への影響']}
    ],
    industrySectionMaster:[ // scope:'業界' … 市場全体の需給や金利ではなく、産業側の構造を見る
      {cat:'現状認識', on:true, subs:['何が起きているか','業界コンセンサス']},
      {cat:'市場規模・成長性', on:true, subs:['市場規模と内訳','成長率と driver','需要の持続性']},
      {cat:'産業構造', on:true, subs:['バリューチェーン','収益が集まる場所','参入障壁']},
      {cat:'競争環境', on:true, subs:['主要プレイヤーとシェア','価格動向・採算']},
      {cat:'技術・規制', on:true, subs:['技術トレンド','規制・政策']},
      {cat:'注目イベント', on:true, subs:['注目日程','想定シナリオ']},
      {cat:'強弱シナリオ', on:true, subs:['強気シナリオ','弱気シナリオ','転換の観測ポイント']},
      {cat:'自分の銘柄への影響', on:true, subs:['保有・ウォッチ銘柄への影響']}
    ],
    themeSectionMaster:[    // scope:'テーマ' … 業界横断の切り口。数値より「広がり」と「進み具合」を見る
      {cat:'現状認識', on:true, subs:['何が起きているか','市場コンセンサス']},
      {cat:'テーマの中身', on:true, subs:['何が新しいのか','広がりの範囲']},
      {cat:'進捗と実績', on:true, subs:['実装・普及の進み具合','収益化の実例']},
      {cat:'追い風・向かい風', on:true, subs:['政策・規制','ボトルネック']},
      {cat:'関連する業界・銘柄', on:true, subs:['恩恵を受ける側','逆風を受ける側']},
      {cat:'注目イベント', on:true, subs:['注目日程','想定シナリオ']},
      {cat:'強弱シナリオ', on:true, subs:['強気シナリオ','弱気シナリオ','転換の観測ポイント']},
      {cat:'自分の銘柄への影響', on:true, subs:['保有・ウォッチ銘柄への影響']}
    ],
    askPrefs:{mode:'new', level:'標準', picks:{}, themes:{}},
    // 一覧の見た目の好み。閉じている区分の名前を持つ(件数が増えると縦に長くなるため畳めるようにした)
    uiPrefs:{anaClosed:[]},
    stocks:[
      {id:'5803', name:'フジクラ', code:'5803', kind:'保有',
       metrics:{'PER(予想)':{v:'36.2',unit:'',d:'2026/7/13'},
                'PBR':{v:'14.79',unit:'',d:'2026/7/13'},
                '時価総額':{v:'88883',unit:'百万円',d:'2026/7/13'},
                '信用倍率':{v:'23.41',unit:'',d:'2026/7/10'}},
       trend:{'売上高':{'25年3月期':'979375','26年3月期':'1182358','27年3月期(予)':'1462000',unit:'百万円'},
              '営業利益':{'25年3月期':'135519','26年3月期':'188707','27年3月期(予)':'310000',unit:'百万円'},
              'EPS':{'25年3月期':'55.1','26年3月期':'94.9','27年3月期(予)':'138.3',unit:'円'}},
       sections:{'事業構造':{t:'情報通信向け光ファイバ・ケーブル、自動車用電装品、電力ケーブルをグローバルに製造販売する非鉄メーカー。',d:'2026/7/13',details:[]},
                 '市場成長率':{t:'データセンター・5G向け光通信需要が拡大。AI・DCのCAPEX増が追い風。',d:'2026/7/13',details:[]},
                 '事業リスク':{t:'光ファイバ価格・原材料市況の変動、設備投資負担、為替・世界景気減速による需要調整。',d:'2026/7/13',details:[]},
                 '主要競合':{t:'古河電工、住友電工と光ケーブルで競合。DC向けで相対優位を主張。',d:'2026/7/13',details:[]}},
       mine:[{ts:'2026/7/12',t:'DC向け光ケーブルの需給が本丸。古河電工とのペアで見る。'}]
      }
    ],
    hypotheses:[
      {id:'h1', stockId:'5803', kind:'watch', text:'データセンター向け光ケーブル需要で高値更新が続くか。DC事業者のCAPEX動向・情報通信セグメントの利益率・古河電工との相対強弱を見る。強含みなら強気継続、鈍化なら注意。',
       remindHint:{date:'2026/8/7', note:'1Q決算'}}
    ],
    reminders:[
      {id:'r1', stockId:'5803', title:'フジクラ需給・AI関連ニュース監視', comment:'決算後の需給変化とAI・DC関連報道を毎日チェック',
       cat:'報道確認', freq:'平日', times:['09:15','15:30'], startDate:null, endDate:null, paused:false,
       changes:[{cond:'1Q決算 2026/8/7 になったら', freq:'毎日', times:'08:30,12:30,18:00'}],
       prompt:'フジクラ(5803)について、光ファイバ需給/AI・DC関連ニュース/信用残・出来高/同業(古河電工・住友電工)動向を重要度順に3〜6点で要約し、最後に注目度(高/中/低)を付けてください。',
       src:'GPT', srcDate:'2026/7/13', log:[{d:'2026/7/11',type:'変化なし'}], nextFire:null, hypoIds:[]}
    ]
  };
}

// 既定にある項目は、一覧に戻すとき既定の並びでの位置に差し込む(末尾に飛ばさない)。
// 既定に無い項目(ユーザーが自分で足したもの)は並べ替えようがないので末尾に足す
function insertByDefault(arr, item, defNames, nameOf){
  const name=nameOf(item);
  const di=defNames.indexOf(name);
  if(di<0){ arr.push(item); return; }
  let at=0;
  for(let i=0;i<di;i++){ const j=arr.findIndex(x=>nameOf(x)===defNames[i]); if(j>=0) at=Math.max(at, j+1); }
  arr.splice(at, 0, item);
}
function migrate(db){
  if(!db) return null;
  const s0=seed();
  // 新フィールドの補完
  if(!db.sectionMaster) db.sectionMaster=s0.sectionMaster;
  if(!db.marketSectionMaster) db.marketSectionMaster=s0.marketSectionMaster;
  // 市場マスターの旧名称を平易な名称へ読み替え
  {
    const CATMAP={'バリュエーション':'割高・割安の水準','カタリスト・イベント':'注目イベント','銘柄への含意':'自分の銘柄への影響'};
    const SUBMAP={'市場全体の水準感':'市場全体の割高・割安','セクター別の水準感':'セクター別の割高・割安'};
    (db.marketSectionMaster||[]).forEach(c=>{
      if(CATMAP[c.cat]) c.cat=CATMAP[c.cat];
      c.subs=c.subs.map(su=>SUBMAP[su]||su);
    });
    (db.stocks||[]).forEach(st=>{
      if(st.kind!=='市場'||!st.sections) return;
      Object.keys(st.sections).forEach(k=>{
        if(SUBMAP[k]){ const nk=SUBMAP[k]; if(!st.sections[nk]) st.sections[nk]=st.sections[k]; delete st.sections[k]; }
      });
    });
  }
  if(!db.askPrefs) db.askPrefs={mode:'new', level:'標準', picks:{}, themes:{}};
  if(!db.askPrefs.themes) db.askPrefs.themes={};
  if(!db.uiPrefs) db.uiPrefs={anaClosed:[]};
  if(!Array.isArray(db.uiPrefs.anaClosed)) db.uiPrefs.anaClosed=[];
  // 回数(count)→終了日(endDate)へ移行。回数は概念ごと廃止
  (db.reminders||[]).forEach(r=>{
    if(r.endDate===undefined) r.endDate=null;
    if('count' in r) delete r.count;
    (r.changes||[]).forEach(c=>{ if('count' in c) delete c.count; });
    // 紐付けを単一hypoIdから配列hypoIdsへ。
    // 同じイベント日(同じ決算など)の注目ポイントを1つのリマインダーでまとめて見るため
    if(!Array.isArray(r.hypoIds)) r.hypoIds = r.hypoId ? [r.hypoId] : [];
    if('hypoId' in r) delete r.hypoId;
  });
  if(!db.metricsMaster) db.metricsMaster=s0.metricsMaster;
  if(!db.metricsMaster.hiddenSnap) db.metricsMaster.hiddenSnap=[];
  if(!db.metricsMaster.hiddenTrend) db.metricsMaster.hiddenTrend=[];
  // 市場カードの粒度(市場/業界/テーマ)ごとのマスター(旧データには存在しない)
  ['marketMetricsMaster','industryMetricsMaster','themeMetricsMaster'].forEach(k=>{
    if(!db[k]) db[k]=s0[k];
    if(!db[k].snap) db[k].snap=[];
    if(!db[k].hiddenSnap) db[k].hiddenSnap=[];
  });
  // 既定指標を入れ替えた分は、ユーザーが編集していない(過去のいずれかの既定のままの)場合だけ差し替える。
  // 既定から外れた項目は「非表示」に送る。取り込み済みのデータが画面から消えたまま
  // 復元手段が無くなるのを避けるため(非表示一覧から復元できる)
  {
    const RESET=[
      {k:'metricsMaster', olds:[
        ['PER(予想)','PBR','時価総額','配当利回り(予想)','信用倍率','目標株価コンセンサス'],
      ]},
      {k:'marketMetricsMaster', olds:[
        ['予想PER(市場全体)','PBR(市場全体)','配当利回り(市場全体)','騰落レシオ(25日)','信用評価損益率','長期金利(10年)'],
        ['予想PER(市場全体)','PBR(市場全体)','長期金利(10年)','為替(USD/JPY)','騰落レシオ(25日)','VIX指数'],
      ]},
      {k:'industryMetricsMaster', olds:[
        ['市場規模','市場成長率(YoY)','設備投資額'],
        ['PER','PBR','EBITDA','ROE','営業利益率','自己資本比率'],
      ]},
    ];
    RESET.forEach(({k,olds})=>{
      const cur=db[k].snap||[];
      const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
      if(!olds.some(o=>same(cur,o))) return;
      const next=s0[k].snap.slice();
      db[k].hiddenSnap=db[k].hiddenSnap||[];
      cur.forEach(x=>{ if(!next.includes(x)&&!db[k].hiddenSnap.includes(x)) db[k].hiddenSnap.push(x); });
      db[k].snap=next;
    });
  }
  // 非表示は以前「一覧から取り除いて別リストへ移す」実装だった。そのため非表示にした瞬間に
  // 元がスナップショットだったのか業績推移だったのかも、並び順も失われていた。
  // 一覧には残したまま名前で印を付けるだけに改め、旧データも一覧へ戻す。
  // 戻す位置は末尾ではなく既定の並びでの位置。末尾に足すと、例えばPER(予想)が
  // 指標グリッドの2ページ目に飛び、1ページ目が「データなし」だけになって見つけられなくなる
  {
    const mm=db.metricsMaster;
    const ht=mm.hiddenTrend||[]; mm.hiddenTrend=[];
    ht.forEach(x=>{
      const name=(typeof x==='string')?x:(x&&x.name);
      if(!name) return;
      if(!mm.trend.some(t=>t.name===name)) insertByDefault(mm.trend, {name}, s0.metricsMaster.trend.map(t=>t.name), t=>t.name);
      if(!mm.hiddenTrend.includes(name)) mm.hiddenTrend.push(name);
    });
    [[mm,s0.metricsMaster],[db.marketMetricsMaster,s0.marketMetricsMaster],
     [db.industryMetricsMaster,s0.industryMetricsMaster],[db.themeMetricsMaster,s0.themeMetricsMaster]].forEach(([m,def])=>{
      if(!m) return;
      m.snap=m.snap||[];
      m.hiddenSnap=(m.hiddenSnap||[]).map(x=>(typeof x==='string')?x:(x&&x.name)).filter(Boolean);
      m.hiddenSnap.forEach(k=>{ if(!m.snap.includes(k)) insertByDefault(m.snap, k, def.snap, x=>x); });
    });
  }
  // 指標マスターの表記ゆれ統合(2026-08-13、ユーザー報告・確認の上で実施)。
  // EPS↔1株当たり当期純利益、ROE↔自己資本利益率、売上↔売上高が、それぞれ別々の指標として
  // 登録され、外部AIへの説明書(briefingText)がその重複した一覧をそのまま埋め込むため、
  // 表記ゆれが自己増殖する状態になっていた。英語略称(EPS/ROE)、またはより具体的な
  // 業績推移名(売上高)を正として統合する
  {
    const mm=db.metricsMaster;
    // 業績推移どうしの別名統合: 正名に無い年度だけ補う(両方にある年度は正名を優先)
    const TREND_ALIAS=[['売上','売上高'],['1株当たり当期純利益','EPS'],['1株当たり純利益','EPS'],['自己資本利益率','ROE']];
    (db.stocks||[]).forEach(st=>{
      if(!st.trend) return;
      TREND_ALIAS.forEach(([from,to])=>{
        if(!st.trend[from]) return;
        if(!st.trend[to]) st.trend[to]=st.trend[from];
        else Object.keys(st.trend[from]).forEach(y=>{ if(y!=='unit' && !(y in st.trend[to])) st.trend[to][y]=st.trend[from][y]; });
        delete st.trend[from];
      });
    });
    const droppedTrend=['売上','1株当たり当期純利益','1株当たり純利益','自己資本利益率'];
    mm.trend=(mm.trend||[]).filter(t=>!droppedTrend.includes(t.name));
    if(!mm.trend.some(t=>t.name==='EPS')) mm.trend.push({name:'EPS'});
    if(!mm.trend.some(t=>t.name==='ROE')) mm.trend.push({name:'ROE'});
    // 指標(単年)は業績推移(複数年)と役割が重なるため一覧からは隠す。
    // 既存の各銘柄のデータ自体は削除しない(非表示中の指標として復元できる、既存の仕組みと同じ扱い。
    // 削除してしまうと、業績推移側にデータが無い銘柄の値まで失われてしまうため)
    ['ROE','営業利益率'].forEach(name=>{
      if(mm.snap.includes(name) && !mm.hiddenSnap.includes(name)) mm.hiddenSnap.push(name);
    });
  }
  if(!db.industrySectionMaster) db.industrySectionMaster=s0.industrySectionMaster;
  if(!db.themeSectionMaster) db.themeSectionMaster=s0.themeSectionMaster;
  // 既存の市場カードは粒度が未設定なので「市場」扱いにする(従来の語彙がそのまま使える)
  (db.stocks||[]).forEach(st=>{ if(st.kind==='市場' && !st.scope) st.scope='市場'; });
  // 旧セクション名 → 新体系サブ項目への読み替え
  const MAP={'事業・ビジネスモデル':'事業構造','成長ドライバー':'市場成長率','リスク要因':'事業リスク','競合ポジション':'主要競合','技術':'技術力'};
  (db.stocks||[]).forEach(st=>{
    if(!st.sections) st.sections={};
    Object.keys(st.sections).forEach(k=>{
      const v=st.sections[k];
      if(v===null){ delete st.sections[k]; return; }           // 旧「未取得」プレースホルダは削除
      if(MAP[k]){ const nk=MAP[k]; if(!st.sections[nk]) st.sections[nk]=v; delete st.sections[k]; }
      if(v&&!v.details) v.details=[];
    });
  });
  // 旧「自分の見解(mine)」をメモ型カードに移行
  (db.stocks||[]).forEach(st=>{
    if(st.mine&&st.mine.length){
      db.hypotheses=db.hypotheses||[];
      st.mine.forEach(m=>{ db.hypotheses.push({id:'h'+Math.random().toString(36).slice(2,9), stockId:st.id, kind:'memo', text:m.t, createdAt:m.ts}); });
      delete st.mine;
    }
  });
  // 廃止された 'hypo' 種別(検証ポイント・判定・版管理)を 'watch'(注目ポイント)へ変換。
  // text・eventDate・eventNoteは引き継ぎ、points・judgeLog・ver・verLog・stateは破棄する。
  (db.hypotheses||[]).forEach(h=>{ if(!h.kind) h.kind='hypo'; });
  db.hypotheses=(db.hypotheses||[]).map(h=>{
    if(h.kind!=='hypo') return h;
    return {
      id:h.id, stockId:h.stockId, kind:'watch',
      text:h.text, eventDate:h.eventDate||null, eventNote:h.eventNote||null,
      createdAt:h.createdAt
    };
  });
  // 「注目イベント(eventDate)」という独立した概念を廃止し、日付の管理はリマインダーに一本化する。
  // ホーム画面で「注目イベント」と「リマインダー」が別物として並んでいたのが混乱の元だったため、
  // 日付つきの注目ポイントは「リマインド候補(remindHint)」に移し、登録を促すだけの存在にする。
  // 既にリマインダーが紐づいているものは登録済みなので候補を作らない。
  {
    const linked=new Set();
    (db.reminders||[]).forEach(r=>(r.hypoIds||[]).forEach(id=>linked.add(id)));
    (db.hypotheses||[]).forEach(h=>{
      if(h.kind==='watch' && h.eventDate && !h.remindHint && !linked.has(h.id)){
        h.remindHint={date:h.eventDate, note:h.eventNote||null};
      }
      delete h.eventDate; delete h.eventNote; delete h.eventType;
    });
  }
  // 誤登録カードのクリーニング
  // ①kindが正規値以外なら「ウォッチ」に補正
  (db.stocks||[]).forEach(st=>{ if(!['保有','ウォッチ','市場'].includes(st.kind)) st.kind='ウォッチ'; });
  // ②市場カードと同名の「実質空の非市場カード」(取り込み時の誤登録)を削除
  {
    const mktNames=new Set((db.stocks||[]).filter(s=>s.kind==='市場').map(s=>s.name));
    db.stocks=(db.stocks||[]).filter(st=>{
      if(st.kind==='市場') return true;
      const empty=(!st.metrics||!Object.keys(st.metrics).length)&&(!st.sections||!Object.keys(st.sections).length)&&(!st.mine||!st.mine.length)&&(!st.trend||!Object.keys(st.trend).length);
      if(mktNames.has(st.name)&&empty) return false;   // 市場カードの同名空カードは誤登録として除去
      return true;
    });
  }
  return db;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { seed, migrate };
}
