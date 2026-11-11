import { exec, window, appHome } from "herdr";
import * as fs from "fs/promises";
import { git } from "./git.js";

const platform = () => window()?.platform ?? "linux";

// Shows a folder in Finder / Explorer / the desktop's file manager (this computer only).
export async function reveal(path) {
  const p = platform();
  if (p === "macos") return exec("open", [path]);
  if (p === "windows") return exec("explorer.exe", [path.replace(/\//g, "\\")]);
  return exec("xdg-open", [path]);
}

// Opens a folder in an app: macOS by app name (`open -a`), elsewhere by command.
export async function openWith(app, path) {
  if (platform() === "macos" && app.mac) return exec("open", ["-a", app.mac, path]);
  return exec(app.cmd, [path]);
}

// The GitHub owner of a checkout's origin, or null.
export async function githubOwner(path, on) {
  const r = await git(path, ["remote", "get-url", "origin"], on);
  const m = r.ok && /github\.com[:/]+([^/]+)\//i.exec(r.out);
  return m ? m[1] : null;
}

// A GitHub avatar, downloaded once into the mod's hidden cache (Herdr draws
// images only from its own folder, and hidden files don't reload the mod).
// Resolves with the path for image(), or null.
export async function githubAvatar(owner) {
  if (!owner || !/^[A-Za-z0-9-]+$/.test(owner)) return null;
  const dir = `${appHome()}/mods/2code/.cache/avatars`;
  const rel = `mods/2code/.cache/avatars/${owner.toLowerCase()}.png`, abs = `${appHome()}/${rel}`;
  if (await fs.exists(abs).catch(() => false)) return rel;
  try {
    // fetch() only reads text, so the picture comes down with curl (also on Windows 10+).
    await fs.mkdir(dir, { recursive: true }).catch(() => {});
    const r = await exec("curl", ["-fsSL", "--max-time", "15", "-o", abs, `https://avatars.githubusercontent.com/${owner}?s=64&v=4`]);
    return r.code === 0 ? rel : null;
  } catch {
    return null;
  }
}
