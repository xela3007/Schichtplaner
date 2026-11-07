#!/bin/sh
# Writes the runtime config for the SPA (ADR-007/009).
# Only NAMED variables are written — never the whole environment, otherwise
# secrets would end up in the browser.
set -eu

target="${CONFIG_JS_PATH:-/usr/share/nginx/html/config.js}"

# JSON string escaping for a single value: drop CR/LF, escape \ and ".
json_escape() {
  printf '%s' "$1" | tr -d '\r\n' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

api_base_url="$(json_escape "${API_BASE_URL:-}")"

printf 'window.__APP_CONFIG__ = { "API_BASE_URL": "%s" };\n' "$api_base_url" > "$target"
echo "config.js written to $target"
