// 2code.json: per project at the main checkout's root (worktrees use their
// project's), and global at ~/2code/2code.json.
//   setup_script / teardown_script: string[]  (each line runs with `sh -c`, in order,
//                                               stopping at the first failure)
//   init_script: string[]                      (typed into every terminal 2code opens)
//   terminal_templates: { name, cwd?, commands: string[] }[]
import { readTextFile, home } from "herdr";

const lines = (v) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);

function normalize(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    setup_script: lines(c.setup_script),
    teardown_script: lines(c.teardown_script),
    init_script: lines(c.init_script),
    terminal_templates: (Array.isArray(c.terminal_templates) ? c.terminal_templates : [])
      .filter((x) => x && typeof x.name === "string" && x.name.trim())
      .map((x, i) => ({ id: x.id || `${i}:${x.name}`, name: x.name.trim(), cwd: typeof x.cwd === "string" ? x.cwd.trim() : "", commands: lines(x.commands) })),
  };
}

async function read(path, on) {
  const text = await readTextFile(path, { on }).catch(() => null);
  if (text === null) return { ...normalize(null), path, missing: true };
  try {
    return { ...normalize(JSON.parse(text)), path };
  } catch (e) {
    return { ...normalize(null), path, error: String(e?.message ?? e) };
  }
}

export const globalConfigPath = () => `${home()}/2code/2code.json`;
export const readGlobalConfig = () => read(globalConfigPath(), null);
export const readProjectConfig = (top, on) => (top ? read(`${top}/2code.json`, on) : Promise.resolve({ ...normalize(null), missing: true }));

// A POSIX-quoted word for sh.
export const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// What a setup tab runs: every line, in order, stopping at the first failure,
// like 2code's own runner (each line its own `sh -c`).
export function scriptArgv(script) {
  return ["sh", "-c", script.map((l) => `sh -c ${quote(l)}`).join(" && ")];
}
