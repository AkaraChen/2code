// File tree operations, on this computer or (`on`) another machine. Paths go to
// the shell as arguments ("$1"), never pasted into the script.
import { exec, window } from "herdr";

const sh = (script, args, on) => exec("sh", ["-c", script, "2code", ...args], { on });
const ok = (r) => { if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `exit ${r.code}`); };

export async function createFile(path, on) {
  ok(await sh('[ ! -e "$1" ] || { echo "already exists" >&2; exit 1; }; mkdir -p "$(dirname "$1")" && : > "$1"', [path], on));
}

export async function createFolder(path, on) {
  ok(await sh('[ ! -e "$1" ] || { echo "already exists" >&2; exit 1; }; mkdir -p "$1"', [path], on));
}

export async function rename(from, to, on) {
  ok(await sh('[ ! -e "$2" ] || { echo "already exists" >&2; exit 1; }; mkdir -p "$(dirname "$2")" && mv "$1" "$2"', [from, to], on));
}

// To the trash where there is one (macOS `trash`, `gio trash`), else deleted.
export async function remove(path, on) {
  if (!on && window()?.platform === "windows") {
    ok(await exec("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName Microsoft.VisualBasic; $p=$args[0]; if (Test-Path -PathType Container $p) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }", path]));
    return;
  }
  ok(await sh('if [ -x /usr/bin/trash ]; then /usr/bin/trash "$1"; elif command -v gio >/dev/null 2>&1; then gio trash "$1"; else rm -rf -- "$1"; fi', [path], on));
}

// Deletes for good: offered only after the trash refused.
export async function removePermanently(path, on) {
  if (!on && window()?.platform === "windows") {
    ok(await exec("powershell.exe", ["-NoProfile", "-Command", "Remove-Item -LiteralPath $args[0] -Recurse -Force", path]));
    return;
  }
  ok(await sh('rm -rf -- "$1"', [path], on));
}

// Opens a file with the system's default app (this computer only).
export async function openDefault(path) {
  const p = window()?.platform;
  if (p === "macos") return exec("open", [path]);
  if (p === "windows") return exec("cmd.exe", ["/c", "start", "", path]);
  return exec("xdg-open", [path]);
}

export const parentOf = (path) => path.replace(/[\\/][^\\/]*$/, "");
