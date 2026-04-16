const createMessage = (name: string) => (..._args: unknown[]) => name;

export const accentColor = createMessage("accentColor");
export const addTerminalTemplate = createMessage("addTerminalTemplate");
export const agentAcpBridge = createMessage("agentAcpBridge");
export const agentApiKey = createMessage("agentApiKey");
export const agentCredentials = createMessage("agentCredentials");
export const agentCredentialsDetected = createMessage(
	"agentCredentialsDetected",
);
export const agentCredentialsNone = createMessage("agentCredentialsNone");
export const agentInstall = createMessage("agentInstall");
export const agentNativeCli = createMessage("agentNativeCli");
export const agentNativeNotInstalled = createMessage(
	"agentNativeNotInstalled",
);
export const agentNativeNotRequired = createMessage(
	"agentNativeNotRequired",
);
export const agentNotInstalled = createMessage("agentNotInstalled");
export const agentOAuth = createMessage("agentOAuth");
export const agentPartial = createMessage("agentPartial");
export const agentReady = createMessage("agentReady");
export const agentReinstall = createMessage("agentReinstall");
export const agentSummary = createMessage("agentSummary");
export const agents = createMessage("agents");
export const appearance = createMessage("appearance");
export const backToCommitList = createMessage("backToCommitList");
export const borderRadius = createMessage("borderRadius");
export const branchName = createMessage("branchName");
export const branchNamePlaceholder = createMessage("branchNamePlaceholder");
export const cancel = createMessage("cancel");
export const changedFiles = createMessage("changedFiles");
export const changes = createMessage("changes");
export const chooseFolder = createMessage("chooseFolder");
export const commandPaletteEmpty = createMessage("commandPaletteEmpty");
export const commandPaletteFooterHint = createMessage("commandPaletteFooterHint");
export const commandPaletteHint = createMessage("commandPaletteHint");
export const commandPaletteNoResults = createMessage("commandPaletteNoResults");
export const commandPaletteNoResultsHint = createMessage(
	"commandPaletteNoResultsHint",
);
export const commandPaletteOpenHint = createMessage("commandPaletteOpenHint");
export const commandPalettePlaceholder = createMessage(
	"commandPalettePlaceholder",
);
export const commandPaletteResultCount = createMessage(
	"commandPaletteResultCount",
);
export const commandPaletteRoot = createMessage("commandPaletteRoot");
export const commandPaletteTitle = createMessage("commandPaletteTitle");
export const confirmDeleteProfile = createMessage("confirmDeleteProfile");
export const confirmDeleteProject = createMessage("confirmDeleteProject");
export const create = createMessage("create");
export const createProfile = createMessage("createProfile");
export const createProject = createMessage("createProject");
export const createProjectHintFolderEmpty = createMessage(
	"createProjectHintFolderEmpty",
);
export const createProjectHintFolderNamed = createMessage(
	"createProjectHintFolderNamed",
);
export const createProjectHintTemporaryEmpty = createMessage(
	"createProjectHintTemporaryEmpty",
);
export const createProjectHintTemporaryNamed = createMessage(
	"createProjectHintTemporaryNamed",
);
export const createdAt = createMessage("createdAt");
export const debugClear = createMessage("debugClear");
export const debugLog = createMessage("debugLog");
export const debugMode = createMessage("debugMode");
export const debugModeDescription = createMessage("debugModeDescription");
export const debugNoLogs = createMessage("debugNoLogs");
export const debugSearchPlaceholder = createMessage("debugSearchPlaceholder");
export const defaultProfile = createMessage("defaultProfile");
const deleteMessage = createMessage("delete");
export { deleteMessage as delete };
export const deleteProfile = createMessage("deleteProfile");
export const deleteProject = createMessage("deleteProject");
export const deleteTerminalTemplate = createMessage("deleteTerminalTemplate");
export const editTerminalTemplate = createMessage("editTerminalTemplate");
export const emptyProjectsDesc = createMessage("emptyProjectsDesc");
export const emptyProjectsTitle = createMessage("emptyProjectsTitle");
export const fileTreeEmptyDirectory = createMessage("fileTreeEmptyDirectory");
export const fileTreeLoading = createMessage("fileTreeLoading");
export const fileTreeResizeSeparator = createMessage("fileTreeResizeSeparator");
export const fileViewerCloseFileSearch = createMessage(
	"fileViewerCloseFileSearch",
);
export const fileViewerFindInFile = createMessage("fileViewerFindInFile");
export const fileViewerNextMatch = createMessage("fileViewerNextMatch");
export const fileViewerPreviousMatch = createMessage(
	"fileViewerPreviousMatch",
);
export const folder = createMessage("folder");
export const fontSize = createMessage("fontSize");
export const general = createMessage("general");
export const gitCommitBody = createMessage("gitCommitBody");
export const gitCommitBodyPlaceholder = createMessage(
	"gitCommitBodyPlaceholder",
);
export const gitCommitButton = createMessage("gitCommitButton");
export const gitCommitErrorTitle = createMessage("gitCommitErrorTitle");
export const gitCommitIncludeAll = createMessage("gitCommitIncludeAll");
export const gitCommitIncludeNone = createMessage("gitCommitIncludeNone");
export const gitCommitIncludedCount = createMessage(
	"gitCommitIncludedCount",
);
export const gitCommitSectionTitle = createMessage("gitCommitSectionTitle");
export const gitCommitShortcutHint = createMessage("gitCommitShortcutHint");
export const gitCommitSuccessDescription = createMessage(
	"gitCommitSuccessDescription",
);
export const gitCommitSuccessTitle = createMessage("gitCommitSuccessTitle");
export const gitCommitSummary = createMessage("gitCommitSummary");
export const gitCommitSummaryPlaceholder = createMessage(
	"gitCommitSummaryPlaceholder",
);
export const gitDiffCommentButton = createMessage("gitDiffCommentButton");
export const gitDiffCommentCopiedDescription = createMessage(
	"gitDiffCommentCopiedDescription",
);
export const gitDiffCommentCopiedTitle = createMessage(
	"gitDiffCommentCopiedTitle",
);
export const gitDiffCommentCopyFailedTitle = createMessage(
	"gitDiffCommentCopyFailedTitle",
);
export const gitDiffCommentDialogConfirm = createMessage(
	"gitDiffCommentDialogConfirm",
);
export const gitDiffCommentDialogFieldLabel = createMessage(
	"gitDiffCommentDialogFieldLabel",
);
export const gitDiffCommentDialogPlaceholder = createMessage(
	"gitDiffCommentDialogPlaceholder",
);
export const gitDiffCommentDialogSelectionLabel = createMessage(
	"gitDiffCommentDialogSelectionLabel",
);
export const gitDiffCommentDialogTitle = createMessage(
	"gitDiffCommentDialogTitle",
);
export const gitDiffImagePreviewAfter = createMessage(
	"gitDiffImagePreviewAfter",
);
export const gitDiffImagePreviewBefore = createMessage(
	"gitDiffImagePreviewBefore",
);
export const gitDiffImagePreviewUnavailable = createMessage(
	"gitDiffImagePreviewUnavailable",
);
export const gitDiffLargeGuardrailDescription = createMessage(
	"gitDiffLargeGuardrailDescription",
);
export const gitDiffLargeGuardrailReveal = createMessage(
	"gitDiffLargeGuardrailReveal",
);
export const gitDiffLargeGuardrailTitle = createMessage(
	"gitDiffLargeGuardrailTitle",
);
export const gitDiffPreviewMode = createMessage("gitDiffPreviewMode");
export const gitDiffPreviewModeSplit = createMessage(
	"gitDiffPreviewModeSplit",
);
export const gitDiffPreviewModeUnified = createMessage(
	"gitDiffPreviewModeUnified",
);
export const gitPushButton = createMessage("gitPushButton");
export const gitPushErrorTitle = createMessage("gitPushErrorTitle");
export const gitPushSuccessTitle = createMessage("gitPushSuccessTitle");
export const globalTerminalTemplates = createMessage(
	"globalTerminalTemplates",
);
export const globalTerminalTemplatesDescription = createMessage(
	"globalTerminalTemplatesDescription",
);
export const history = createMessage("history");
export const home = createMessage("home");
export const initScript = createMessage("initScript");
export const initScriptDesc = createMessage("initScriptDesc");
export const language = createMessage("language");
export const newName = createMessage("newName");
export const newProject = createMessage("newProject");
export const newTerminal = createMessage("newTerminal");
export const noChangesDetected = createMessage("noChangesDetected");
export const noCommitsFound = createMessage("noCommitsFound");
export const noFileChanges = createMessage("noFileChanges");
export const noProfiles = createMessage("noProfiles");
export const noProjectsYet = createMessage("noProjectsYet");
export const noTemplatesDropdownHint = createMessage(
	"noTemplatesDropdownHint",
);
export const noTerminalTemplates = createMessage("noTerminalTemplates");
export const noTerminalsOpen = createMessage("noTerminalsOpen");
export const noTerminalsOpenDescription = createMessage(
	"noTerminalsOpenDescription",
);
export const notification = createMessage("notification");
export const notificationEnabled = createMessage("notificationEnabled");
export const notificationEnabledDescription = createMessage(
	"notificationEnabledDescription",
);
export const notificationSound = createMessage("notificationSound");
export const notificationSoundNone = createMessage("notificationSoundNone");
export const onboardingTourDesc = createMessage("onboardingTourDesc");
export const onboardingTourTitle = createMessage("onboardingTourTitle");
export const preview = createMessage("preview");
export const profile = createMessage("profile");
export const projectName = createMessage("projectName");
export const projectNamePlaceholderFolder = createMessage(
	"projectNamePlaceholderFolder",
);
export const projectNamePlaceholderTemporary = createMessage(
	"projectNamePlaceholderTemporary",
);
export const projectSettings = createMessage("projectSettings");
export const projectTerminalTemplates = createMessage(
	"projectTerminalTemplates",
);
export const projectTerminalTemplatesDescription = createMessage(
	"projectTerminalTemplatesDescription",
);
export const profiles = createMessage("profiles");
export const projects = createMessage("projects");
export const radiusLarge = createMessage("radiusLarge");
export const radiusMedium = createMessage("radiusMedium");
export const radiusNone = createMessage("radiusNone");
export const radiusSmall = createMessage("radiusSmall");
export const radiusXLarge = createMessage("radiusXLarge");
export const rename = createMessage("rename");
export const renameProject = createMessage("renameProject");
export const revealInFinder = createMessage("revealInFinder");
export const save = createMessage("save");
export const scriptPlaceholder = createMessage("scriptPlaceholder");
export const scripts = createMessage("scripts");
export const selectFileToView = createMessage("selectFileToView");
export const settings = createMessage("settings");
export const setupScript = createMessage("setupScript");
export const setupScriptDesc = createMessage("setupScriptDesc");
export const showAllFonts = createMessage("showAllFonts");
export const sideNavLabel = createMessage("sideNavLabel");
export const somethingWentWrong = createMessage("somethingWentWrong");
export const syncTerminalTheme = createMessage("syncTerminalTheme");
export const teardownScript = createMessage("teardownScript");
export const teardownScriptDesc = createMessage("teardownScriptDesc");
export const templates = createMessage("templates");
export const terminal = createMessage("terminal");
export const terminalFont = createMessage("terminalFont");
export const terminalOpenLink = createMessage("terminalOpenLink");
export const terminalOpenLinkConfirmDescription = createMessage(
	"terminalOpenLinkConfirmDescription",
);
export const terminalOpenLinkUrlLabel = createMessage(
	"terminalOpenLinkUrlLabel",
);
export const terminalTemplate = createMessage("terminalTemplate");
export const terminalTemplateCommands = createMessage(
	"terminalTemplateCommands",
);
export const terminalTemplateCommandsDescription = createMessage(
	"terminalTemplateCommandsDescription",
);
export const terminalTemplateCwd = createMessage("terminalTemplateCwd");
export const terminalTemplateCwdDescription = createMessage(
	"terminalTemplateCwdDescription",
);
export const terminalTemplateCwdPlaceholder = createMessage(
	"terminalTemplateCwdPlaceholder",
);
export const terminalTemplateName = createMessage("terminalTemplateName");
export const terminalTemplateNamePlaceholder = createMessage(
	"terminalTemplateNamePlaceholder",
);
export const terminalTemplateShell = createMessage("terminalTemplateShell");
export const terminalTemplateShellPlaceholder = createMessage(
	"terminalTemplateShellPlaceholder",
);
export const terminalTemplates = createMessage("terminalTemplates");
export const terminalTheme = createMessage("terminalTheme");
export const terminalThemeDark = createMessage("terminalThemeDark");
export const terminalThemeLight = createMessage("terminalThemeLight");
export const theme = createMessage("theme");
export const themeDark = createMessage("themeDark");
export const themeLight = createMessage("themeLight");
export const themeSystem = createMessage("themeSystem");
export const topbar = createMessage("topbar");
export const topbarAllControlsActive = createMessage(
	"topbarAllControlsActive",
);
export const topbarAvailable = createMessage("topbarAvailable");
export const topbarCursor = createMessage("topbarCursor");
export const topbarDetectingApps = createMessage("topbarDetectingApps");
export const topbarDragHint = createMessage("topbarDragHint");
export const topbarGhostty = createMessage("topbarGhostty");
export const topbarGitDiff = createMessage("topbarGitDiff");
export const topbarGithubDesktop = createMessage("topbarGithubDesktop");
export const topbarIterm2 = createMessage("topbarIterm2");
export const topbarKitty = createMessage("topbarKitty");
export const topbarNoControls = createMessage("topbarNoControls");
export const topbarPreview = createMessage("topbarPreview");
export const topbarResetDefaults = createMessage("topbarResetDefaults");
export const topbarSublimeText = createMessage("topbarSublimeText");
export const topbarVscode = createMessage("topbarVscode");
export const topbarWarp = createMessage("topbarWarp");
export const topbarWindsurf = createMessage("topbarWindsurf");
export const topbarZed = createMessage("topbarZed");
export const tryAgain = createMessage("tryAgain");
