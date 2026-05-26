_2CODE_HOME="${HOME}/.2code"
_2CODE_BIN="${_2CODE_HOME}/bin"
_2CODE_HOOKS="${_2CODE_HOME}/hooks"
_2CODE_NOTIFY="${_2CODE_HOOKS}/notify.sh"
_2CODE_CLAUDE_SETTINGS="${_2CODE_HOOKS}/claude-settings.json"

command mkdir -p "$_2CODE_BIN" "$_2CODE_HOOKS" 2>/dev/null

_2code_json_escape() {
  printf '%s' "$1" | command sed 's/\\/\\\\/g; s/"/\\"/g'
}

_2code_shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | command sed "s/'/'\\\\''/g")"
}

cat >"$_2CODE_NOTIFY" <<'NOTIFY_SH'
#!/bin/bash
[[ -z "$_2CODE_HELPER" ]] && exit 0
"$_2CODE_HELPER" notify &>/dev/null &
NOTIFY_SH
command chmod +x "$_2CODE_NOTIFY"

_2CODE_NOTIFY_COMMAND="$(_2code_json_escape "$(_2code_shell_quote "$_2CODE_NOTIFY")")"

printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"%s"}]}],"PermissionRequest":[{"matcher":"*","hooks":[{"type":"command","command":"%s"}]}]}}\n' \
	"$_2CODE_NOTIFY_COMMAND" "$_2CODE_NOTIFY_COMMAND" >"$_2CODE_CLAUDE_SETTINGS"

printf '#!/bin/bash\n_SETTINGS="%s"\n' "$_2CODE_CLAUDE_SETTINGS" >"$_2CODE_BIN/claude"
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
exec "$_REAL" \
  -c "notify=[\"$_NOTIFY\"]" \
  "$@"
CODEX_WRAPPER
command chmod +x "$_2CODE_BIN/codex"

export PATH="$_2CODE_BIN:$PATH"
