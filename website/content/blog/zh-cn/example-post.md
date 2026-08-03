---
title: 示例文章：博客能渲染的全部元素
description: 仓库里保留的一篇草稿，用来检查所有 Markdown 元素的渲染效果，不会发布到线上。
date: 2026-07-31
slug: example-post
tags: [meta, 示例]
draft: true
---

这不是一篇真正的文章。它一直保持 `draft: true`，不会进入生产构建；留着是为了让改
博客模板的人能一次看到所有元素的样子：`bun run dev` 之后打开
`/zh-cn/blog/example-post`。

等有了真正的文章，就可以删掉它。

## 标题与正文

正文使用站点的阅读宽度。行内元素：`行内代码`、[站内链接](/zh-cn/blog)、
[站外链接](https://github.com/AkaraChen/2code)、**加粗**、*斜体*，以及
<kbd>⌘</kbd> 键帽。

### 三级标题

> 引用块，用来把一句话从正文里拎出来。

## 列表

- 一个无序列表项
- 另一项，写得足够长，好让它在窄屏下折行，这样能看清悬挂缩进的效果
  - 一个嵌套项

1. 第一
2. 第二
3. 第三

## 代码

```bash
brew install --cask akarachen/tap/2code
```

```typescript
export function readingMinutes(text: string): number {
  const characters = text.match(/[一-鿿]/g) ?? []
  return Math.max(1, Math.round(characters.length / 350))
}
```

```rust
fn main() {
    println!("2code");
}
```

## 表格

| 页面 | 路径 | 作用 |
| --- | --- | --- |
| 列表 | `/zh-cn/blog` | 已发布文章，按时间倒序 |
| 详情 | `/zh-cn/blog/<slug>` | 单篇文章 |
| 订阅 | `/zh-cn/blog/feed.xml` | RSS 2.0 |

## 脚注

worktree 是这里的隔离单位。[^worktree]

[^worktree]: 每个 profile 有自己的 `git worktree`，一条任务线里的终端不会碰到另一条
任务线的工作区。

---

以上就是文章样式覆盖的全部元素。
