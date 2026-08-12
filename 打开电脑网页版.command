#!/bin/zsh
cd "$(dirname "$0")" || exit 1

PORT=4173
URL="http://127.0.0.1:${PORT}"

if curl -fsS "$URL" >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi

python3 -m http.server "$PORT" >/tmp/gentle-todo-web.log 2>&1 &
SERVER_PID=$!
sleep 1
open "$URL"

echo "喵汪待办电脑网页版已经打开。"
echo "请保持这个窗口开启；关闭窗口后，网页服务会停止。"
wait "$SERVER_PID"
