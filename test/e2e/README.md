# 画面の回帰テスト(Playwright)

`index.html` を実ブラウザで開き、描画・タップ・保存まで通して確かめる。
`test/*.test.js`(vitest)が `lib/` の関数を単体で見るのに対し、こちらは**画面の作り**を見る。

```
npm test        lib/ の単体テスト(vitest)
npm run e2e     画面の回帰テスト(このディレクトリ)
```

## 走らせ方

```bash
npm run e2e                      # 全スイート
bash test/e2e/run_all.sh design  # 指定したスイートだけ
```

確認用のサーバー(`python3 -m http.server`)は `run_all.sh` が自前で起動し、終了時に片付ける。
すでに動いていればそれを使う。

環境変数で差し替えられる:

| 変数 | 既定 | 用途 |
|---|---|---|
| `CHROMIUM_PATH` | `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` | Chromium の実行ファイル |
| `E2E_PORT` | `8731` | 確認用サーバーのポート |

## 書き方

1スイート＝1つの Node スクリプト。`ok(ラベル, 真偽値)` を並べるだけで、
`✅`/`❌` を出力する。`run_all.sh` はその記号を数えて合否を決める。

```js
const { chromium } = require('playwright');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = require('fs');
const td = fs.readFileSync(__dirname + '/fixtures/testdata.json', 'utf8');
const ok = (l, v) => console.log((v ? '✅' : '❌') + ' ' + l + ' → ' + JSON.stringify(v));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  // 画面が壊れていないかも見る。アサーションが通っていてもJSエラーがあれば失敗扱い
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8731/index.html');
  await p.evaluate(t => localStorage.setItem('hypo_tracker_proto_v1', t), td);
  await p.reload(); await p.waitForTimeout(400);

  ok('説明', await p.evaluate(() => /* ... */ true));

  console.log('JSエラー:', JSON.stringify(errs));
  await b.close();
})();
```

新しいスイートを足したら `run_all.sh` の `SUITES` に名前を追加する。

## 決めごと

- **ラベルは日本語で、仕様として読める文にする。**
  「削除ボタンの角丸は切り抜きより大きい」のように、何を守っているかが分かる書き方にする。
  要約や引き継ぎで経緯が失われても、ここを読めば意図が復元できる。
- **直したら、直す前に落ちることを確かめる。**
  通るだけのテストは何も守っていない。
- **見た目の不具合は、見た目を測って確かめる。**
  CSSの取り決めだけでは「実際にどう描かれたか」は保証できない。
  `png.js` に最小限のPNGデコーダを置いてあるので、スクリーンショットを画素で読める
  (例: `hypocards.js` はカードの角に赤が残っていないことを画素で確認している)。

## テストデータ

`fixtures/testdata.json` は localStorage にそのまま入れる形。
テスト精機(9001)・サンプル半導体(9002)・ダミー商事(9003)・TESTCO(TSTC)・
テスト市場(mkt_test1)が入っており、リマインダーや注目ポイントの紐づけもここで作っている。
