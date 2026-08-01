# hypo-tracker プロジェクト規約

## 応答言語
- 応答は日本語で行う。

## コミット運用
- 作業の区切りごとに git commit する。いつでも切り戻せる状態を保つのが目的。
- git commit(git add含む)・git push・PRの作成・mainへのマージは確認なしで自動実行してよい。コードの変更が完了したら、pushしてPRを作成/更新し、mainまでマージするところまで一気に行う。

## lib/ と index.html の関係
- `lib/` 配下の各ファイルは必ず CommonJS(`module.exports`)のまま維持する。ES Modules化しない。
  - 理由: `index.html` が `<script src="lib/...">` で読み込み、`onclick="..."` から直接グローバル関数として呼ぶ構成のため、ES Modules化すると本体が壊れる。
  - テストファイル(`test/`)側は ESM の `import` を使ってよい(Vitest が CJS→ESM の相互運用を吸収する)。
- `index.html` 本体(スクリプトタグの追加、関数呼び出し箇所の書き換えなど)の統合作業は、明示的に指示されたときだけ行う。`lib/` の切り出し作業だけでは本体に手を入れない。

## 確認ルール(作業の自動実行範囲)
- 以下は確認なしで自動的に進めてよい:
  - `lib/`・`test/`・`index.html` を含む、すべてのファイルの作成・編集
  - 読み取り系コマンド(`npm test`、`git status`、`git diff`、`git log` など)、開発中のサーバー起動・停止(`python3 -m http.server`、`lsof`/`kill`など)
  - `git add` / `git commit` / `git push` / PRの作成・更新・mainへのマージ
- 以下は必ず事前にユーザーに確認する:
  - `rm` を伴う削除
  - `node_modules` 以外に対するその他の破壊的操作

(上記の確認範囲は `.claude/settings.json` の permissions にも反映済み)
