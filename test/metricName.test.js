import { describe, test, expect } from 'vitest';
import { metNorm, metSim, nearestMetric, newMetricsIn } from '../lib/metricName.js';

const SNAP = ['PER(予想)', 'PBR', '時価総額', '配当利回り(予想)', 'ROE', '営業利益率', '自己資本比率'];
const TREND = ['売上高', '営業利益', 'EPS', 'FCF'];

describe('metNorm: 表記のゆれを吸収する', () => {
  test('全角括弧を半角に揃える', () => {
    expect(metNorm('PER（予想）')).toBe(metNorm('PER(予想)'));
  });
  test('括弧・記号・空白を落とす', () => {
    expect(metNorm('営業利益率(%)')).toBe('営業利益率');
    expect(metNorm('自己資本 比率')).toBe('自己資本比率');
  });
  test('英字の全角と大文字小文字を揃える', () => {
    expect(metNorm('ＥＰＳ')).toBe('eps');
    expect(metNorm('eps')).toBe(metNorm('EPS'));
  });
});

describe('metSim: 同じ指標を指しているかの近さ', () => {
  test('記号の違いだけなら完全一致とみなす', () => {
    expect(metSim('営業利益率', '営業利益率(%)')).toBe(1);
    expect(metSim('PER(予想)', 'PER（予想）')).toBe(1);
  });
  test('一方が他方を含むなら高い', () => {
    expect(metSim('売上', '売上高')).toBeGreaterThanOrEqual(.9);
  });
  test('語順が入れ替わった別名も拾う', () => {
    expect(metSim('予想PER', 'PER(予想)')).toBeGreaterThanOrEqual(.6);
  });
  test('別物は低い', () => {
    expect(metSim('ROE', 'ROIC')).toBeLessThan(.6);
    expect(metSim('PER', 'PBR')).toBeLessThan(.6);
    expect(metSim('EPS', 'FCF')).toBeLessThan(.6);
    expect(metSim('時価総額', '営業利益')).toBeLessThan(.6);
  });
  test('空文字は0', () => {
    expect(metSim('', '売上高')).toBe(0);
    expect(metSim('売上高', '')).toBe(0);
  });
  test('左右を入れ替えても同じ', () => {
    expect(metSim('売上', '売上高')).toBe(metSim('売上高', '売上'));
    expect(metSim('予想PER', 'PER(予想)')).toBe(metSim('PER(予想)', '予想PER'));
  });
});

describe('nearestMetric: 一覧の中でいちばん近いものを返す', () => {
  test('表記揺れの相手を名指しできる', () => {
    expect(nearestMetric('売上', TREND).name).toBe('売上高');
    expect(nearestMetric('営業利益率(%)', SNAP).name).toBe('営業利益率');
    expect(nearestMetric('予想PER', SNAP).name).toBe('PER(予想)');
  });
  test('似たものが無ければ null', () => {
    expect(nearestMetric('ROIC', SNAP)).toBe(null);
    expect(nearestMetric('受注残高', TREND)).toBe(null);
  });
  test('一覧が空でも落ちない', () => {
    expect(nearestMetric('売上', [])).toBe(null);
    expect(nearestMetric('売上', undefined)).toBe(null);
  });
  test('複数の候補があればより近いほうを選ぶ', () => {
    expect(nearestMetric('営業利益', ['営業利益率', '営業利益']).name).toBe('営業利益');
  });
});

describe('newMetricsIn: 取り込みで増える指標を洗い出す', () => {
  const rows = (...a) => a;
  const snapRow = k => ({ block: '指標', key: k, value: '1' });
  const trendRow = k => ({ block: '業績推移', key: k, value: '25年3月期=1' });

  test('マスターにある指標は増えない', () => {
    expect(newMetricsIn(rows(snapRow('PBR'), trendRow('売上高')), SNAP, TREND, false)).toEqual([]);
  });
  test('新しい指標を拾い、似た既存名を添える', () => {
    const r = newMetricsIn(rows(trendRow('売上')), SNAP, TREND, false);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: '売上', kind: 'trend' });
    expect(r[0].near.name).toBe('売上高');
  });
  test('似たものが無い新指標は near が null', () => {
    const r = newMetricsIn(rows(snapRow('ROIC')), SNAP, TREND, false);
    expect(r).toHaveLength(1);
    expect(r[0].near).toBe(null);
  });
  test('スナップショットと業績推移は別のマスターで判定する', () => {
    // 業績推移にある「営業利益」も、スナップショット指標としては新規
    const r = newMetricsIn(rows(snapRow('営業利益')), SNAP, TREND, false);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('snap');
  });
  test('同じ名前が複数行にあっても1件だけ知らせる', () => {
    const r = newMetricsIn(rows(trendRow('売上'), trendRow('売上')), SNAP, TREND, false);
    expect(r).toHaveLength(1);
  });
  test('市場・テーマのカードでは業績推移を見ない', () => {
    expect(newMetricsIn(rows(trendRow('売上')), SNAP, TREND, true)).toEqual([]);
  });
  test('市場・テーマでもスナップショット指標は見る', () => {
    const r = newMetricsIn(rows(snapRow('騰落レシオ')), SNAP, TREND, true);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('snap');
  });
  test('分析やまとめの行は対象外', () => {
    const r = newMetricsIn(rows({ block: '分析', key: '収益モデル', value: 'x' },
                                { block: 'ざっくりまとめ', key: '本文', value: 'x' }), SNAP, TREND, false);
    expect(r).toEqual([]);
  });
  test('行が無くても落ちない', () => {
    expect(newMetricsIn([], SNAP, TREND, false)).toEqual([]);
    expect(newMetricsIn(undefined, SNAP, TREND, false)).toEqual([]);
  });
});
