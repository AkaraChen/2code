_2CODE_HOME="${HOME}/.2code"
_2CODE_BIN="${_2CODE_HOME}/bin"
_2CODE_HOOKS="${_2CODE_HOME}/hooks"
_2CODE_OPENCODE_DIR="${_2CODE_HOME}/opencode"
_2CODE_OPENCODE_PLUGINS="${_2CODE_OPENCODE_DIR}/plugins"
_2CODE_OPENCODE_SOURCE_DIR="${OPENCODE_CONFIG_DIR:-}"
_2CODE_NOTIFY="${_2CODE_HOOKS}/notify.sh"
_2CODE_STATUS_RUNNING="${_2CODE_HOOKS}/status-running.sh"
_2CODE_STATUS_WAITING="${_2CODE_HOOKS}/status-waiting.sh"
_2CODE_STATUS_IDLE="${_2CODE_HOOKS}/status-idle.sh"
_2CODE_CLAUDE_SETTINGS="${_2CODE_HOOKS}/claude-settings.json"

command mkdir -p "$_2CODE_BIN" "$_2CODE_HOOKS" "$_2CODE_OPENCODE_PLUGINS" 2>/dev/null

_2code_json_escape() {
  printf '%s' "$1" | command sed 's/\\/\\\\/g; s/"/\\"/g'
}

_2code_shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | command sed "s/'/'\\\\''/g")"
}

_2code_link_opencode_items() {
  [ -d "$1" ] || return 0
  command find "$1" -mindepth 1 -maxdepth 1 2>/dev/null | while IFS= read -r _2code_item; do
    _2code_name="${_2code_item##*/}"
    [ "$_2code_name" = "$3" ] && continue
    if [ -e "$2/$_2code_name" ] || [ -L "$2/$_2code_name" ]; then
      continue
    fi
    command ln -s "$_2code_item" "$2/$_2code_name" 2>/dev/null || true
  done
}

if [ -n "$_2CODE_OPENCODE_SOURCE_DIR" ] && [ -d "$_2CODE_OPENCODE_SOURCE_DIR" ] && [ "$_2CODE_OPENCODE_SOURCE_DIR" != "$_2CODE_OPENCODE_DIR" ]; then
  _2code_link_opencode_items "$_2CODE_OPENCODE_SOURCE_DIR" "$_2CODE_OPENCODE_DIR" "plugins"
  _2code_link_opencode_items "$_2CODE_OPENCODE_SOURCE_DIR/plugins" "$_2CODE_OPENCODE_PLUGINS" "2code-status.js"
fi

cat >"$_2CODE_NOTIFY" <<'NOTIFY_SH'
#!/bin/bash
[[ -z "$_2CODE_HELPER" ]] && exit 0
( "$_2CODE_HELPER" notify &>/dev/null || true ) &
exit 0
NOTIFY_SH

cat >"$_2CODE_STATUS_RUNNING" <<'STATUS_RUNNING_SH'
#!/bin/bash
[[ -z "$_2CODE_HELPER" ]] && exit 0
( "$_2CODE_HELPER" status running &>/dev/null || true ) &
exit 0
STATUS_RUNNING_SH

cat >"$_2CODE_STATUS_WAITING" <<'STATUS_WAITING_SH'
#!/bin/bash
[[ -z "$_2CODE_HELPER" ]] && exit 0
(
  "$_2CODE_HELPER" status waiting &>/dev/null || true
  "$_2CODE_HELPER" notify &>/dev/null || true
) &
exit 0
STATUS_WAITING_SH

cat >"$_2CODE_STATUS_IDLE" <<'STATUS_IDLE_SH'
#!/bin/bash
[[ -z "$_2CODE_HELPER" ]] && exit 0
(
  "$_2CODE_HELPER" status idle &>/dev/null || true
  "$_2CODE_HELPER" notify &>/dev/null || true
) &
exit 0
STATUS_IDLE_SH

command chmod +x "$_2CODE_NOTIFY" "$_2CODE_STATUS_RUNNING" "$_2CODE_STATUS_WAITING" "$_2CODE_STATUS_IDLE"

_2CODE_RUNNING_COMMAND="$(_2code_json_escape "$(_2code_shell_quote "$_2CODE_STATUS_RUNNING")")"
_2CODE_WAITING_COMMAND="$(_2code_json_escape "$(_2code_shell_quote "$_2CODE_STATUS_WAITING")")"
_2CODE_IDLE_COMMAND="$(_2code_json_escape "$(_2code_shell_quote "$_2CODE_STATUS_IDLE")")"

cat >"$_2CODE_CLAUDE_SETTINGS" <<CLAUDE_SETTINGS
{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"$_2CODE_RUNNING_COMMAND"}]}],"PreToolUse":[{"matcher":"AskUserQuestion|Question|question","hooks":[{"type":"command","command":"$_2CODE_WAITING_COMMAND"}]}],"PermissionRequest":[{"matcher":"*","hooks":[{"type":"command","command":"$_2CODE_WAITING_COMMAND"}]}],"PostToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"$_2CODE_RUNNING_COMMAND"}]}],"PostToolUseFailure":[{"matcher":"*","hooks":[{"type":"command","command":"$_2CODE_RUNNING_COMMAND"}]}],"PermissionDenied":[{"matcher":"*","hooks":[{"type":"command","command":"$_2CODE_RUNNING_COMMAND"}]}],"Stop":[{"hooks":[{"type":"command","command":"$_2CODE_IDLE_COMMAND"}]}],"StopFailure":[{"hooks":[{"type":"command","command":"$_2CODE_IDLE_COMMAND"}]}]}}
CLAUDE_SETTINGS

cat >"$_2CODE_OPENCODE_PLUGINS/2code-status.js" <<'OPENCODE_PLUGIN'
const QUESTION_TOOL = /AskUserQuestion|(^|__|[-_])question($|__|[-_])/i;

function runHelper(args) {
  const helper = process.env._2CODE_HELPER;
  if (!helper) return;

  try {
    const child = Bun.spawn([helper, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    });
    child.exited.catch(() => {});
  } catch {
    // Status hooks must never interfere with OpenCode.
  }
}

function setStatus(status, notify = false) {
  runHelper(["status", status]);
  if (notify) runHelper(["notify"]);
}

function isQuestionTool(tool) {
  return typeof tool === "string" && QUESTION_TOOL.test(tool);
}

export const TwoCodeStatusPlugin = async () => ({
  event: async ({ event }) => {
    switch (event.type) {
      case "tui.prompt.append":
        setStatus("running");
        break;
      case "permission.asked":
        setStatus("waiting", true);
        break;
      case "permission.replied":
        setStatus("running");
        break;
      case "session.idle":
      case "session.error":
        setStatus("idle", true);
        break;
    }
  },
  "tool.execute.before": async (input) => {
    if (isQuestionTool(input?.tool)) setStatus("waiting", true);
  },
  "tool.execute.after": async (input) => {
    if (isQuestionTool(input?.tool)) setStatus("running");
  },
});
OPENCODE_PLUGIN

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

printf '#!/bin/bash\n_RUNNING_COMMAND="%s"\n_WAITING_COMMAND="%s"\n_IDLE_COMMAND="%s"\n' \
  "$_2CODE_RUNNING_COMMAND" "$_2CODE_WAITING_COMMAND" "$_2CODE_IDLE_COMMAND" >"$_2CODE_BIN/codex"
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
  -c "hooks.UserPromptSubmit=[{hooks=[{type=\"command\",command=\"$_RUNNING_COMMAND\"}]}]" \
  -c "hooks.PreToolUse=[{matcher=\"AskUserQuestion|Question|question\",hooks=[{type=\"command\",command=\"$_WAITING_COMMAND\"}]}]" \
  -c "hooks.PermissionRequest=[{matcher=\"*\",hooks=[{type=\"command\",command=\"$_WAITING_COMMAND\"}]}]" \
  -c "hooks.PostToolUse=[{matcher=\"*\",hooks=[{type=\"command\",command=\"$_RUNNING_COMMAND\"}]}]" \
  -c "hooks.Stop=[{hooks=[{type=\"command\",command=\"$_IDLE_COMMAND\"}]}]" \
  "$@"
CODEX_WRAPPER
command chmod +x "$_2CODE_BIN/codex"

printf '#!/bin/bash\n_CONFIG_DIR="%s"\n' "$_2CODE_OPENCODE_DIR" >"$_2CODE_BIN/opencode"
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
export OPENCODE_CONFIG_DIR="$_CONFIG_DIR"
exec "$_REAL" "$@"
OPENCODE_WRAPPER
command chmod +x "$_2CODE_BIN/opencode"

export PATH="$_2CODE_BIN:$PATH"
