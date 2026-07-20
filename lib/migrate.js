// 初期データ(seed)と、旧バージョンのデータ構造を現行構造へ変換するmigrate。DOM非依存。
function seed(){
  return {
    metricsMaster:{
      snap:['PER(予想)','PBR','時価総額','配当利回り(予想)','信用倍率','目標株価コンセンサス'],
      trend:[{name:'売上高',graph:true},{name:'営業利益',graph:true},{name:'EPS',graph:true}],
      hiddenSnap:[], hiddenTrend:[]
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
    marketSectionMaster:[
      {cat:'現状認識', on:true, subs:['何が起きているか','市場コンセンサス']},
      {cat:'金融環境', on:true, subs:['金利・金融政策','流動性']},
      {cat:'需給', on:true, subs:['投資主体別動向','ポジション・センチメント']},
      {cat:'割高・割安の水準', on:true, subs:['市場全体の割高・割安','セクター別の割高・割安']},
      {cat:'注目イベント', on:true, subs:['注目日程','想定シナリオ']},
      {cat:'強弱シナリオ', on:true, subs:['強気シナリオ','弱気シナリオ','転換の観測ポイント']},
      {cat:'自分の銘柄への影響', on:true, subs:['保有・ウォッチ銘柄への影響']}
    ],
    askPrefs:{mode:'new', level:'標準', picks:{}, themes:{}},
    stocks:[
      {id:'5803', name:'フジクラ', code:'5803', kind:'保有',
       metrics:{'PER(予想)':{v:'36.2',unit:'',d:'2026/7/13',src:'銘柄スカウター',conf:'高'},
                'PBR':{v:'14.79',unit:'',d:'2026/7/13',src:'銘柄スカウター',conf:'高'},
                '時価総額':{v:'88883',unit:'百万円',d:'2026/7/13',src:'株予報Pro',conf:'高'},
                '信用倍率':{v:'23.41',unit:'',d:'2026/7/10',src:'株探',conf:'中'}},
       trend:{'売上高':{'25年3月期':'979375','26年3月期':'1182358','27年3月期(予)':'1462000',unit:'百万円'},
              '営業利益':{'25年3月期':'135519','26年3月期':'188707','27年3月期(予)':'310000',unit:'百万円'},
              'EPS':{'25年3月期':'55.1','26年3月期':'94.9','27年3月期(予)':'138.3',unit:'円'}},
       sections:{'事業構造':{t:'情報通信向け光ファイバ・ケーブル、自動車用電装品、電力ケーブルをグローバルに製造販売する非鉄メーカー。',d:'2026/7/13',src:'株予報Pro',details:[]},
                 '市場成長率':{t:'データセンター・5G向け光通信需要が拡大。AI・DCのCAPEX増が追い風。',d:'2026/7/13',src:'株予報Pro',details:[]},
                 '事業リスク':{t:'光ファイバ価格・原材料市況の変動、設備投資負担、為替・世界景気減速による需要調整。',d:'2026/7/13',src:'株予報Pro',details:[]},
                 '主要競合':{t:'古河電工、住友電工と光ケーブルで競合。DC向けで相対優位を主張。',d:'2026/7/13',src:'株予報Pro',details:[]}},
       mine:[{ts:'2026/7/12',t:'DC向け光ケーブルの需給が本丸。古河電工とのペアで見る。'}]
      }
    ],
    hypotheses:[
      {id:'h1', stockId:'5803', ver:2, text:'データセンター向け光ケーブル需要で高値更新が続く',
       points:['DC事業者のCAPEX拡大継続','情報通信セグメントの利益率改善','古河電工との相対強さ'],
       eventType:'date', eventDate:'2026/8/7', eventNote:'1Q決算', state:'検証待ち', judgeLog:[]}
    ],
    reminders:[
      {id:'r1', stockId:'5803', title:'フジクラ需給・AI関連ニュース監視', comment:'決算後の需給変化とAI・DC関連報道を毎日チェック',
       cat:'報道確認', freq:'平日', times:['09:15','15:30'], startDate:null, endDate:null, paused:false,
       changes:[{cond:'1Q決算 2026/8/7 になったら', freq:'毎日', times:'08:30,12:30,18:00'}],
       prompt:'フジクラ(5803)について、光ファイバ需給/AI・DC関連ニュース/信用残・出来高/同業(古河電工・住友電工)動向を重要度順に3〜6点で要約し、最後に注目度(高/中/低)を付けてください。',
       src:'GPT', srcDate:'2026/7/13', log:[{d:'2026/7/11',type:'変化なし'}], nextFire:null}
    ]
  };
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
  // 回数(count)→終了日(endDate)へ移行。回数は概念ごと廃止
  (db.reminders||[]).forEach(r=>{
    if(r.endDate===undefined) r.endDate=null;
    if('count' in r) delete r.count;
    (r.changes||[]).forEach(c=>{ if('count' in c) delete c.count; });
  });
  if(!db.metricsMaster) db.metricsMaster=s0.metricsMaster;
  if(!db.metricsMaster.hiddenSnap) db.metricsMaster.hiddenSnap=[];
  if(!db.metricsMaster.hiddenTrend) db.metricsMaster.hiddenTrend=[];
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
  // 旧「自分の見解(mine)」をメモ型の仮説カードに移行
  (db.stocks||[]).forEach(st=>{
    if(st.mine&&st.mine.length){
      db.hypotheses=db.hypotheses||[];
      st.mine.forEach(m=>{ db.hypotheses.push({id:'h'+Math.random().toString(36).slice(2,9), stockId:st.id, kind:'memo', ver:1, text:m.t, points:[], eventDate:null, eventNote:null, state:'メモ', judgeLog:[], verLog:[], createdAt:m.ts}); });
      delete st.mine;
    }
  });
  // 既存仮説に kind を補完(検証ポイントやイベントがあれば仮説、なければ従来通り仮説扱い)
  (db.hypotheses||[]).forEach(h=>{ if(!h.kind) h.kind='hypo'; if(h.kind==='memo'&&!h.state) h.state='メモ'; });
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
