import { describe, test, expect } from 'vitest';
import { filledCatCount, masterFor } from '../lib/sections.js';

const sectionMaster = [
  { cat: 'ビジネスモデル', on: true, subs: ['事業構造', '収益モデル', '提供価値'] },
];
const marketSectionMaster = [
  { cat: '現状認識', on: true, subs: ['何が起きているか', '市場コンセンサス'] },
  { cat: '注目イベント', on: true, subs: ['注目日程', '想定シナリオ'] },
];

describe('filledCatCount', () => {
  test('銘柄カード: 埋まっているサブ項目の数を数える', () => {
    const s = { kind: '保有', sections: { '事業構造': { t: 'x' }, '収益モデル': { t: 'y' } } };
    expect(filledCatCount(s, 'ビジネスモデル', sectionMaster)).toBe(2);
  });

  // 市場カードは marketSectionMaster を渡さないと常に0になり、
  // データがあるのに画面上「未取得」と表示されてしまう
  test('市場カード: 市場用マスターを渡せば正しく数えられる', () => {
    const s = { kind: '市場', sections: { '何が起きているか': { t: 'x' } } };
    const master = masterFor(s, { sectionMaster, marketSectionMaster });
    expect(filledCatCount(s, '現状認識', master)).toBe(1);
  });

  test('市場カードに銘柄用マスターを渡すと0になる(取り違えの検出)', () => {
    const s = { kind: '市場', sections: { '何が起きているか': { t: 'x' } } };
    expect(filledCatCount(s, '現状認識', sectionMaster)).toBe(0);
  });

  test('未取得のカテゴリは0', () => {
    const s = { kind: '市場', sections: { '何が起きているか': { t: 'x' } } };
    const master = masterFor(s, { sectionMaster, marketSectionMaster });
    expect(filledCatCount(s, '注目イベント', master)).toBe(0);
  });
});
