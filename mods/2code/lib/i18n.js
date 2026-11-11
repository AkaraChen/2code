// i18n for the 2code mod. Herdr has no locale API (no Intl, no navigator), so:
//   1. shared("2code.language")  — the person's pick from the sidebar toggle
//   2. shared("2code.locale")    — resolved once per start by the sidebar:
//      ~/2code/2code.json "language", else the system language
//   3. "en"
// Every copy re-renders when either shared value changes.
import { shared, setShared, exec, window } from "herdr";

const MESSAGES = {
  en: {
    projects: "Projects",
    noProjects: "No projects yet. Click + to add a folder.",
    addProject: "Add project",
    settings: "Settings",
    toggleSidebar: "Toggle sidebar",
    newProfile: "New Profile",
    deleteProfile: "Delete Profile",
    defaultProfile: "Default",
    newTerminal: "New Terminal",
    templates: "Templates",
    projectTemplates: "Project Templates",
    globalTemplates: "Global Templates",
    noTemplates: "No templates yet. Add terminal_templates to 2code.json in the project, or ~/2code/2code.json.",
    files: "Files",
    changes: "Changes",
    language: "Language",
    cancel: "Cancel",
    teardownTitle: "Delete profile {name}",
    teardownBody: "The teardown script from 2code.json runs in the worktree first, then Herdr asks before removing the worktree.",
    teardownNone: "This project has no teardown script. Herdr asks before removing the worktree.",
    runTeardown: "Run teardown and continue",
    skipTeardown: "Skip teardown",
    continue: "Continue",
    tearingDown: "Running teardown…",
    teardownFailed: "Teardown failed: {error}",
    continueAnyway: "Remove anyway",
    setupTab: "setup",
    configError: "2code.json is not valid JSON: {error}",
  },
  zh: {
    projects: "项目",
    noProjects: "暂无项目，点击 + 添加文件夹。",
    addProject: "添加项目",
    settings: "设置",
    toggleSidebar: "折叠侧栏",
    newProfile: "新建配置",
    deleteProfile: "删除配置",
    defaultProfile: "默认",
    newTerminal: "新建终端",
    templates: "模板",
    projectTemplates: "项目模板",
    globalTemplates: "全局模板",
    noTemplates: "还没有模板。可在项目的 2code.json 或 ~/2code/2code.json 中添加 terminal_templates。",
    files: "文件",
    changes: "变更",
    language: "语言",
    cancel: "取消",
    teardownTitle: "删除配置 {name}",
    teardownBody: "会先在该 worktree 中运行 2code.json 的清理脚本，然后由 Herdr 确认后移除 worktree。",
    teardownNone: "该项目没有清理脚本，将直接由 Herdr 确认后移除 worktree。",
    runTeardown: "运行清理脚本并继续",
    skipTeardown: "跳过清理脚本",
    continue: "继续",
    tearingDown: "正在运行清理脚本…",
    teardownFailed: "清理脚本失败：{error}",
    continueAnyway: "仍然移除",
    setupTab: "安装",
    configError: "2code.json 不是有效的 JSON：{error}",
  },
};

export const LOCALES = ["en", "zh"];

export function locale() {
  const pick = shared("2code.language") ?? shared("2code.locale");
  return LOCALES.includes(pick) ? pick : "en";
}

export function t(key, vars) {
  const text = MESSAGES[locale()][key] ?? MESSAGES.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? "")) : text;
}

export function setLanguage(lang) {
  setShared("2code.language", LOCALES.includes(lang) ? lang : null);
}

const normalize = (tag) => (/^zh/i.test(String(tag ?? "").trim()) ? "zh" : "en");

// The system's UI language, asked of the OS once per start.
export async function systemLocale() {
  const platform = window()?.platform;
  try {
    if (platform === "macos") {
      const r = await exec("defaults", ["read", "-g", "AppleLanguages"]);
      return normalize(r.stdout.match(/"?([A-Za-z-]+)"?/g)?.find((s) => /[a-z]{2}/i.test(s))?.replace(/"/g, ""));
    }
    if (platform === "windows") {
      const r = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write((Get-UICulture).Name)"]);
      return normalize(r.stdout);
    }
    const r = await exec("sh", ["-c", 'printf %s "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}"']);
    return normalize(r.stdout);
  } catch {
    return "en";
  }
}

// Resolves the start-up locale from the global config, else the system.
export async function resolveLocale(configLanguage) {
  const lang = LOCALES.includes(configLanguage) ? configLanguage : await systemLocale();
  if (shared("2code.locale") !== lang) setShared("2code.locale", lang);
  return lang;
}
