# 移植 VS Code Shell Integration 到 2code —— 完整指南

## 一、改了什么

把 VS Code 的终端 shell integration 脚本（MIT 协议）直接搬进来，
让 bash/zsh/fish/pwsh 的补全、命令检测、CWD 追踪全部正常工作。

## 二、文件清单

### 新增文件（直接从 VS Code 仓库复制）
```
src-tauri/crates/infra/scripts/shellIntegration-bash.sh     # bash 集成
src-tauri/crates/infra/scripts/shellIntegration-rc.zsh       # zsh 主脚本
src-tauri/crates/infra/scripts/shellIntegration-env.zsh      # zsh .zshenv
src-tauri/crates/infra/scripts/shellIntegration-profile.zsh  # zsh .zprofile
src-tauri/crates/infra/scripts/shellIntegration-login.zsh    # zsh .zlogin
src-tauri/crates/infra/scripts/shellIntegration.fish         # fish 集成
src-tauri/crates/infra/scripts/shellIntegration.ps1          # pwsh 集成
```

### 修改文件
```
src-tauri/crates/infra/src/shell_init.rs  →  用 shell_init.rs.new 替换
src-tauri/crates/infra/src/pty.rs         →  用 pty.rs.new 替换
src-tauri/crates/service/src/pty.rs       →  按 PATCH-service-pty.md 改
```

## 三、核心原理

VS Code 对每种 shell 的注入方式不同：

| Shell | 注入方式 | 关键环境变量 |
|-------|---------|-------------|
| bash  | `bash --init-file /tmp/2code-init-xxx/shellIntegration-bash.sh` | `VSCODE_INJECTION=1` |
| zsh   | `ZDOTDIR=/tmp/2code-init-xxx/`（里面放 .zshrc 等） | `ZDOTDIR`, `USER_ZDOTDIR`, `VSCODE_INJECTION=1` |
| fish  | `fish --init-command 'source ".../shellIntegration.fish"'` | `TERM_PROGRAM=vscode` |
| pwsh  | `pwsh -noexit -command '. ".../shellIntegration.ps1"'` | `VSCODE_INJECTION=1` |

所有 shell 都设 `TERM_PROGRAM=vscode`，因为 VS Code 的脚本会检查这个值。

## 四、关于 TERM_PROGRAM=vscode

这是唯一"hacky"的地方。VS Code 的 fish 脚本第 20 行写死了：
```fish
and string match --quiet "$TERM_PROGRAM" "vscode"
```

**三种处理方式（选一个）：**

1. **直接设 `TERM_PROGRAM=vscode`**（当前方案）
   - 优点：零改动，脚本原样可用
   - 缺点：用户如果同时装了 VS Code 扩展检查 TERM_PROGRAM，可能冲突
   - 实际上大多数 VS Code fork（Cursor、Windsurf）都这么干

2. **设 `TERM_PROGRAM=2code`，只改 fish 脚本那一行**
   - 把 fish 脚本里 `"vscode"` 改成 `"vscode" -o "$TERM_PROGRAM" = "2code"`
   - 其他脚本的 TERM_PROGRAM 检查都是可选功能，不影响核心

3. **Fork 所有脚本，全局替换 VSCODE_ → _2CODE_**
   - 最干净，但后续跟进上游更新麻烦

**推荐方案 1 起步，后续按需切方案 2。**

## 五、验证

改完后启动 2code，开一个终端 tab，验证：
1. `echo $TERM_PROGRAM`  →  应该输出 `vscode`
2. `echo $VSCODE_SHELL_INTEGRATION`  →  应该输出 `1`
3. Tab 补全  →  打 `git ` 然后按 Tab 应该能补全子命令
4. CWD 追踪  →  `cd /tmp` 后 tab 标题应该更新

## 六、后续升级

VS Code 每月更新 shell integration 脚本。升级步骤：
```bash
cd /tmp && git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/vscode.git
cd vscode && git sparse-checkout set src/vs/workbench/contrib/terminal/common/scripts
cp src/vs/workbench/contrib/terminal/common/scripts/shellIntegration* \
   /path/to/2code/src-tauri/crates/infra/scripts/
```
