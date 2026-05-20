# 2code common init (fish)
# The hook/wrapper files are written by 2code at session start via Rust.
# This script only exports env vars and updates PATH for the running shell.
set -gx _2CODE_HOME "$HOME/.2code"
set -gx _2CODE_BIN "$_2CODE_HOME/bin"
set -gx _2CODE_HOOKS "$_2CODE_HOME/hooks"
set -gx _2CODE_NOTIFY "$_2CODE_HOOKS/notify.sh"
set -gx _2CODE_SETTINGS "$_2CODE_HOOKS/claude-settings.json"

fish_add_path -gP $_2CODE_BIN
