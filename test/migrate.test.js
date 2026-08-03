import { describe, test, expect } from 'vitest';
import { migrate } from '../lib/migrate.js';

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
    // 市場に効く指標(騰落レシオ)は業界には無い。業界は財務指標で見る
    expect(out.marketMetricsMaster.snap).toContain('騰落レシオ(25日)');
    expect(out.industryMetricsMaster.snap).not.toContain('騰落レシオ(25日)');
    expect(out.industryMetricsMaster.snap).toEqual(['PER', 'PBR', 'EBITDA', 'ROE', '営業利益率', '自己資本比率']);
    expect(out.marketMetricsMaster.snap).toEqual(['予想PER(市場全体)', 'PBR(市場全体)', '長期金利(10年)', '為替(USD/JPY)', '騰落レシオ(25日)', 'VIX指数']);
    // 日次で動く株価指数そのものは既定に含めない(証券アプリの役割)
    expect(out.marketMetricsMaster.snap.some(x => /日経平均|TOPIX|移動平均/.test(x))).toBe(false);
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
    expect(migrate(db).industryMetricsMaster.snap).toEqual(['PER', 'PBR', 'EBITDA', 'ROE', '営業利益率', '自己資本比率']);
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
    const snap = migrate(db).marketMetricsMaster.snap;
    expect(snap).toContain('為替(USD/JPY)');
    expect(snap).toContain('VIX指数');
    expect(snap).not.toContain('配当利回り(市場全体)');
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
    expect(out.marketMetricsMaster.snap).toEqual(['VIX指数']);
    expect(out.marketMetricsMaster.hiddenSnap).toEqual(['ドル円']);
  });

  test('null を渡すと null を返す(初回起動でバックアップが無いケース)', () => {
    expect(migrate(null)).toBeNull();
  });
});
