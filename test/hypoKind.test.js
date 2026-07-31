import { describe, test, expect } from 'vitest';
import { kindLabel, kindChipColor, showsEvent } from '../lib/hypoKind.js';

describe('hypoKind', () => {
  test('kindLabel', () => {
    expect(kindLabel('memo')).toBe('メモ');
    expect(kindLabel('watch')).toBe('注目');
  });

  test('kindChipColor', () => {
    expect(kindChipColor('memo')).toBe('gray');
    expect(kindChipColor('watch')).toBe('amber');
  });

  test('showsEvent', () => {
    expect(showsEvent('memo')).toBe(false);
    expect(showsEvent('watch')).toBe(true);
  });
});
