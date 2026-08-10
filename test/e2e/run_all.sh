#!/bin/bash
# 画面の回帰テストをまとめて実行する。
# index.html を実ブラウザ(Chromium)で開き、描画・タップ・保存まで通して確かめる。
# vitest(test/*.test.js)が lib/ の関数を単体で見るのに対し、こちらは画面の作りを見る。
#
#   bash test/e2e/run_all.sh           全スイート
#   bash test/e2e/run_all.sh design     指定したスイートだけ
#
# 環境変数:
#   CHROMIUM_PATH  Chromium の実行ファイル(既定はこの開発環境のパス)
#   E2E_PORT       確認用サーバーのポート(既定 8731)
set -u
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
PORT=${E2E_PORT:-8731}

SUITES="backaudit closebtn swipeback swipeback_pager swipeback_detail unify unify2 nobadge marketpage noconf scope mktmetrics presets benchmark design seceditor anagroup tabbar_fixed summary splitcopy swipedel swipedel_e2e detailfix hypokind watchdefault contrast homegroup caretbar subrow editprompt rowbar flatlist nodata metstat foldmet metorder glimit trendtap metwarn metmerge importpick hyporow memoblock hypocards hypohead remgroup rempick edithypo colortoken escuse sheettap homereach homeempty homeorder a11ytext pendhint remclass copyhead homeflat copylink copymsg briefcollapse orderlist parsegroup"
[ $# -gt 0 ] && SUITES="$*"

# サーバーが無ければこのスクリプトで起動し、終わったら片付ける。
# 起動し忘れて ERR_CONNECTION_REFUSED になるのを避ける。
# 片付けは pkill でパターン照合せず、起動したプロセスのPIDだけを止める
# (パターンだと、その文字列をコマンドラインに含む無関係なプロセスまで巻き込む)
SRV_PID=""
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html"; then
  (cd "$ROOT" && exec python3 -m http.server "$PORT" >/dev/null 2>&1) &
  SRV_PID=$!
  for _ in $(seq 1 30); do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html" && break
    sleep 0.3
  done
fi
cleanup(){ [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null; }
trap cleanup EXIT

fail=0
for s in $SUITES; do
  out=$(node "$s.js" 2>&1)
  n=$(grep -c '❌' <<<"$out")
  # JSエラーは画面が壊れた印なので、アサーションが全部通っていても失敗として扱う
  err=$(grep -o 'JSエラー: \[.*\]' <<<"$out" | grep -v '\[\]')
  if [ "$n" != "0" ] || [ -n "$err" ]; then
    fail=$((fail+1))
    echo "=== $s: NG ($n) ==="
    grep '❌' <<<"$out"
    [ -n "$err" ] && echo "$err"
  else
    echo "--- $s: ok ($(grep -c '✅' <<<"$out"))"
  fi
done
echo "失敗スイート: $fail"
exit $((fail > 0))
