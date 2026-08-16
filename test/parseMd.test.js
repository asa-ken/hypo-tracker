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

  // 説明書はメモに「本文の行を繰り返す」、注目ポイントに「見出しごと繰り返す」という異なる
  // 書式を指示しており、GPTが混同して「本文:」ラベルを省いた箇条書きを出すことがある
  // (ユーザー指摘、2026-08-15)。メモと同じく、ラベルが無くても読めなかった行に落とさない
  test('注目ポイント: 「本文:」ラベルが無くても読めなかった行にしない', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 注目ポイント',
      '- 出来高が急増したら要警戒',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    expect(p.failed).toEqual([]);
    expect(p.rows.length).toBe(1);
    expect(p.rows[0].block).toBe('注目ポイント');
    expect(p.rows[0].value).toBe('出来高が急増したら要警戒');
  });

  test('注目ポイント: ラベル無しの複数の箇条書きをそれぞれ別行に分離する', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 注目ポイント',
      '- 1つ目の注目ポイント',
      '- 2つ目の注目ポイント',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    expect(p.failed).toEqual([]);
    const pts = p.rows.filter(r => r.block === '注目ポイント');
    expect(pts.length).toBe(2);
    expect(pts[0].value).toBe('1つ目の注目ポイント');
    expect(pts[1].value).toBe('2つ目の注目ポイント');
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

  // 回帰: 注目ポイント内の想定外キーがそのまま注目ポイントカードになっていた
  test('注目ポイント内の 本文・イベント日 以外のキーはカード化せずメモ候補に回す', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 注目ポイント',
      '- 本文: 正しい注目点',
      '- 出典: 株探',
      '- 確信度: 高',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    const pts = p.rows.filter(r => r.block === '注目ポイント');
    expect(pts.length).toBe(1);
    expect(pts[0].value).toBe('正しい注目点');
    expect(p.memoCandidates).toEqual(['出典: 株探', '確信度: 高']);
  });

  test('本文より前に来たイベント日はカード化せずメモ候補に回す', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 注目ポイント',
      '- イベント日: 2026/8/7',
      '- 本文: 本命の注目点',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    const pts = p.rows.filter(r => r.block === '注目ポイント');
    expect(pts.length).toBe(1);
    expect(pts[0].value).toBe('本命の注目点');
    expect(pts[0].eventDate).toBeNull();
    expect(p.memoCandidates).toEqual(['イベント日: 2026/8/7']);
  });

  test('本文の後の想定外キーを挟んでも、後続のイベント日は同じ注目ポイントに紐づく', () => {
    const text = [
      '# 銘柄: フジクラ (5803)',
      '## 注目ポイント',
      '- 本文: 出来高急増に要警戒',
      '- 確信度: 高',
      '- イベント日: 2026/8/7',
    ].join('\n');
    const p = parseMd(text, baseCtx);
    const pts = p.rows.filter(r => r.block === '注目ポイント');
    expect(pts.length).toBe(1);
    expect(pts[0].eventDate).toBe('2026/8/7');
    expect(p.memoCandidates).toEqual(['確信度: 高']);
  });
});

describe('「## メモ」: 会話の中の本人の発言を拾う', () => {
  const ctx = { metricsMaster, sectionMaster, marketSectionMaster };
  test('メモ欄の本文がメモ候補になる', () => {
    const r = parseMd('# 銘柄: A社 (1234)\n## メモ\n- 本文: 保守で稼ぐ形に変わりつつある気がする', ctx);
    expect(r.memoCandidates).toContain('保守で稼ぐ形に変わりつつある気がする');
  });
  test('メモ欄は分析やカードの行にはしない', () => {
    const r = parseMd('# 銘柄: A社 (1234)\n## メモ\n- 本文: あとで読み返したい', ctx);
    expect(r.rows.filter(x => x.block === 'メモ')).toHaveLength(0);
  });
  test('複数の本文をそれぞれ拾う', () => {
    const r = parseMd('# 銘柄: A社 (1234)\n## メモ\n- 本文: ひとつめ\n- 本文: ふたつめ', ctx);
    expect(r.memoCandidates).toEqual(expect.arrayContaining(['ひとつめ', 'ふたつめ']));
  });
  test('ラベルが無い書き方も受ける', () => {
    const r = parseMd('# 銘柄: A社 (1234)\n## メモ\n- 配当より成長を優先して見ている', ctx);
    expect(r.memoCandidates.join()).toMatch(/配当より成長/);
  });
  test('見出しの無い自由文より前に並ぶ', () => {
    const r = parseMd('# 銘柄: A社 (1234)\n地の文です\n\n## メモ\n- 本文: 本人の考え', ctx);
    expect(r.memoCandidates[0]).toBe('本人の考え');
  });
  test('メモ欄が無くても落ちない', () => {
    const r = parseMd('# 銘柄: A社 (1234)\n## 指標\n- PBR: 1.2 | 2026/8/7', ctx);
    expect(r.memoCandidates).toEqual([]);
  });
});

describe('見出しの「#」が落ちても読める', () => {
  const ctx = { metricsMaster, sectionMaster, marketSectionMaster };
  const stripped = [
    '銘柄: A社 (1234)',
    '指標',
    '- PBR: 1.2 | 2026/8/7',
    '業績推移',
    '- 売上高: 25年3月期=100 | 単位:百万円 | 2026/8/7',
    'メモ',
    '- 本文: 本人の考え',
  ].join('\n');
  test('銘柄を特定できる', () => {
    expect(parseMd(stripped, ctx).stock).toMatchObject({ name: 'A社', code: '1234' });
  });
  test('見出し語がメモ候補に混ざらない', () => {
    const m = parseMd(stripped, ctx).memoCandidates;
    expect(m).not.toContain('指標');
    expect(m).not.toContain('業績推移');
    expect(m).not.toContain('銘柄: A社 (1234)');
  });
  test('各行が正しい見出しに入る', () => {
    const r = parseMd(stripped, ctx);
    expect(r.rows.find(x => x.key === 'PBR').block).toBe('指標');
    expect(r.rows.find(x => x.key === '売上高').block).toBe('業績推移');
  });
  test('メモ欄も拾える', () => {
    expect(parseMd(stripped, ctx).memoCandidates).toContain('本人の考え');
  });
  test('見出し語で始まるだけの文章は見出しにしない', () => {
    const r = parseMd('# 銘柄: A社 (1234)\n分析すると、来期は厳しそうだ', ctx);
    expect(r.memoCandidates).toContain('分析すると、来期は厳しそうだ');
  });
  test('箇条書きの「銘柄:」は見出しにしない', () => {
    const r = parseMd('# 銘柄: A社 (1234)\n## 分析\n- 銘柄: B社 (5678) との比較 | 2026/8/7', ctx);
    expect(r.stock).toMatchObject({ code: '1234' });
  });
});

// 対象未選択のまま質問文を生成すると、アプリ自身が指示文に
// 「# 銘柄またはテーマ: (会話の中で対象を明記してください)」というプレースホルダー見出しを
// 埋め込む(index.html genOrderNew)。外部AIがこれを字面通り使って回答することがあるため、
// 「銘柄:」「テーマ:」と同じ意味の見出しとして読めるようにした(ユーザー報告、2026-08-13)
describe('「銘柄またはテーマ:」見出し(genOrderNewのプレースホルダーがそのまま返るケース)', () => {
  const ctx = { metricsMaster, sectionMaster, marketSectionMaster };
  test('コード付きなら銘柄として認識する', () => {
    const r = parseMd('# 銘柄またはテーマ: 日東工器 (6151)\n## 指標\n- PBR: 1.2 | 2026/8/7', ctx);
    expect(r.stock).toMatchObject({ name: '日東工器', code: '6151' });
    expect(r.stock.isMarket).toBeFalsy();
  });
  test('全角カッコのコードも銘柄として認識する', () => {
    const r = parseMd('# 銘柄またはテーマ: 日東工器（6151）／AIデータセンター液冷技術\n## 指標\n- PBR: 1.2 | 2026/8/7', ctx);
    expect(r.stock).toMatchObject({ name: '日東工器', code: '6151' });
  });
  test('コードが無ければテーマとして認識する', () => {
    const r = parseMd('# 銘柄またはテーマ: AIデータセンター液冷技術\n## 指標\n- 市場規模: 1.2 | 単位:兆円 | 2026/8/7', ctx);
    expect(r.stock).toMatchObject({ name: 'AIデータセンター液冷技術', isMarket: true });
  });
});

// GPTが財務指標・業績推移の生数値(売上高: 25年3月期=...など)を「## 業績推移」「## 指標」に
// 分けず、「## 分析」の中にサマリ/詳細の文章と一緒にまとめて出力するケースがあった。
// 既存の分析サブ項目名(主要競合など)と一致しないため「該当セクション不明」に落ち、取り込み時に
// ほとんどの財務データが「その他」扱いになっていた(ユーザー報告、2026-08-13)。既に分析サブ項目
// として一致する行以外は、「## 分析」配下でも指標/業績推移らしい行をキー・値の形から救い出す
describe('「## 分析」の中の財務指標・業績推移データを救い出す', () => {
  const ctx = { metricsMaster, sectionMaster, marketSectionMaster };
  const MD = `# 銘柄: A社 (1234)
## 分析
- 主要競合(サマリ): 既存の分析文。 | 2026/8/7
- 売上高: 25年3月期=100 | 26年3月期=120 | 単位:百万円 | 2026/8/7
- PBR: 25年3月期=1.2 | 26年3月期=1.5 | 単位:倍 | 2026/8/7
- 未知の指標XYZ: 25年3月期=10 | 26年3月期=20 | 単位:% | 2026/8/7`;
  const rows = () => parseMd(MD, ctx).rows;
  test('既存の分析サブ項目に一致する行はそのまま分析ブロックに残る', () => {
    expect(rows().find(r => r.key === '主要競合(サマリ)').block).toBe('分析');
  });
  test('登録済みの業績推移名(売上高)は業績推移ブロックへ救い出す', () => {
    expect(rows().find(r => r.key === '売上高').block).toBe('業績推移');
  });
  test('登録済みの指標名(PBR)は指標ブロックへ救い出す(値が複数年でも指標名一致を優先)', () => {
    expect(rows().find(r => r.key === 'PBR').block).toBe('指標');
  });
  test('未登録の財務指標でも複数年の値の形から業績推移として救い出す', () => {
    expect(rows().find(r => r.key === '未知の指標XYZ').block).toBe('業績推移');
  });
  test('取り込み判定(resolveSection)ではもう「その他」扱いにならない', () => {
    const r = parseMd(MD, ctx);
    ['売上高', 'PBR', '未知の指標XYZ'].forEach(k => {
      const row = r.rows.find(x => x.key === k);
      expect(row.block).not.toBe('分析');
    });
  });
});
