## Why

终端字体是硬编码在 `Terminal.tsx` 中的（`JetBrains Mono` + fallbacks，fontSize 13），用户无法自定义。不同用户对终端字体有强烈偏好，需要在设置页面提供字体选择能力。

## What Changes

- 在设置页面新增「终端字体」选择器，列出系统已安装的等宽（Mono）字体
- 新增「允许非等宽字体」复选框，勾选后字体列表扩展为所有系统字体
- 字体选择实时反映到所有已打开的终端实例
- 用户选择持久化，重启后保留

## Capabilities

### New Capabilities

- `font-picker`: 设置页面中的终端字体选择功能，包括字体列表获取、Mono 过滤、复选框切换、持久化存储、实时应用到 xterm 实例

### Modified Capabilities

_(none)_

## Impact

- **Frontend**: `SettingsPage.tsx` 新增字体选择 UI；`Terminal.tsx` 从硬编码字体改为读取用户设置
- **Backend**: 新增 Tauri command 获取系统字体列表（需区分 Mono / 非 Mono）
- **i18n**: 新增字体相关的翻译 key（en/zh）
- **State**: 需要持久化存储用户的字体偏好（可复用 localStorage 或扩展现有存储方案）
