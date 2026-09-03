#!/usr/bin/env bash
# Идемпотентный префлайт X-сессии. Безопасно запускать повторно.
set -euo pipefail

SERVER_DIR="${XTIPS_SERVER_DIR:-$HOME/.config/opencode/tools/x-browser-mcp}"
PORT=18110
API="http://127.0.0.1:$PORT"

# Куки живут ВНЕ любого git-дерева. $SERVER_DIR — рабочая копия Go-репо,
# чей .gitignore не покрывает x_session_cookies.json: один `git add -A`
# там закоммитил бы живую X-сессию. Каталог создаётся с правами 0700,
# сам файл пишется 0600 (lib/chrome-cookies.js).
COOKIES="${XTIPS_COOKIES:-$HOME/.config/x-claude-tips/x_session_cookies.json}"
COOKIES_DIR="$(dirname "$COOKIES")"
LEGACY_COOKIES="$SERVER_DIR/x_session_cookies.json"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

api() { curl -s --noproxy '*' --max-time "${2:-180}" "$API$1"; }

# session_file из /api/v1/login/status (types.go:99 → Config.SessionStoragePath):
# в cookie-режиме это путь к файлу кук, в profile-режиме — каталог профиля.
# Единственный способ узнать, в каком режиме поднят УЖЕ РАБОТАЮЩИЙ сервер.
# `|| true` — чтобы недоступный сервер не ронял скрипт через set -e/pipefail.
session_file() {
  api /api/v1/login/status 30 2>/dev/null \
    | sed -n 's/.*"session_file":"\([^"]*\)".*/\1/p' || true
}

listener_pids() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true
}

# Останавливаем ИМЕННО слушателя порта. Никакого `pkill -f x-browser-mcp`:
# этот паттерн совпадает с вызывающей оболочкой и убивает вызывающего.
stop_server() {
  if ! command -v lsof >/dev/null 2>&1; then
    echo "x-session: lsof not found; cannot stop the server on port $PORT" >&2
    return 1
  fi
  local pids pid
  pids="$(listener_pids)"
  if [ -z "$pids" ]; then
    return 0
  fi
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
  for _ in $(seq 1 15); do
    if [ -z "$(listener_pids)" ]; then
      return 0
    fi
    sleep 1
  done
  for pid in $(listener_pids); do
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1
  [ -z "$(listener_pids)" ]
}

start_server() {
  echo "x-session: starting x-browser-mcp (cookies: $COOKIES)"
  # -user-data-dir "" включает CookieMode() (config.go:95); при непустом
  # значении сервер игнорирует файл кук. -cookies задаёт путь явно, иначе
  # сервер по умолчанию берёт <wd>/x_session_cookies.json (config.go:53).
  ( cd "$SERVER_DIR" \
    && ROD_BROWSER_BIN="$CHROME" \
       X_BROWSER_PROXY="${X_BROWSER_PROXY:-${HTTPS_PROXY:-}}" \
       nohup ./x-browser-mcp -user-data-dir "" -cookies "$COOKIES" \
       -login-timeout 15m >/tmp/xtips-server.log 2>&1 & )
  for _ in $(seq 1 15); do
    if api /health 5 | grep -q '"ok":true'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# 0. Каталог для кук — вне git, 0700, создаётся только если его нет.
if [ ! -d "$COOKIES_DIR" ]; then
  mkdir -p "$COOKIES_DIR"
  chmod 700 "$COOKIES_DIR"
fi

# 0b. Миграция со старого пути внутри git working tree. Именно перенос,
#     а не копия: копия оставила бы креды в отслеживаемом дереве.
if [ "$LEGACY_COOKIES" != "$COOKIES" ] && [ -f "$LEGACY_COOKIES" ]; then
  if [ -e "$COOKIES" ]; then
    superseded="$COOKIES.superseded-$(date +%Y%m%dT%H%M%S)"
    mv "$LEGACY_COOKIES" "$superseded"
    chmod 600 "$superseded"
    echo "x-session: a stale cookie file sat in $SERVER_DIR (a git working" >&2
    echo "x-session: tree); moved it to $superseded" >&2
  else
    mv "$LEGACY_COOKIES" "$COOKIES"
    chmod 600 "$COOKIES"
    echo "x-session: cookie file moved out of $SERVER_DIR (a git working" >&2
    echo "x-session: tree, which does not ignore it) -> $COOKIES" >&2
  fi
fi

# 1. Chrome, а не Firefox: defaultBrowserBin() в config.go:70 перебирает
#    кандидатов и Firefox стоит первым, из-за чего rod падает до сети.
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "x-session: Chrome not found at $CHROME" >&2
  exit 1
fi

# 2. Сервер поднят?
if ! api /health 10 | grep -q '"ok":true'; then
  start_server || true
fi

if ! api /health 10 | grep -q '"ok":true'; then
  echo "x-session: server failed to start; see /tmp/xtips-server.log" >&2
  exit 1
fi

# 3. Тот ли это сервер? /health отвечает "ok" и в profile-режиме, и со
#    старым путём кук — в обоих случаях сервер молча проигнорирует файл,
#    который мы пишем, и каждый запуск скатывался бы в интерактивный логин.
current_session="$(session_file)"
if [ "$current_session" != "$COOKIES" ]; then
  echo "x-session: the server on port $PORT stores its session at" >&2
  echo "x-session:   ${current_session:-<unknown>}" >&2
  echo "x-session: but this preflight writes cookies to" >&2
  echo "x-session:   $COOKIES" >&2
  echo "x-session: (profile mode, or a server started with the old cookie" >&2
  echo "x-session: path). It would ignore our cookies, so it is being" >&2
  echo "x-session: stopped and restarted in cookie mode on the right path." >&2
  stop_server || {
    echo "x-session: could not stop the running server; stop it manually" >&2
    exit 1
  }
  start_server || {
    echo "x-session: server failed to restart; see /tmp/xtips-server.log" >&2
    exit 1
  }
  current_session="$(session_file)"
  if [ "$current_session" != "$COOKIES" ]; then
    echo "x-session: restarted server still reports session storage" >&2
    echo "x-session:   ${current_session:-<unknown>}" >&2
    exit 1
  fi
fi

# 4. Сессия готова?
if api /api/v1/login/status | grep -q '"state":"ready"'; then
  echo "x-session: ready"
  exit 0
fi

# 5. Куки из живого Chrome-профиля.
echo "x-session: session not ready, extracting cookies from Chrome profile"
if node "$SKILL_DIR/lib/chrome-cookies.js" "$COOKIES"; then
  if api /api/v1/login/status | grep -q '"state":"ready"'; then
    echo "x-session: ready (cookies from Chrome profile)"
    exit 0
  fi
fi

# 6. Только теперь — интерактивный логин. Дефолтные 4 минуты на практике
#    истекают раньше, чем человек успевает среагировать, поэтому 15m.
echo "x-session: cookie import did not work; opening interactive login" >&2
curl -sS --noproxy '*' --max-time 60 -X POST "$API/api/v1/login/start" >&2 || true
echo >&2
echo "x-session: log into X in the opened Chrome window, close it, then rerun" >&2
exit 2
