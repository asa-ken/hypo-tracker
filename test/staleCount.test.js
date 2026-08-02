import { describe, test, expect } from 'vitest';
import { staleCount } from '../lib/sections.js';

const metricsMaster = { snap: ['PER(予想)', 'ネットキャッシュ'], trend: [] };
// 今日から n 日前の日付を YYYY/M/D で作る
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

describe('staleCount', () => {
  // 四半期開示のBS項目などは決算直後を除き常に30日超になるため、
  // 指標を「要更新」に数えると構造的に永久に警告が出続けてしまう
  test('指標がどれだけ古くても要更新には数えない', () => {
    const s = {
      metrics: {
        'PER(予想)': { d: daysAgo(200) },
        'ネットキャッシュ': { d: daysAgo(65) },
      },
      sections: {},
    };
    expect(staleCount(s, metricsMaster)).toBe(0);
  });

  test('分析セクションは90日を超えたら要更新に数える', () => {
    const s = {
      metrics: {},
      sections: {
        '事業構造': { d: daysAgo(120) },
        '主要競合': { d: daysAgo(30) },
      },
    };
    expect(staleCount(s, metricsMaster)).toBe(1);
  });

  test('90日ちょうどはまだ要更新にしない', () => {
    const s = { metrics: {}, sections: { '事業構造': { d: daysAgo(90) } } };
    expect(staleCount(s, metricsMaster)).toBe(0);
  });

  test('古い指標と古い分析が混在しても、数えるのは分析だけ', () => {
    const s = {
      metrics: { 'PER(予想)': { d: daysAgo(300) } },
      sections: { '事業構造': { d: daysAgo(300) }, '主要競合': { d: daysAgo(300) } },
    };
    expect(staleCount(s, metricsMaster)).toBe(2);
  });
});
