import { describe, test, expect } from 'vitest';
import { kindLabel, kindChipColor, canRemind } from '../lib/hypoKind.js';

describe('hypoKind', () => {
  test('kindLabel', () => {
    expect(kindLabel('memo')).toBe('メモ');
    expect(kindLabel('watch')).toBe('注目');
  });

  test('kindChipColor', () => {
    expect(kindChipColor('memo')).toBe('gray');
    expect(kindChipColor('watch')).toBe('amber');
  });

  test('canRemind: リマインダーを紐づけられるのは注目ポイントだけ', () => {
    expect(canRemind('memo')).toBe(false);
    expect(canRemind('watch')).toBe(true);
  });
});
