// i18n for the 2code mod. Herdr has no locale API (no Intl, no navigator), so
// the sidebar asks the system once per start: $LC_ALL, $LC_MESSAGES, then $LANG
// (read with exec, in the person's real environment). A Chinese locale shows
// 简体中文; anything else, or nothing, shows English. The result is shared as
// "2code.locale" so every copy redraws when it lands.
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
    filesLoading: "Loading files…",
    filesEmpty: "No files",
    noFolder: "No folder",
    filesLimited: "File list limited to 500 entries per folder and 5,000 total",
    fileGone: "This file is no longer available",
    fileBinary: "Binary file · no text preview",
    fileUnreadable: "Cannot preview this file (binary, too large, or unreadable)",
    fileLoading: "Loading file…",
    back: "Back",
    changedFiles: "{count} changed file(s)",
    noChanges: "No changes detected",
    changesLoading: "Loading changes…",
    notGit: "Not a git repository",
    changesLimited: "Showing the first 1,000 changed files",
    selectFile: "Select a file to view its changes",
    diffUnreadable: "Cannot preview this diff (too large or unreadable)",
    binaryChanged: "Binary file changed",
    noTextDiff: "No text diff available",
    commitSection: "Commit",
    summary: "Summary",
    summaryPlaceholder: "Describe the changes you're committing",
    description: "Description",
    descriptionPlaceholder: "Add an optional extended description",
    commit: "Commit",
    committing: "Committing…",
    commitFailed: "Commit failed: {error}",
    includedCount: "{included} of {total} files included",
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
    filesLoading: "正在加载文件…",
    filesEmpty: "没有文件",
    noFolder: "没有文件夹",
    filesLimited: "文件列表上限：每个文件夹 500 项，总计 5,000 项",
    fileGone: "该文件已不存在",
    fileBinary: "二进制文件，无法预览",
    fileUnreadable: "无法预览此文件（二进制、过大或不可读）",
    fileLoading: "正在加载文件…",
    back: "返回",
    changedFiles: "{count} 个文件已变更",
    noChanges: "未检测到变更",
    changesLoading: "正在加载变更…",
    notGit: "不是 Git 仓库",
    changesLimited: "仅显示前 1,000 个变更文件",
    selectFile: "选择文件查看变更",
    diffUnreadable: "无法预览此 diff（过大或不可读）",
    binaryChanged: "二进制文件已变更",
    noTextDiff: "没有文本 diff",
    commitSection: "提交",
    summary: "摘要",
    summaryPlaceholder: "概括这次提交的内容",
    description: "描述",
    descriptionPlaceholder: "补充可选的详细说明",
    commit: "提交",
    committing: "提交中…",
    commitFailed: "提交失败：{error}",
    includedCount: "已包含 {included}/{total} 个文件",
  },
};

const LOCALES = ["en", "zh"];

export function locale() {
  const pick = shared("2code.locale");
  return LOCALES.includes(pick) ? pick : "en";
}

export function t(key, vars) {
  const text = MESSAGES[locale()][key] ?? MESSAGES.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? "")) : text;
}

const fromTag = (tag) => (/^zh/i.test(String(tag ?? "").trim()) ? "zh" : "en");

// The locale from the system's environment variables; English when unset.
export async function resolveLocale() {
  let tag = "";
  try {
    const r = window()?.platform === "windows"
      ? await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write(@($env:LC_ALL, $env:LC_MESSAGES, $env:LANG | Where-Object { $_ })[0])"])
      : await exec("sh", ["-c", 'printf %s "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}"']);
    tag = r.code === 0 ? r.stdout : "";
  } catch {}
  const lang = fromTag(tag);
  if (shared("2code.locale") !== lang) setShared("2code.locale", lang);
  return lang;
}
