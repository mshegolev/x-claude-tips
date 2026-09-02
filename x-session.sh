#!/usr/bin/env bash
# Идемпотентный префлайт X-сессии. Безопасно запускать повторно.
set -euo pipefail

SERVER_DIR="${XTIPS_SERVER_DIR:-$HOME/.config/opencode/tools/x-browser-mcp}"
PORT=18110
API="http://127.0.0.1:$PORT"
COOKIES="$SERVER_DIR/x_session_cookies.json"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

api() { curl -s --noproxy '*' --max-time "${2:-180}" "$API$1"; }

# 1. Chrome, а не Firefox: defaultBrowserBin() в config.go:70 перебирает
#    кандидатов и Firefox стоит первым, из-за чего rod падает до сети.
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "x-session: Chrome not found at $CHROME" >&2
  exit 1
fi

# 2. Сервер поднят?
if ! api /health 10 | grep -q '"ok":true'; then
  echo "x-session: starting x-browser-mcp"
  # -user-data-dir "" включает CookieMode() (config.go:95); при непустом
  # значении сервер игнорирует x_session_cookies.json.
  ( cd "$SERVER_DIR" \
    && ROD_BROWSER_BIN="$CHROME" \
       X_BROWSER_PROXY="${X_BROWSER_PROXY:-${HTTPS_PROXY:-}}" \
       nohup ./x-browser-mcp -user-data-dir "" -login-timeout 15m \
       >/tmp/xtips-server.log 2>&1 & )
  for _ in $(seq 1 15); do
    api /health 5 | grep -q '"ok":true' && break
    sleep 1
  done
fi

if ! api /health 10 | grep -q '"ok":true'; then
  echo "x-session: server failed to start; see /tmp/xtips-server.log" >&2
  exit 1
fi

# 3. Сессия готова?
if api /api/v1/login/status | grep -q '"state":"ready"'; then
  echo "x-session: ready"
  exit 0
fi

# 4. Куки из живого Chrome-профиля.
echo "x-session: session not ready, extracting cookies from Chrome profile"
if node "$SKILL_DIR/lib/chrome-cookies.js" "$COOKIES"; then
  if api /api/v1/login/status | grep -q '"state":"ready"'; then
    echo "x-session: ready (cookies from Chrome profile)"
    exit 0
  fi
fi

# 5. Только теперь — интерактивный логин. Дефолтные 4 минуты на практике
#    истекают раньше, чем человек успевает среагировать, поэтому 15m.
echo "x-session: cookie import did not work; opening interactive login" >&2
curl -s --noproxy '*' --max-time 60 -X POST "$API/api/v1/login/start" >&2
echo >&2
echo "x-session: log into X in the opened Chrome window, close it, then rerun" >&2
exit 2
