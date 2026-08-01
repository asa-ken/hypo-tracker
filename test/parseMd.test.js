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

  // 注目ポイントの自動取り込み: 本文＋イベント日を1行(1カード分)にまとめる
  test('注目ポイント: 本文のみ(イベント日なし)を1行にまとめる', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 注目ポイント',
      '- 本文: 出来高が急増したら要警戒',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    expect(p.rows.length).toBe(1);
    expect(p.rows[0].block).toBe('注目ポイント');
    expect(p.rows[0].value).toBe('出来高が急増したら要警戒');
    expect(p.rows[0].eventDate).toBeNull();
  });

  test('注目ポイント: 本文とイベント日を1行にまとめる', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 注目ポイント',
      '- 本文: DC向け光ケーブル需要が続伸するか',
      '- イベント日: 2026/8/7',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    expect(p.rows.length).toBe(1);
    expect(p.rows[0].value).toBe('DC向け光ケーブル需要が続伸するか');
    expect(p.rows[0].eventDate).toBe('2026/8/7');
  });

  test('注目ポイント: 複数回登場する場合、それぞれ別行に分離する', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 注目ポイント',
      '- 本文: 1つ目の注目ポイント',
      '- イベント日: 2026/8/7',
      '## 注目ポイント',
      '- 本文: 2つ目の注目ポイント(イベント日なし)',
      '## 注目ポイント',
      '- 本文: 3つ目の注目ポイント',
      '- イベント日: 2026/9/1',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    const pts = p.rows.filter(r => r.block === '注目ポイント');
    expect(pts.length).toBe(3);
    expect(pts[0].value).toBe('1つ目の注目ポイント');
    expect(pts[0].eventDate).toBe('2026/8/7');
    expect(pts[1].value).toBe('2つ目の注目ポイント(イベント日なし)');
    expect(pts[1].eventDate).toBeNull();
    expect(pts[2].value).toBe('3つ目の注目ポイント');
    expect(pts[2].eventDate).toBe('2026/9/1');
  });

  test('注目ポイントが指標・分析ブロックと混在しても互いに影響しない', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 指標',
      '- PER(予想): 36.2 | 2026/7/13',
      '## 注目ポイント',
      '- 本文: 出来高急増に要警戒',
      '- イベント日: 2026/8/7',
      '## 分析',
      '- 主要競合(サマリ): 古河電工と競合。 | 2026/7/13',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    expect(p.rows.find(r => r.key === 'PER(予想)')).toBeTruthy();
    expect(p.rows.find(r => r.block === '分析')).toBeTruthy();
    const pt = p.rows.find(r => r.block === '注目ポイント');
    expect(pt.value).toBe('出来高急増に要警戒');
    expect(pt.eventDate).toBe('2026/8/7');
    expect(p.rows.length).toBe(3);
  });

  // 自由文(見出しにも箇条書きにも当てはまらない会話の地の文)をメモ候補として拾う
  test('見出し・箇条書きに当てはまらない自由文をメモ候補にする', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '古河電工とのペア取引が効きそうな気がする。',
      '## 指標',
      '- PER(予想): 36.2 | 2026/7/13',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    expect(p.memoCandidates).toEqual(['古河電工とのペア取引が効きそうな気がする。']);
    expect(p.failed.length).toBe(0);
  });

  test('連続する自由文は1つのメモ候補にまとめ、空行で区切られていれば別候補にする', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '1行目の気づき',
      '2行目は1行目の続き',
      '',
      '別の話題のメモ',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    expect(p.memoCandidates).toEqual(['1行目の気づき\n2行目は1行目の続き', '別の話題のメモ']);
  });

  test('箇条書きの体裁だがkey:valueでない行は、従来通りfailedに入りメモ候補にはならない', () => {
    const text = ['- ただの箇条書きで区切りが無い行'].join('\n');
    const p = parseMd(text, baseCtx);
    expect(p.failed.length).toBe(1);
    expect(p.memoCandidates.length).toBe(0);
  });
});
