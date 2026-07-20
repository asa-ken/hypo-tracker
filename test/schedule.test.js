import { describe, test, expect } from 'vitest';
import { calcNextFire } from '../lib/schedule.js';

describe('calcNextFire', () => {
  // 回帰テスト9: next-fire がハードコードで過去日になるバグの再発防止。
  // 「今」がいつであっても、返り値は必ず基準時刻より未来でなければならない。
  test('返り値は常に基準時刻(now)より未来である(遠い未来を基準にしても過去日を返さない)', () => {
    const r = { freq: '毎日', times: ['09:00'], startDate: null, endDate: null, changes: [] };
    const now = new Date(2031, 2, 10, 10, 0); // 2031/3/10 10:00 — アプリ内のどの固定日付よりも先
    const next = calcNextFire(r, now);
    expect(next).not.toBeNull();
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  test('毎日 09:00 で、まだ当日9時前なら当日、過ぎていれば翌日を返す', () => {
    const r = { freq: '毎日', times: ['09:00'], startDate: null, endDate: null, changes: [] };
    const before9 = new Date(2026, 6, 20, 8, 0); // 2026/7/20 08:00
    const next1 = calcNextFire(r, before9);
    expect(next1.getFullYear()).toBe(2026);
    expect(next1.getMonth()).toBe(6);
    expect(next1.getDate()).toBe(20);
    expect(next1.getHours()).toBe(9);

    const after9 = new Date(2026, 6, 20, 10, 0); // 2026/7/20 10:00
    const next2 = calcNextFire(r, after9);
    expect(next2.getDate()).toBe(21);
  });

  test('開始日(startDate)より前は発火しない', () => {
    const r = { freq: '毎日', times: ['09:00'], startDate: '2026/8/1', endDate: null, changes: [] };
    const now = new Date(2026, 6, 20, 8, 0); // 2026/7/20 (開始日より前)
    const next = calcNextFire(r, now);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(7); // 8月(0-indexed)
    expect(next.getDate()).toBe(1);
  });

  test('終了日(endDate)を過ぎたら null を返す', () => {
    const r = { freq: '毎日', times: ['09:00'], startDate: null, endDate: '2026/7/15', changes: [] };
    const now = new Date(2026, 6, 20, 8, 0); // 終了日より後
    const next = calcNextFire(r, now);
    expect(next).toBeNull();
  });

  test('終了日より前なら、終了日当日も発火しうる', () => {
    const r = { freq: '毎日', times: ['09:00'], startDate: null, endDate: '2026/7/20', changes: [] };
    const now = new Date(2026, 6, 20, 8, 0); // 終了日当日、9時前
    const next = calcNextFire(r, now);
    expect(next).not.toBeNull();
    expect(next.getDate()).toBe(20);
  });

  test('頻度変更(changes)の条件日を過ぎると、変更後の頻度・時刻が適用される', () => {
    const r = {
      freq: '平日', times: ['09:15', '15:30'], startDate: null, endDate: null,
      changes: [{ cond: '1Q決算 2026/8/7 になったら', freq: '毎日', times: '08:30,12:30,18:00' }],
    };
    // 条件日より前: 平日09:15/15:30 のまま
    const beforeChange = new Date(2026, 6, 20, 8, 0); // 2026/7/20(月) 08:00
    const next1 = calcNextFire(r, beforeChange);
    expect(next1.getHours()).toBe(9);
    expect(next1.getMinutes()).toBe(15);

    // 条件日を過ぎた後: 毎日08:30/12:30/18:00 に切り替わる
    const afterChange = new Date(2026, 7, 8, 7, 0); // 2026/8/8(土) 07:00 — 平日なら発火しないはずの曜日
    const next2 = calcNextFire(r, afterChange);
    expect(next2).not.toBeNull();
    expect(next2.getDate()).toBe(8); // 毎日頻度に変わっているので土曜でも発火する
    expect(next2.getHours()).toBe(8);
    expect(next2.getMinutes()).toBe(30);
  });

  test('毎時間(時間帯指定)は指定範囲の毎時に発火する', () => {
    const r = { freq: '毎時間', times: ['10:00-12:00'], startDate: null, endDate: null, changes: [] };
    const now = new Date(2026, 6, 20, 9, 0); // 2026/7/20 09:00(平日月曜)
    const next = calcNextFire(r, now);
    expect(next.getHours()).toBe(10);
    expect(next.getMinutes()).toBe(0);

    const afterFirst = new Date(2026, 6, 20, 10, 30); // 10時台の枠を過ぎた直後
    const next2 = calcNextFire(r, afterFirst);
    expect(next2.getHours()).toBe(11);
  });
});
