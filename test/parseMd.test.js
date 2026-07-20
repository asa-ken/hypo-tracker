import { describe, test, expect } from 'vitest';
import { parseMd } from '../lib/parseMd.js';

const metricsMaster = {
  snap: ['PER(予想)', 'PBR', '時価総額'],
  trend: [{ name: '売上高', graph: true }, { name: '営業利益', graph: true }],
};
const sectionMaster = [
  { cat: '競争環境', on: true, subs: ['主要競合', '競争優位性・差別化'] },
  { cat: '市場環境', on: true, subs: ['市場成長率'] },
];
const marketSectionMaster = [];
const baseCtx = { metricsMaster, sectionMaster, marketSectionMaster };

describe('parseMd', () => {
  // 回帰テスト3: 箇条書き記号が - だけでなく •, *, ・ でも解釈できること
  test('箇条書き記号 -, •, *, ・ をすべて解釈する', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 指標',
      '- PER(予想): 36.2 | 2026/7/13',
      '• PBR: 14.79 | 2026/7/13',
      '* 時価総額: 88883 | 2026/7/13 | 単位:百万円',
      '・信用倍率: 23.4 | 2026/7/13',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    const keys = p.rows.map(r => r.key);
    expect(keys).toEqual(expect.arrayContaining(['PER(予想)', 'PBR', '時価総額', '信用倍率']));
    expect(p.failed.length).toBe(0);
  });

  // 回帰テスト4: 同一キー・同一値の重複行(AIが同じ内容を2回出力するケース)を除外する
  test('同一キー・同一値の重複行を除外する', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 指標',
      '- PER(予想): 36.2 | 2026/7/13 | 銘柄スカウター',
      '- PER(予想): 36.2 | 2026/7/13 | 銘柄スカウター',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    expect(p.rows.length).toBe(1);
    expect(p.dups.length).toBe(1);
  });

  test('同一キーでも値が異なれば重複扱いしない', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 指標',
      '- PER(予想): 36.2 | 2026/7/13',
      '- PER(予想): 40.1 | 2026/7/20',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    expect(p.rows.length).toBe(2);
    expect(p.dups.length).toBe(0);
  });

  // 回帰テスト5: 確信度が「| 中」だけでなく「| 確信度:中」というラベル付きでも解釈できること
  test('確信度をラベル無し(| 中)でもラベル付き(| 確信度:中)でも解釈する', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 指標',
      '- PER(予想): 36.2 | 2026/7/13 | 銘柄スカウター | 中',
      '- PBR: 14.79 | 2026/7/13 | 銘柄スカウター | 確信度:高',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    const per = p.rows.find(r => r.key === 'PER(予想)');
    const pbr = p.rows.find(r => r.key === 'PBR');
    expect(per.conf).toBe('中');
    expect(pbr.conf).toBe('高');
  });

  // 回帰テスト6: 見出し(##)が無くても、キー名から指標・業績推移・分析への振り分けを推定できる(GPTの分割出力対策)
  test('見出しが無い行もキー名から block を推定する(指標)', () => {
    const text = '- PER(予想): 36.2 | 2026/7/13';
    const p = parseMd(text, baseCtx);
    expect(p.rows[0].block).toBe('指標');
  });

  test('見出しが無い行もキー名から block を推定する(業績推移)', () => {
    const text = '- 売上高: 25年3月期=979375 | 26年3月期=1182358 | 単位:百万円 | 2026/7/13';
    const p = parseMd(text, baseCtx);
    expect(p.rows[0].block).toBe('業績推移');
  });

  test('見出しが無い行もキー名から block を推定する(分析)', () => {
    const text = '- 主要競合(サマリ): 古河電工、住友電工と競合。 | 2026/7/13';
    const p = parseMd(text, baseCtx);
    expect(p.rows[0].block).toBe('分析');
  });
});
