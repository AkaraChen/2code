_2CODE_HOME="${HOME}/.2code"
_2CODE_BIN="${_2CODE_HOME}/bin"
_2CODE_HOOKS="${_2CODE_HOME}/hooks"
_2CODE_NOTIFY="${_2CODE_HOOKS}/notify.sh"
_2CODE_SETTINGS="${_2CODE_HOOKS}/claude-settings.json"
_2CODE_OPENCODE_NOTIFY_PLUGIN="${_2CODE_HOOKS}/opencode-notify-plugin.mjs"

command mkdir -p "$_2CODE_BIN" "$_2CODE_HOOKS" 2>/dev/null

cat >"$_2CODE_NOTIFY" <<'NOTIFY_SH'
#!/bin/bash
[[ -z "$_2CODE_HELPER" ]] && exit 0
"$_2CODE_HELPER" notify &>/dev/null &
NOTIFY_SH
command chmod +x "$_2CODE_NOTIFY"

printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"%s"}]}],"PermissionRequest":[{"matcher":"*","hooks":[{"type":"command","command":"%s"}]}]}}\n' \
	"$_2CODE_NOTIFY" "$_2CODE_NOTIFY" >"$_2CODE_SETTINGS"

printf '#!/bin/bash\n_SETTINGS="%s"\n' "$_2CODE_SETTINGS" >"$_2CODE_BIN/claude"
cat >>"$_2CODE_BIN/claude" <<'CLAUDE_WRAPPER'
_find_real() {
  local IFS=:
  for dir in $PATH; do
    [ -z "$dir" ] && continue
    case "${dir%/}" in
      "$HOME/.2code/bin") continue ;;
    esac
    if [ -x "$dir/claude" ] && [ ! -d "$dir/claude" ]; then
      printf '%s\n' "$dir/claude"
      return 0
    fi
  done
  return 1
}
_REAL="$(_find_real)"
if [ -z "$_REAL" ]; then
  echo "2code: claude not found in PATH" >&2
  exit 127
fi
exec "$_REAL" --settings "$_SETTINGS" "$@"
CLAUDE_WRAPPER
command chmod +x "$_2CODE_BIN/claude"

cat >"$_2CODE_OPENCODE_NOTIFY_PLUGIN" <<'OPENCODE_NOTIFY_PLUGIN'
import { spawn } from "node:child_process";

function fireNotify() {
	const helper = process.env._2CODE_HELPER;
	if (!helper) return;
	try {
		const child = spawn(helper, ["notify"], {
			stdio: "ignore",
			detached: true,
		});
		child.unref();
	} catch {
		// ignore notify errors
	}
}

export const TwoCodeNotifyPlugin = async () => ({
	event: async ({ event }) => {
		if (event?.type !== "session.idle") return;
		fireNotify();
	},
});
OPENCODE_NOTIFY_PLUGIN

printf '#!/bin/bash\n_NOTIFY_PLUGIN="%s"\n' "$_2CODE_OPENCODE_NOTIFY_PLUGIN" >"$_2CODE_BIN/opencode"
cat >>"$_2CODE_BIN/opencode" <<'OPENCODE_WRAPPER'
_find_real() {
  local IFS=:
  for dir in $PATH; do
    [ -z "$dir" ] && continue
    case "${dir%/}" in
      "$HOME/.2code/bin") continue ;;
    esac
    if [ -x "$dir/opencode" ] && [ ! -d "$dir/opencode" ]; then
      printf '%s\n' "$dir/opencode"
      return 0
    fi
  done
  return 1
}
_REAL="$(_find_real)"
if [ -z "$_REAL" ]; then
  echo "2code: opencode not found in PATH" >&2
  exit 127
fi
_PLUGIN_JSON="{\"plugin\":[\"file://$_NOTIFY_PLUGIN\"]}"
if [ -n "$OPENCODE_CONFIG_CONTENT" ]; then
  _MERGED="$(OPENCODE_CONFIG_CONTENT="$OPENCODE_CONFIG_CONTENT" OPENCODE_PLUGIN_JSON="$_PLUGIN_JSON" python3 - <<'PY'
import json
import os
import sys

base_raw = os.environ.get("OPENCODE_CONFIG_CONTENT", "")
patch_raw = os.environ.get("OPENCODE_PLUGIN_JSON", "")

try:
    base = json.loads(base_raw) if base_raw.strip() else {}
except Exception:
    base = {}
try:
    patch = json.loads(patch_raw)
except Exception:
    patch = {}

plugins = []
for src in (base.get("plugin", []), patch.get("plugin", [])):
    if isinstance(src, list):
        for item in src:
            if isinstance(item, str) and item not in plugins:
                plugins.append(item)

if plugins:
    base["plugin"] = plugins

sys.stdout.write(json.dumps(base, separators=(",", ":")))
PY
)"
  if [ -n "$_MERGED" ]; then
    _PLUGIN_JSON="$_MERGED"
  fi
fi
OPENCODE_CONFIG_CONTENT="$_PLUGIN_JSON" exec "$_REAL" "$@"
OPENCODE_WRAPPER
command chmod +x "$_2CODE_BIN/opencode"

printf '#!/bin/bash\n_NOTIFY="%s"\n' "$_2CODE_NOTIFY" >"$_2CODE_BIN/codex"
cat >>"$_2CODE_BIN/codex" <<'CODEX_WRAPPER'
_find_real() {
  local IFS=:
  for dir in $PATH; do
    [ -z "$dir" ] && continue
    case "${dir%/}" in
      "$HOME/.2code/bin") continue ;;
    esac
    if [ -x "$dir/codex" ] && [ ! -d "$dir/codex" ]; then
      printf '%s\n' "$dir/codex"
      return 0
    fi
  done
  return 1
}
_REAL="$(_find_real)"
if [ -z "$_REAL" ]; then
  echo "2code: codex not found in PATH" >&2
  exit 127
fi
exec "$_REAL" -c "notify=[\"$_NOTIFY\"]" "$@"
CODEX_WRAPPER
command chmod +x "$_2CODE_BIN/codex"

export PATH="$_2CODE_BIN:$PATH"

unsetopt PROMPT_SP
