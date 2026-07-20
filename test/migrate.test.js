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

  test('すでに endDate を持つリマインダーはそのまま維持する', () => {
    const db = {
      stocks: [],
      hypotheses: [],
      reminders: [{ id: 'r1', stockId: 'x', title: 't', freq: '毎日', times: [], endDate: '2026/9/1', changes: [] }],
    };
    const out = migrate(db);
    expect(out.reminders[0].endDate).toBe('2026/9/1');
  });

  // 回帰テスト10b: 旧「自分の見解(mine)」をメモ型仮説カードへ移行
  test('株の mine 配列をメモ型仮説カードに変換し、mine を削除する', () => {
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
    expect(memo.state).toBe('メモ');
    expect(memo.createdAt).toBe('2025/1/1');
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

  test('null を渡すと null を返す(初回起動でバックアップが無いケース)', () => {
    expect(migrate(null)).toBeNull();
  });
});
