import { describe, test, expect } from 'vitest';
import { migrate } from '../lib/migrate.js';

// 非表示は一覧から取り除かず名前で印を付けるだけなので、
// 「画面に出る指標」は snap から hiddenSnap を差し引いたもの
const visible = m => (m.snap || []).filter(k => !(m.hiddenSnap || []).includes(k));

describe('migrate', () => {
  // 回帰テスト10a: 旧構造 count → endDate への移行(countキーは廃止され削除される)
  test('リマインダーの旧 count フィールドを削除する', () => {
    const db = {
      stocks: [{ id: '5803', name: 'フジクラ', kind: '保有', metrics: {}, trend: {}, sections: {} }],
      hypotheses: [],
      reminders: [
        { id: 'r1', stockId: '5803', title: '旧リマインダー', freq: '毎日', times: ['09:00'], count: 5, changes: [{ cond: 'x', freq: '毎日', count: 3 }] },
      ],
    };
    const out = migrate(db);
    const r = out.reminders[0];
    expect('count' in r).toBe(false);
    expect(r.endDate).toBeNull();
    expect('count' in r.changes[0]).toBe(false);
  });

  // リマインダーの紐付けを単一hypoIdから配列hypoIdsへ移行
  test('リマインダーの hypoId を hypoIds 配列へ移行する', () => {
    const db = {
      stocks: [], hypotheses: [],
      reminders: [{ id: 'r1', stockId: '5803', title: 't', freq: '毎日', times: [], changes: [], hypoId: 'h9' }],
    };
    const out = migrate(db);
    expect(out.reminders[0].hypoIds).toEqual(['h9']);
    expect('hypoId' in out.reminders[0]).toBe(false);
  });

  test('hypoId が無い(未紐付けの)リマインダーは空配列にする', () => {
    const db = {
      stocks: [], hypotheses: [],
      reminders: [{ id: 'r1', stockId: '5803', title: 't', freq: '毎日', times: [], changes: [] }],
    };
    const out = migrate(db);
    expect(out.reminders[0].hypoIds).toEqual([]);
  });

  test('すでに hypoIds を持つリマインダーは維持する(複数紐付けを壊さない)', () => {
    const db = {
      stocks: [], hypotheses: [],
      reminders: [{ id: 'r1', stockId: '5803', title: 't', freq: '毎日', times: [], changes: [], hypoIds: ['h1', 'h2', 'h3'] }],
    };
    const out = migrate(db);
    expect(out.reminders[0].hypoIds).toEqual(['h1', 'h2', 'h3']);
  });

  test('すでに endDate を持つリマインダーはそのまま維持する', () => {
    const db = {
      stocks: [],
      hypotheses: [],
      reminders: [{ id: 'r1', stockId: 'x', title: 't', freq: '毎日', times: [], endDate: '2026/9/1', changes: [] }],
    };
    const out = migrate(db);
    expect(out.reminders[0].endDate).toBe('2026/9/1');
  });

  // 回帰テスト10b: 旧「自分の見解(mine)」をメモ型カードへ移行
  test('株の mine 配列をメモ型カードに変換し、mine を削除する', () => {
    const db = {
      stocks: [
        {
          id: '5803', name: 'フジクラ', kind: '保有', metrics: {}, trend: {}, sections: {},
          mine: [{ ts: '2025/1/1', t: 'DC向け需給が本丸' }],
        },
      ],
      hypotheses: [],
      reminders: [],
    };
    const out = migrate(db);
    const st = out.stocks.find(s => s.id === '5803');
    expect(st.mine).toBeUndefined();
    const memo = out.hypotheses.find(h => h.stockId === '5803' && h.kind === 'memo');
    expect(memo).toBeTruthy();
    expect(memo.text).toBe('DC向け需給が本丸');
    expect(memo.createdAt).toBe('2025/1/1');
  });

  // 回帰テスト: 廃止された kind:'hypo'(検証ポイント・判定・版管理)を kind:'watch'(注目ポイント)へ変換
  test("kind:'hypo' を watch に変換し、points・judgeLog・ver・verLog・state を破棄する", () => {
    const db = {
      stocks: [],
      hypotheses: [
        {
          id: 'h1', stockId: '5803', kind: 'hypo', ver: 2,
          text: 'データセンター向け光ケーブル需要で高値更新が続く',
          points: ['DC事業者のCAPEX拡大継続', '情報通信セグメントの利益率改善'],
          eventType: 'date', eventDate: '2026/8/7', eventNote: '1Q決算',
          state: '検証待ち', judgeLog: [{ d: '2026/1/1', result: '的中', text: 'x' }],
          verLog: [{ ver: 1, d: '2025/1/1', text: '旧文言' }],
        },
      ],
      reminders: [],
    };
    const out = migrate(db);
    const h = out.hypotheses.find(x => x.id === 'h1');
    expect(h.kind).toBe('watch');
    expect(h.text).toBe('データセンター向け光ケーブル需要で高値更新が続く');
    // イベント日はカード自身の属性ではなく、リマインダー登録の候補日になる
    expect(h.remindHint).toEqual({ date: '2026/8/7', note: '1Q決算' });
    expect('eventDate' in h).toBe(false);
    expect('eventNote' in h).toBe(false);
    expect('eventType' in h).toBe(false);
    expect('points' in h).toBe(false);
    expect('judgeLog' in h).toBe(false);
    expect('ver' in h).toBe(false);
    expect('verLog' in h).toBe(false);
    expect('state' in h).toBe(false);
  });

  test("kind未設定の最旧データも watch に変換する", () => {
    const db = {
      stocks: [],
      hypotheses: [{ id: 'h2', stockId: '5803', text: '旧仮説', eventDate: null }],
      reminders: [],
    };
    const out = migrate(db);
    const h = out.hypotheses.find(x => x.id === 'h2');
    expect(h.kind).toBe('watch');
    expect(h.remindHint).toBeUndefined();
  });

  // 「注目イベント」を廃止し、日付の管理をリマインダーに一本化したことの回帰テスト
  test('日付つきの注目ポイントは remindHint(リマインダー候補)に移す', () => {
    const db = {
      stocks: [],
      hypotheses: [
        { id: 'h3', stockId: '5803', kind: 'memo', text: '既存メモ' },
        { id: 'h4', stockId: '5803', kind: 'watch', text: '既存の注目ポイント', eventDate: '2026/9/1', eventNote: '決算', eventType: 'date' },
      ],
      reminders: [],
    };
    const out = migrate(db);
    expect(out.hypotheses.find(h => h.id === 'h3')).toEqual({ id: 'h3', stockId: '5803', kind: 'memo', text: '既存メモ' });
    const h4 = out.hypotheses.find(h => h.id === 'h4');
    expect(h4.remindHint).toEqual({ date: '2026/9/1', note: '決算' });
    expect('eventDate' in h4).toBe(false);
  });

  // 既にリマインダーがあるものは登録済みなので、重ねて登録を促さない
  test('リマインダーが紐づいている注目ポイントには候補日を作らない', () => {
    const db = {
      stocks: [],
      hypotheses: [{ id: 'h5', stockId: '5803', kind: 'watch', text: 'x', eventDate: '2026/9/1', eventNote: '決算' }],
      reminders: [{ id: 'r1', stockId: '5803', title: 't', freq: '毎日', times: [], changes: [], hypoIds: ['h5'] }],
    };
    const out = migrate(db);
    const h5 = out.hypotheses.find(h => h.id === 'h5');
    expect(h5.remindHint).toBeUndefined();
    expect('eventDate' in h5).toBe(false);
  });

  test('日付を持たない注目ポイントには候補日を作らない', () => {
    const db = {
      stocks: [],
      hypotheses: [{ id: 'h6', stockId: '5803', kind: 'watch', text: 'x', eventDate: null }],
      reminders: [],
    };
    const out = migrate(db);
    expect(out.hypotheses.find(h => h.id === 'h6').remindHint).toBeUndefined();
  });

  test('すでに remindHint を持つデータは上書きしない(再実行しても壊れない)', () => {
    const db = {
      stocks: [],
      hypotheses: [{ id: 'h7', stockId: '5803', kind: 'watch', text: 'x', remindHint: { date: '2026/10/1', note: null } }],
      reminders: [],
    };
    const out = migrate(db);
    expect(out.hypotheses.find(h => h.id === 'h7').remindHint).toEqual({ date: '2026/10/1', note: null });
  });

  // 回帰テスト10c: 旧セクション名 → 新体系サブ項目名への読み替え
  test('旧セクション名(成長ドライバー等)を新体系名に読み替える', () => {
    const db = {
      stocks: [
        {
          id: '5803', name: 'フジクラ', kind: '保有', metrics: {}, trend: {},
          sections: {
            '成長ドライバー': { t: 'AI・DC需要拡大', d: '2025/1/1', src: 'x', details: [] },
            'リスク要因': { t: '原材料市況の変動', d: '2025/1/1', src: 'x', details: [] },
            '競合ポジション': { t: '古河電工と競合', d: '2025/1/1', src: 'x', details: [] },
          },
        },
      ],
      hypotheses: [],
      reminders: [],
    };
    const out = migrate(db);
    const st = out.stocks[0];
    expect(st.sections['成長ドライバー']).toBeUndefined();
    expect(st.sections['市場成長率'].t).toBe('AI・DC需要拡大');
    expect(st.sections['事業リスク'].t).toBe('原材料市況の変動');
    expect(st.sections['主要競合'].t).toBe('古河電工と競合');
  });

  test('新体系名のセクションはすでに存在すれば旧名で上書きしない', () => {
    const db = {
      stocks: [
        {
          id: '5803', name: 'フジクラ', kind: '保有', metrics: {}, trend: {},
          sections: {
            '市場成長率': { t: '新しい内容', d: '2026/1/1', src: 'y', details: [] },
            '成長ドライバー': { t: '古い内容', d: '2025/1/1', src: 'x', details: [] },
          },
        },
      ],
      hypotheses: [],
      reminders: [],
    };
    const out = migrate(db);
    expect(out.stocks[0].sections['市場成長率'].t).toBe('新しい内容');
  });

  test('旧「未取得」プレースホルダ(null)のセクションは削除する', () => {
    const db = {
      stocks: [{ id: '5803', name: 'フジクラ', kind: '保有', metrics: {}, trend: {}, sections: { '事業構造': null } }],
      hypotheses: [],
      reminders: [],
    };
    const out = migrate(db);
    expect('事業構造' in out.stocks[0].sections).toBe(false);
  });

  test('マスターや askPrefs が欠けている旧データにもデフォルトを補完する', () => {
    const db = { stocks: [], hypotheses: [], reminders: [] };
    const out = migrate(db);
    expect(Array.isArray(out.sectionMaster)).toBe(true);
    expect(Array.isArray(out.marketSectionMaster)).toBe(true);
    expect(out.askPrefs).toBeTruthy();
    expect(out.askPrefs.themes).toEqual({});
    expect(out.metricsMaster.hiddenSnap).toEqual([]);
  });

  // 一覧の区分をどこまで畳んでいるかは端末に残す
  test('uiPrefs が無い旧データに空の anaClosed を補完する', () => {
    const out = migrate({ stocks: [], hypotheses: [], reminders: [] });
    expect(out.uiPrefs.anaClosed).toEqual([]);
  });

  test('畳んでいる区分は保持する', () => {
    const out = migrate({ stocks: [], hypotheses: [], reminders: [], uiPrefs: { anaClosed: ['保有'] } });
    expect(out.uiPrefs.anaClosed).toEqual(['保有']);
  });

  test('anaClosed が壊れていても配列に直す', () => {
    const out = migrate({ stocks: [], hypotheses: [], reminders: [], uiPrefs: { anaClosed: '保有' } });
    expect(out.uiPrefs.anaClosed).toEqual([]);
  });

  // 市場・テーマは銘柄とは別の指標マスターを持つ(PERと騰落レシオを混ぜない)
  test('市場用の指標マスターが無い旧データに既定値を補完する', () => {
    const db = { stocks: [], hypotheses: [], reminders: [] };
    const out = migrate(db);
    expect(Array.isArray(out.marketMetricsMaster.snap)).toBe(true);
    expect(out.marketMetricsMaster.snap.length).toBeGreaterThan(0);
    expect(out.marketMetricsMaster.hiddenSnap).toEqual([]);
    // 銘柄用のマスターとは独立していること
    expect(out.marketMetricsMaster.snap).not.toEqual(out.metricsMaster.snap);
  });

  // 市場カードは粒度(市場/業界/テーマ)ごとに語彙が違うので、マスターを分けて持つ
  test('業界・テーマ用のマスターを補完し、それぞれ内容が異なる', () => {
    const out = migrate({ stocks: [], hypotheses: [], reminders: [] });
    expect(out.industryMetricsMaster.snap.length).toBeGreaterThan(0);
    expect(Array.isArray(out.themeMetricsMaster.snap)).toBe(true);
    expect(out.industrySectionMaster.length).toBeGreaterThan(0);
    expect(out.themeSectionMaster.length).toBeGreaterThan(0);
    expect(out.marketMetricsMaster.snap).toEqual(['予想PER(市場全体)', '長期金利(10年)', '為替(USD/JPY)']);
    // 業界はAIが公表値を取れるバリュエーションだけ。自力算出が要るROE等は持たせない
    expect(out.industryMetricsMaster.snap).toEqual(['PER', 'PBR']);
    expect(out.industryMetricsMaster.snap).not.toContain('ROE');
    // 日次で動くもの(株価指数・VIX・騰落レシオ)は既定に含めない(証券アプリの役割)
    expect(out.marketMetricsMaster.snap.some(x => /日経平均|TOPIX|移動平均|VIX|騰落レシオ/.test(x))).toBe(false);
    // 2026-08-13: ROE・営業利益率は指標(単年)と業績推移(複数年)の両方で同じ意味の別名が
    // 登録されうる(ROE⇔自己資本利益率、営業利益率⇔売上高営業利益率)ため既定の指標一覧からは外し、
    // ROEは業績推移側の既定に置く(ユーザー指摘・確認の上)
    expect(out.metricsMaster.snap).toEqual(['PER(予想)', 'PBR', '自己資本比率', '配当利回り(予想)']);
    expect(out.metricsMaster.snap).not.toContain('ROE');
    expect(out.metricsMaster.snap).not.toContain('営業利益率');
    expect(out.metricsMaster.trend.map(t => t.name)).toContain('ROE');
    // 市場専用のカテゴリ(金融環境)は業界には無い
    const cats = m => m.map(c => c.cat);
    expect(cats(out.marketSectionMaster)).toContain('金融環境');
    expect(cats(out.industrySectionMaster)).not.toContain('金融環境');
  });

  // 業界の既定指標を差し替えたが、ユーザーが編集済みの設定は尊重する
  test('業界の既定指標が旧既定のままなら新しい既定に差し替える', () => {
    const db = {
      stocks: [], hypotheses: [], reminders: [],
      industryMetricsMaster: { snap: ['市場規模', '市場成長率(YoY)', '設備投資額'], hiddenSnap: [] },
    };
    const out = migrate(db);
    // 既定から外れた項目も一覧には残し、非表示の印を付けるだけにする
    expect(visible(out.industryMetricsMaster)).toEqual(['PER', 'PBR']);
    expect(out.industryMetricsMaster.snap).toEqual(['PER', 'PBR', '市場規模', '市場成長率(YoY)', '設備投資額']);
    expect(out.industryMetricsMaster.hiddenSnap).toEqual(['市場規模', '市場成長率(YoY)', '設備投資額']);
  });

  test('業界の指標をユーザーが編集していれば差し替えない', () => {
    const db = {
      stocks: [], hypotheses: [], reminders: [],
      industryMetricsMaster: { snap: ['市場規模', '独自に足した指標'], hiddenSnap: [] },
    };
    expect(migrate(db).industryMetricsMaster.snap).toEqual(['市場規模', '独自に足した指標']);
  });

  test('市場の既定指標が旧既定のままなら新しい既定に差し替える', () => {
    const db = {
      stocks: [], hypotheses: [], reminders: [],
      marketMetricsMaster: { snap: ['予想PER(市場全体)', 'PBR(市場全体)', '配当利回り(市場全体)', '騰落レシオ(25日)', '信用評価損益率', '長期金利(10年)'], hiddenSnap: [] },
    };
    const out = migrate(db);
    expect(visible(out.marketMetricsMaster)).toEqual(['予想PER(市場全体)', '長期金利(10年)', '為替(USD/JPY)']);
    // 既定から外れた項目は消さず、一覧に残したまま非表示の印を付ける
    expect(out.marketMetricsMaster.snap).toContain('配当利回り(市場全体)');
    expect(out.marketMetricsMaster.hiddenSnap).toContain('配当利回り(市場全体)');
    expect(out.marketMetricsMaster.hiddenSnap).toContain('信用評価損益率');
  });

  test('1世代前の既定(VIX入り)からも新しい既定に差し替える', () => {
    const db = {
      stocks: [], hypotheses: [], reminders: [],
      marketMetricsMaster: { snap: ['予想PER(市場全体)', 'PBR(市場全体)', '長期金利(10年)', '為替(USD/JPY)', '騰落レシオ(25日)', 'VIX指数'], hiddenSnap: [] },
    };
    const out = migrate(db);
    expect(visible(out.marketMetricsMaster)).toEqual(['予想PER(市場全体)', '長期金利(10年)', '為替(USD/JPY)']);
    expect(out.marketMetricsMaster.snap).toContain('VIX指数');
    expect(out.marketMetricsMaster.hiddenSnap).toContain('VIX指数');
  });

  test('銘柄の既定が旧既定のままなら差し替え、外れた項目は非表示へ送る', () => {
    const db = {
      stocks: [], hypotheses: [], reminders: [],
      metricsMaster: { snap: ['PER(予想)', 'PBR', '時価総額', '配当利回り(予想)', '信用倍率', '目標株価コンセンサス'], trend: [], hiddenSnap: [], hiddenTrend: [] },
    };
    const out = migrate(db);
    expect(visible(out.metricsMaster)).toEqual(['PER(予想)', 'PBR', '自己資本比率', '配当利回り(予想)']);
    expect(out.metricsMaster.snap).toEqual(expect.arrayContaining(['時価総額', '信用倍率', '目標株価コンセンサス']));
    expect(out.metricsMaster.hiddenSnap).toEqual(expect.arrayContaining(['時価総額', '信用倍率', '目標株価コンセンサス']));
  });

  test('市場の指標をユーザーが編集していれば差し替えない', () => {
    const db = {
      stocks: [], hypotheses: [], reminders: [],
      marketMetricsMaster: { snap: ['長期金利(10年)', '独自に足した指標'], hiddenSnap: [] },
    };
    expect(migrate(db).marketMetricsMaster.snap).toEqual(['長期金利(10年)', '独自に足した指標']);
  });

  test('粒度が未設定の既存の市場カードは「市場」扱いにする', () => {
    const db = {
      stocks: [
        { id: 'mkt1', name: '日本株市場', kind: '市場', metrics: {}, trend: {}, sections: {} },
        { id: '5803', name: 'フジクラ', kind: '保有', metrics: {}, trend: {}, sections: {} },
      ],
      hypotheses: [], reminders: [],
    };
    const out = migrate(db);
    expect(out.stocks.find(s => s.id === 'mkt1').scope).toBe('市場');
    // 銘柄には粒度を付けない
    expect(out.stocks.find(s => s.id === '5803').scope).toBeUndefined();
  });

  test('すでに粒度が設定されているカードは上書きしない', () => {
    const db = {
      stocks: [{ id: 'mkt2', name: '半導体', kind: '市場', scope: '業界', metrics: {}, trend: {}, sections: {} }],
      hypotheses: [], reminders: [],
    };
    expect(migrate(db).stocks[0].scope).toBe('業界');
  });

  test('すでに市場用の指標マスターがあれば上書きしない', () => {
    const db = {
      stocks: [], hypotheses: [], reminders: [],
      marketMetricsMaster: { snap: ['VIX指数'], hiddenSnap: ['ドル円'] },
    };
    const out = migrate(db);
    // 非表示だった項目は一覧に戻したうえで、印だけ残す
    expect(out.marketMetricsMaster.snap).toEqual(['VIX指数', 'ドル円']);
    expect(out.marketMetricsMaster.hiddenSnap).toEqual(['ドル円']);
    expect(visible(out.marketMetricsMaster)).toEqual(['VIX指数']);
  });

  // 非表示は以前「一覧から取り除いて別リストへ移す」実装だった。元がスナップショットだったのか
  // 業績推移だったのかも並び順も失われるので、一覧に残したまま名前で印を付ける方式へ移行する
  describe('非表示の指標を一覧へ戻す', () => {
    const base = () => ({
      stocks: [], hypotheses: [], reminders: [],
      metricsMaster: {
        snap: ['PER(予想)', '独自指標'],
        trend: [{ name: '売上高', graph: true }],
        hiddenSnap: ['信用倍率'],
        hiddenTrend: [{ name: '営業利益', graph: true }],   // 旧形式(オブジェクト丸ごと退避)
      },
    });

    test('別リストへ退避されていた指標を一覧に戻す', () => {
      const out = migrate(base());
      expect(out.metricsMaster.snap).toContain('信用倍率');
      expect(out.metricsMaster.trend.map(t => t.name)).toContain('営業利益');
    });

    test('戻したうえで非表示中のままにする', () => {
      const out = migrate(base());
      expect(out.metricsMaster.hiddenSnap).toContain('信用倍率');
      expect(out.metricsMaster.hiddenTrend).toContain('営業利益');
      expect(visible(out.metricsMaster)).toEqual(['PER(予想)', '独自指標']);
    });

    test('hiddenTrend は名前だけの配列に揃える', () => {
      const out = migrate(base());
      expect(out.metricsMaster.hiddenTrend).toEqual(['営業利益']);
    });

    test('退避されていた業績推移指標のグラフ指定も失わない', () => {
      const out = migrate(base());
      expect(out.metricsMaster.trend.find(t => t.name === '営業利益').graph).toBe(true);
    });

    test('既定に無い指標(自分で足したもの)は末尾に戻す', () => {
      // 信用倍率は今の既定には入っていないので、並べ直しようがなく末尾に足す
      const out = migrate(base());
      expect(out.metricsMaster.snap).toEqual(['PER(予想)', '独自指標', '信用倍率']);
    });

    // 末尾に足すと、6件ごとの指標グリッドで2ページ目に押し出され、
    // 1ページ目が「データなし」だけになって数字が見つけられなくなる
    test('既定にある指標は、既定の並びでの位置に差し込む(末尾に飛ばさない)', () => {
      const db = {
        stocks: [], hypotheses: [], reminders: [],
        metricsMaster: {
          snap: ['PBR', '自己資本比率', '配当利回り(予想)'],
          trend: [{ name: '売上高', graph: true }],
          hiddenSnap: ['PER(予想)'],   // 既定では先頭の指標
          hiddenTrend: [],
        },
      };
      const out = migrate(db);
      expect(out.metricsMaster.snap[0]).toBe('PER(予想)');
      expect(out.metricsMaster.snap).toEqual(['PER(予想)', 'PBR', '自己資本比率', '配当利回り(予想)']);
    });

    test('差し込み位置は前後の既定項目の間になる', () => {
      const db = {
        stocks: [], hypotheses: [], reminders: [],
        metricsMaster: {
          snap: ['PER(予想)', 'PBR', '独自指標'],
          trend: [], hiddenSnap: ['自己資本比率'], hiddenTrend: [],   // 既定では PBR と 配当利回り(予想) の間
        },
      };
      const out = migrate(db);
      expect(out.metricsMaster.snap).toEqual(['PER(予想)', 'PBR', '自己資本比率', '独自指標']);
    });

    test('業績推移の指標も既定の位置に戻す', () => {
      const db = {
        stocks: [], hypotheses: [], reminders: [],
        metricsMaster: {
          snap: [], trend: [{ name: '売上高', graph: true }, { name: 'EPS', graph: true }],
          hiddenSnap: [], hiddenTrend: [{ name: '営業利益', graph: true }],   // 既定では 売上高 と EPS の間
        },
      };
      const out = migrate(db);
      // 2026-08-13: ROEが業績推移の既定に加わったため、既定に無かった旧データにも補われる
      expect(out.metricsMaster.trend.map(t => t.name)).toEqual(['売上高', '営業利益', 'EPS', 'ROE']);
    });

    test('2回流しても重複しない(冪等)', () => {
      const out = migrate(migrate(base()));
      expect(out.metricsMaster.snap.filter(k => k === '信用倍率')).toHaveLength(1);
      expect(out.metricsMaster.trend.filter(t => t.name === '営業利益')).toHaveLength(1);
      expect(out.metricsMaster.hiddenTrend).toEqual(['営業利益']);
    });

    test('市場・業界・テーマの指標マスターにも同じ移行をかける', () => {
      const db = {
        stocks: [], hypotheses: [], reminders: [],
        marketMetricsMaster: { snap: ['VIX指数'], hiddenSnap: ['ドル円'] },
        industryMetricsMaster: { snap: ['独自の業界指標'], hiddenSnap: ['EBITDA'] },
        themeMetricsMaster: { snap: [], hiddenSnap: ['導入社数'] },
      };
      const out = migrate(db);
      expect(out.marketMetricsMaster.snap).toContain('ドル円');
      expect(out.industryMetricsMaster.snap).toContain('EBITDA');
      expect(out.themeMetricsMaster.snap).toEqual(['導入社数']);
      expect(visible(out.themeMetricsMaster)).toEqual([]);
    });

    test('非表示が無いデータには影響しない', () => {
      const out = migrate({ stocks: [], hypotheses: [], reminders: [] });
      expect(out.metricsMaster.hiddenSnap).toEqual([]);
      expect(out.metricsMaster.hiddenTrend).toEqual([]);
      expect(visible(out.metricsMaster)).toEqual(out.metricsMaster.snap);
    });
  });

  // EPS↔1株当たり当期純利益、ROE↔自己資本利益率、売上↔売上高が、それぞれ別々の指標として
  // 登録されていた事例(実データ)があった。外部AIへの説明書(briefingText)がその重複した
  // 一覧をそのまま埋め込むため、表記ゆれが自己増殖する状態になっていた(ユーザー報告、2026-08-13)。
  // 既存データを1本化するマイグレーションを検証する
  describe('指標マスターの表記ゆれ統合', () => {
    test('業績推移どうしの別名(売上→売上高)は、正名に無い年度だけ補って統合する', () => {
      const db = {
        stocks: [{ id: '1', name: 'A', code: '1', kind: 'ウォッチ', metrics: {}, sections: {},
          trend: {
            '売上高': { unit: '百万円', '25年3月期': '100' },
            '売上': { unit: '百万円', '25年3月期': '999', '26年3月期': '120' },  // 25年3月期は正名を優先
          } }],
        hypotheses: [], reminders: [],
      };
      const out = migrate(db);
      const st = out.stocks[0];
      expect(st.trend['売上']).toBeUndefined();
      expect(st.trend['売上高']).toEqual({ unit: '百万円', '25年3月期': '100', '26年3月期': '120' });
      expect(out.metricsMaster.trend.map(t => t.name)).not.toContain('売上');
    });
    test('EPS ← 1株当たり当期純利益(業績推移どうし)も統合する', () => {
      const db = {
        stocks: [{ id: '1', name: 'A', code: '1', kind: 'ウォッチ', metrics: {}, sections: {},
          trend: { '1株当たり当期純利益': { unit: '円', '26年3月期': '114.5' } } }],
        hypotheses: [], reminders: [],
      };
      const out = migrate(db);
      expect(out.stocks[0].trend['1株当たり当期純利益']).toBeUndefined();
      expect(out.stocks[0].trend['EPS']).toEqual({ unit: '円', '26年3月期': '114.5' });
    });
    // ROE・営業利益率(指標)は削除せず「非表示」にするだけにする。削除すると、業績推移側に
    // データが無い銘柄(例: 自己資本利益率の業績推移を持たない銘柄のROE単年値)まで失われるため
    test('ROE(指標)↔自己資本利益率(業績推移)は、業績推移側をROEへ一本化。指標側は非表示にするが削除しない', () => {
      const db = {
        stocks: [{ id: '1', name: 'A', code: '1', kind: 'ウォッチ',
          metrics: { 'ROE': { v: '3.6', unit: '%', d: '2026/8/13' } },
          sections: {},
          trend: { '自己資本利益率': { unit: '%', '25年3月期': '2.3', '26年3月期': '3.6' } } }],
        hypotheses: [], reminders: [],
        metricsMaster: { snap: ['PER(予想)', 'PBR', 'ROE', '営業利益率', '自己資本比率', '配当利回り(予想)'],
          trend: [{ name: '売上高', graph: true }], hiddenSnap: [], hiddenTrend: [] },
      };
      const out = migrate(db);
      const st = out.stocks[0];
      expect(st.metrics['ROE']).toEqual({ v: '3.6', unit: '%', d: '2026/8/13' });  // 削除しない
      expect(st.trend['自己資本利益率']).toBeUndefined();
      expect(st.trend['ROE']).toEqual({ unit: '%', '25年3月期': '2.3', '26年3月期': '3.6' });
      expect(out.metricsMaster.snap).toContain('ROE');       // 一覧からは削除しない
      expect(out.metricsMaster.hiddenSnap).toContain('ROE'); // 非表示にする
      expect(out.metricsMaster.trend.map(t => t.name)).toContain('ROE');
      expect(out.metricsMaster.trend.map(t => t.name)).not.toContain('自己資本利益率');
    });
    test('営業利益率(指標)は非表示にするが削除しない(売上高営業利益率という業績推移側の統合先を強制的には作らない)', () => {
      const db = {
        stocks: [{ id: '1', name: 'A', code: '1', kind: 'ウォッチ',
          metrics: { '営業利益率': { v: '4.3', unit: '%', d: '2026/8/13' } }, sections: {}, trend: {} }],
        hypotheses: [], reminders: [],
        metricsMaster: { snap: ['PER(予想)', 'PBR', 'ROE', '営業利益率', '自己資本比率', '配当利回り(予想)'],
          trend: [], hiddenSnap: [], hiddenTrend: [] },
      };
      const out = migrate(db);
      expect(out.stocks[0].metrics['営業利益率']).toEqual({ v: '4.3', unit: '%', d: '2026/8/13' });
      expect(out.metricsMaster.snap).toContain('営業利益率');
      expect(out.metricsMaster.hiddenSnap).toContain('営業利益率');
      expect(out.metricsMaster.trend.map(t => t.name)).not.toContain('売上高営業利益率');
    });
    test('既に売上高営業利益率(業績推移)がある場合は、統合後もそのまま残る(指標側も削除しない)', () => {
      const db = {
        stocks: [{ id: '1', name: 'A', code: '1', kind: 'ウォッチ',
          metrics: { '営業利益率': { v: '4.3', unit: '%', d: '2026/8/13' } }, sections: {},
          trend: { '売上高営業利益率': { unit: '%', '26年3月期': '4.3' } } }],
        hypotheses: [], reminders: [],
        metricsMaster: { snap: ['PER(予想)', 'PBR', 'ROE', '営業利益率', '自己資本比率', '配当利回り(予想)'],
          trend: [], hiddenSnap: [], hiddenTrend: [] },
      };
      const out = migrate(db);
      const st = out.stocks[0];
      expect(st.metrics['営業利益率']).toEqual({ v: '4.3', unit: '%', d: '2026/8/13' });
      expect(st.trend['売上高営業利益率']).toEqual({ unit: '%', '26年3月期': '4.3' });
    });
    test('指標一覧に既に無い(既定のまま等)場合はhiddenSnapへ追加しない', () => {
      // 新規インストール相当。ROE・営業利益率は最初からsnapに無いので、隠す対象にもならない
      const out = migrate({ stocks: [], hypotheses: [], reminders: [] });
      expect(out.metricsMaster.hiddenSnap).not.toContain('ROE');
      expect(out.metricsMaster.hiddenSnap).not.toContain('営業利益率');
    });
    test('該当データが無い銘柄・指標には影響しない', () => {
      const db = {
        stocks: [{ id: '1', name: 'A', code: '1', kind: 'ウォッチ', metrics: { 'PBR': { v: '2.5', unit: '倍', d: '2026/8/13' } },
          sections: {}, trend: { '売上高': { unit: '百万円', '26年3月期': '100' } } }],
        hypotheses: [], reminders: [],
      };
      const out = migrate(db);
      const st = out.stocks[0];
      expect(st.metrics['PBR']).toEqual({ v: '2.5', unit: '倍', d: '2026/8/13' });
      expect(st.trend['売上高']).toEqual({ unit: '百万円', '26年3月期': '100' });
    });
    test('新規インストール(既定のまま)でもROEは業績推移側だけに存在する', () => {
      const out = migrate({ stocks: [], hypotheses: [], reminders: [] });
      expect(out.metricsMaster.snap).not.toContain('ROE');
      expect(out.metricsMaster.trend.map(t => t.name)).toContain('ROE');
    });
  });

  test('null を渡すと null を返す(初回起動でバックアップが無いケース)', () => {
    expect(migrate(null)).toBeNull();
  });
});
