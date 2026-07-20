import { describe, test, expect } from 'vitest';
import { normalizeValueUnit, shortSrc } from '../lib/format.js';

describe('normalizeValueUnit', () => {
  // 回帰テスト1: 分析セクションの本文(長い文章)を数値化してしまうバグの再発防止。
  // 「売上高は1兆円超規模」のような文章が10000等の数値に変換されるバグが過去にあった。
  test('分析本文の長い文章は数値化せずそのまま返す', () => {
    const sentence = '売上高は1兆円を超える規模に拡大しており、データセンター需要が牽引している。';
    const result = normalizeValueUnit(sentence, '');
    expect(result.v).toBe(sentence);
    expect(result.unit).toBe('');
  });

  test('句読点を含まない短文でも、数値のみのパターンに一致しなければ数値化しない', () => {
    // 先頭が数字でない文章的な値は isNumericValue の時点で弾かれる
    const text = '想定為替レート105円/ドル前提';
    const result = normalizeValueUnit(text, '');
    expect(result.v).toBe(text);
  });

  // 回帰テスト2: 兆・億の位取り単位の正規化
  test('「1兆3425億円」を 13425(億円) に変換する', () => {
    const result = normalizeValueUnit('1兆3425億円', '');
    expect(result.v).toBe('13425');
    expect(result.unit).toBe('億円');
  });

  test('億円のみの値も正しく変換する', () => {
    const result = normalizeValueUnit('888億円', '');
    expect(result.v).toBe('888');
    expect(result.unit).toBe('億円');
  });

  test('指標・業績推移の短い数値項目はそのまま単位を分離する(位取り単位を含まない場合)', () => {
    const result = normalizeValueUnit('36.2', '');
    expect(result.v).toBe('36.2');
  });
});

describe('shortSrc', () => {
  // 回帰テスト7: 巨大なcitation付きMarkdownリンクをドメイン名程度に短縮する
  test('citation付きMarkdownリンクをドメイン名に短縮する', () => {
    const raw = '[株予報Pro](https://kabuyoho.jp/reports/some/very/long/path?query=1&ref=abcdefg12345)';
    const result = shortSrc(raw);
    expect(result).toBe('kabuyoho.jp');
  });

  test('www.付きドメインは www. を除去する', () => {
    const raw = '[日経](https://www.nikkei.com/article/very/long/path/that/would/otherwise/blow/up/the/length)';
    const result = shortSrc(raw);
    expect(result).toBe('nikkei.com');
  });

  test('40文字を超える場合は省略記号を付けて切り詰める', () => {
    const raw = 'これは非常に長い出典名でありちょうど40文字を超えるように意図的に作られた文字列です追加テキスト';
    const result = shortSrc(raw);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(41);
  });
});
