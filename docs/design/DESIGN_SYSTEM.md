# DESIGN_SYSTEM.md

## この文書の位置付け
ここがhypo-trackerのデザイントークンの一次定義。実装時は `index.html` の `:root` と `test/e2e/design.js` の契約を一致させる。

各項目に「検査」を明記する。**検査がある項目とない項目を混同しないこと。** 検査がない項目は、テストが通っていることをもって遵守の証拠にできない。

現時点では spacing(gapのみ)・typography・color・タップ領域・escaping が機械検査されている。padding / margin は契約の対象外。

## Spacing
使用する余白は次の4段階だけ。
- `--sp1: 4px`
- `--sp2: 8px`
- `--sp3: 12px`
- `--sp4: 16px`

6px、3px等の新しい値を導入しない。

**検査あり(gapのみ)**: `test/e2e/design.js` の観点F が `index.html` の `gap:Npx` を集計し、`4/8/12/16` 以外を検出する。

**検査なし(padding / margin)**: padding と margin はトークン化されていない。実際に `padding:10px 12px`(入力欄)などトークン外の値が存在し、それが正しい実装として `design.js` の観点A で検査されている。**padding / margin をトークン逸脱として一括修正しないこと。** 拡張したい場合は独立したテーマとして `REVIEW_BACKLOG.md` に起票する。

## Typography
本文・UIの文字サイズは次の5段階。
- 11px … 日付・単位・補足(最小)
- 12px … 補助テキスト
- 13px … 本文
- 15px … 強調・小見出し
- 17px … 画面タイトル・指標の数値

入力欄のみ16pxを使用し、iOSの自動ズームを回避する。したがって合計6種類以内。

**11px は許容する。禁止は 11px 未満。** 通勤中にスマホで読む前提のため10px以下は使わない。

**検査あり**: `test/e2e/design.js` の観点A が font-size の種類数(6以内)、最小値(11以上)、入力欄16pxを検査する。

## Color
以下の変数を使用する。
```css
--bg:#eef0f2
--app:#f7f8f9
--card:#ffffff
--line:#e2e5e8
--line2:#cbd0d5
--ink:#1e2933
--ink2:#5a6672
--ink3:#8b95a1
--navy:#123a5e
--navy-bg:#e8eff5
--navy-tx:#123a5e
--amber-bg:#fbf0da
--amber-tx:#8a5a12
--green-bg:#e5f1df
--green-tx:#356124
--red-bg:#fbe6e4
--red-tx:#9c3329
```

**検査あり**: `test/e2e/colortoken.js` が次を見る。

- `:root` の色トークンが17個そろい、名前がこの文書と一致すること
- `:root` の外に新しい色リテラルが増えていないこと(既知の例外は同ファイルにリスト化)
- 色の直書き箇所が13件から増えていないこと

既知の例外は現在10種類(不透明5・半透明5)。影とスクリムの半透明は平坦なトークンで表せないため別枠で許している。例外を増やすときは `DECISIONS.md` に理由を書き、`colortoken.js` のリストへ追記する。

局所的な残色(角丸クリップの縁など)は `test/e2e/png.js` の画素スキャンで測定できる。これは逸脱検査ではなく、個別の描画不良を測る手段。

## Interaction
- タップ可能領域は44pxを下限とする。
- 指標グリッドは2列。

**検査あり(主要画面)**: `design.js` の観点D が `home` / `analysis` / `import` / `reminder` の4画面について、`#view button`、`.list-row`、`.sub-row`、`.sec .h` の高さを検査する。

**検査あり(シート)**: `test/e2e/sheettap.js` が注目ポイント編集 / 指標の管理 / 指標編集(主要指標・業績推移) / リマインダー追加の各シートを開き、`button`・`select`・`[onclick]`・`.list-row`・`.sub-row`・`.chip`・`a` の高さを検査する。

**検査の範囲外**: 上記に含まれないシートとセレクタ。新しいシートを足したら `sheettap.js` に追加する。

指標グリッドの2列は観点A で検査する。

## Escaping
- HTMLへ挿入する値は `esc()` を使う。
- `onclick` 内のJS文字列引数には `escArg()` を使う。
- 2つを用途混同しない。

**検査あり**: `test/e2e/escuse.js` が次を見る。

- `esc()` / `escArg()` の定義が残っていること
- `onclick` 等のイベント属性の中で `esc()` を使っていないこと(アポストロフィで属性が割れる)
- `escArg()` が必ず `'${escArg(x)}'` の形、つまりJSの文字列引数として使われていること

判定をシングルクォートの有無で行うのは、`statBadge(on, \`toggleMetric('snap','${escArg(k)}')\`)` のようにハンドラ文字列をヘルパーへ渡す間接的な形があるため。属性の字面だけで探すと、この形を誤検知する。

## 変更境界
トークンの定義そのものを変更するにはユーザー確認が必要。対象はspacing、font-size、color、44pxの下限、2列グリッド、escaping契約を含む。

個別コンポーネントの配置・構造変更は、既存トークンを守る限り自律判断できる。

## 逸脱を見つけた場合
まず既存トークンに合わせて実装できない理由を確認する。トークンを変更して解決する前に、使用箇所・波及範囲・代替案・E2E影響を整理し、ユーザーへ提示する。
