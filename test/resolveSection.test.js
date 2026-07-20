import { describe, test, expect } from 'vitest';
import { resolveSection } from '../lib/sections.js';

const masters = {
  sectionMaster: [
    { cat: '競争環境', on: true, subs: ['主要競合', '競争優位性・差別化'] },
    { cat: 'ビジネスモデル', on: true, subs: ['事業構造'] },
  ],
  marketSectionMaster: [
    { cat: '需給', on: true, subs: ['投資主体別動向'] },
  ],
};

describe('resolveSection', () => {
  // 回帰テスト8: 「競争環境: 主要競合(サマリ)」のようにカテゴリ名が前置されたキーでも
  // サブ項目名で正しく解決できること(Gemini出力対策)
  test('カテゴリ名が前置されたキー(コロン区切り)を解決する', () => {
    const res = resolveSection('競争環境: 主要競合(サマリ)', '古河電工、住友電工と競合。', masters);
    expect(res.sub).toBe('主要競合');
    expect(res.layer).toBe('サマリ');
    expect(res.value).toBe('古河電工、住友電工と競合。');
  });

  test('カテゴリ名が前置された詳細レイヤーのキーも解決する', () => {
    const res = resolveSection('競争環境: 主要競合(詳細)', '価格競争力の比較…', masters);
    expect(res.sub).toBe('主要競合');
    expect(res.layer).toBe('詳細');
  });

  test('レイヤー表記のないシンプルなキーも解決する', () => {
    const res = resolveSection('事業構造', '光ファイバ・ケーブルの製造販売。', masters);
    expect(res.sub).toBe('事業構造');
    expect(res.layer).toBe('サマリ');
  });

  test('キーがカテゴリ名で値の先頭に「サブ項目(レイヤー): 本文」がある形式を解決する', () => {
    const res = resolveSection('競争環境', '主要競合(サマリ): 古河電工、住友電工と競合。', masters);
    expect(res.sub).toBe('主要競合');
    expect(res.layer).toBe('サマリ');
    expect(res.value).toBe('古河電工、住友電工と競合。');
  });

  test('市場・テーマ用マスターのサブ項目も解決する', () => {
    const res = resolveSection('需給: 投資主体別動向(サマリ)', '海外投資家が買い越し。', masters);
    expect(res.sub).toBe('投資主体別動向');
  });

  test('未知のキーは sub:null を返す', () => {
    const res = resolveSection('存在しない項目', '何かの値', masters);
    expect(res.sub).toBeNull();
  });
});
