# 2code common init (PowerShell)
# The hook/wrapper files are written by 2code at session start via Rust.
# This script only exports env vars and updates PATH for the running shell.
$env:_2CODE_HOME = "$HOME\.2code"
$env:_2CODE_BIN = "$env:_2CODE_HOME\bin"
$env:_2CODE_HOOKS = "$env:_2CODE_HOME\hooks"
$env:_2CODE_NOTIFY = "$env:_2CODE_HOOKS\notify.sh"
$env:_2CODE_SETTINGS = "$env:_2CODE_HOOKS\claude-settings.json"

if ($env:PATH -notlike "*$env:_2CODE_BIN*") {
    $env:PATH = "$env:_2CODE_BIN$([System.IO.Path]::PathSeparator)$env:PATH"
}
