## Context

设置页面目前只有语言和主题两个选项。终端字体硬编码在 `Terminal.tsx`（`JetBrains Mono` + fallbacks, fontSize 13）。用户无法修改。

需要新增字体选择功能：从系统字体列表中选择终端字体，默认仅显示等宽字体，可通过复选框解锁全部字体。

## Goals / Non-Goals

**Goals:**

- 用户可在设置页面选择终端字体
- 默认只列出系统等宽（Mono）字体
- 提供复选框切换是否显示非等宽字体
- 字体选择持久化，重启后保留
- 更改字体后实时应用到所有已打开的终端

**Non-Goals:**

- 不支持自定义字号（本次不做）
- 不支持自定义终端颜色主题
- 不支持上传/安装字体

## Decisions

### 1. 系统字体获取：Rust Tauri command + `font-kit` crate

在 Rust 端使用 `font-kit` crate 枚举系统字体。`font-kit` 是成熟的跨平台字体库，能获取字体族名和属性（包括是否等宽）。

前端通过 `invoke("list_system_fonts")` 调用，返回结构：

```ts
interface SystemFont {
  family: string;
  is_mono: boolean;
}
```

去重后按 `family` 排序返回。

**备选方案**：纯前端通过 `document.fonts` API 获取——但该 API 无法判断是否等宽，且不能枚举未加载的系统字体。

### 2. 状态管理：localStorage + Zustand

新建 `src/stores/fontStore.ts`，使用 Zustand + `persist` middleware 存入 localStorage。

```ts
interface FontStore {
  fontFamily: string;     // 用户选择的字体，默认 "JetBrains Mono"
  showAllFonts: boolean;  // 是否显示非等宽字体，默认 false
}
```

Terminal 组件从 store 读取 `fontFamily`，替代硬编码值。

**为什么不用 Rust 端持久化**：字体偏好是纯 UI 设置，无需后端存储。localStorage 与现有 theme 持久化方式（next-themes 也用 localStorage）保持一致。

### 3. 实时应用：xterm.js `options.fontFamily` 响应式更新

Terminal 组件已有通过 `useEffect` 响应主题变化的模式（L78-82）。字体变化用同样的方式：

```ts
useEffect(() => {
  if (termRef.current) {
    termRef.current.options.fontFamily = fontFamily;
    fitAddonRef.current?.fit(); // 字体变化可能影响字符宽度
  }
}, [fontFamily]);
```

### 4. UI 布局：在现有设置页追加字体区域

在 SettingsPage 的 `<Stack>` 中追加：

- 一个 `<Field>` 包含 `<NativeSelect>` 字体下拉列表
- 一个 `<Checkbox>` 控制是否显示非等宽字体

字体列表默认按 `is_mono` 过滤，勾选复选框后显示全部。当勾选状态改变时，如果当前选中的字体不在新列表中则不自动切换（因为字体已被应用）。

## Risks / Trade-offs

- **字体列表可能很长**：系统可能安装了数百字体。→ 使用 `<NativeSelect>` 原生下拉，由系统处理滚动性能，无需虚拟化。
- **`font-kit` 增加二进制体积**：约增加几百 KB。→ 可接受，`font-kit` 是轻量 crate。
- **等宽判断不完全准确**：`font-kit` 通过字体属性判断是否等宽，少数字体可能被误分类。→ 可接受，用户可通过复选框查看全部字体。
- **JetBrains Mono 未安装时的默认值**：如果用户系统未安装 JetBrains Mono，默认值仍然有效——xterm 会 fallback 到 monospace。→ 初始默认值保留 fallback 链 `"JetBrains Mono", monospace`。
