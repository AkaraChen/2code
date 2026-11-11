export const defaultLocale = 'en' as const

export const supportedLocales = ['en', 'zh-cn'] as const

export type AppLocale = (typeof supportedLocales)[number]

/*
  Body strings may carry two inline marks, rendered by `RichText` on the page and
  passed through verbatim to the Markdown alternates: **emphasis** (set brighter,
  not heavier) and `code`.
*/
export const resources = {
  en: {
      metadata: {
        title: '2code | A Herdr layout for projects, worktrees, and agents',
        description:
          '2code is a workstation layout for Herdr: projects with their git worktrees, setup and teardown scripts, terminal templates, file editing, git review, and agent status.',
        // Keyword set informed by nearby products (Orca / Superset-style agentic coding SEO)
        // without stuffing competitor brand names into visible page copy.
        keywords: [
          '2code',
          'terminal workstation',
          'terminal multiplexer',
          'agentic IDE',
          'harness',
          'agent',
          'AI coding terminal',
          'vibe coding',
          'git worktree',
          'coding agents',
          'Claude Code',
          'Codex',
          'persistent terminal',
          'Herdr',
          'Herdr layout',
          'git review',
          'AI-assisted development',
        ],
        faviconAlt: '2code favicon',
      },
      nav: {
        home: '2code home',
        primary: 'Primary',
        features: 'Features',
        faq: 'FAQ',
        blog: 'Blog',
        github: 'GitHub',
        theme: 'Switch between light and dark',
        forHerdr: 'for Herdr',
      },
      blog: {
        metadataTitle: '2code Blog | Terminals, worktrees, and coding agents',
        metadataDescription:
          'Notes from building 2code — terminal workflows, git worktrees, and running AI coding agents on a real desktop.',
        kicker: 'Blog',
        title: 'Notes from the terminal.',
        lede:
          'Working notes on terminal workflows, git worktrees, and running coding agents locally.',
        indexLink: 'All posts',
        backToList: '← All posts',
        // {minutes} is substituted at render time.
        readingTime: '{minutes} min read',
        draftBadge: 'Draft',
        // {date} is substituted at render time.
        scheduledBadge: 'Scheduled for {date}',
        tagsLabel: 'Tags',
        feed: 'RSS',
        emptyTitle: 'Nothing published yet.',
        emptyBody:
          'The first posts are being written. Until then, the README and release notes on GitHub are the most current source.',
        emptyCta: 'Read the source on GitHub',
      },
      hero: {
        eyebrow: 'A layout for Herdr',
        eyebrowTags: ['open source', 'beta'],
        // Line one quotes herdr.dev and is set in gray; line two is 2code's answer.
        titleLineOne: 'No two Herdrs look alike.',
        titleLineTwo: 'This one is organized.',
        lede:
          'Herdr grows however you ask it to. **2code gives it a shape**: projects hold their worktrees, worktrees hold their terminals, and every agent shows whether it needs you.',
        primaryCta: 'Get 2code for Herdr',
        secondaryCta: 'Explore features',
        shotAlt: '2code in Herdr: projects with their worktrees, a file tree, and an agent at work in its tab',
      },
      chapters: {
        railLabel: 'On this page',
        railProject: 'Projects',
        legend: {
          working: 'Reading',
          done: 'Read',
          idle: 'Not yet',
        },
        items: {
          worktrees: {
            nav: 'Worktrees',
            title: 'Keep each task in its own lane',
            body:
              'Every git worktree of a project sits in the sidebar **with its own terminals**. **+** on a project creates one and runs your `setup_script`; deleting one warns about unpushed work, runs `teardown_script` and keeps the branch.',
            figure:
              'The 2code sidebar: a project with four worktrees, and the setup script running for the newest one.',
          },
          status: {
            nav: 'See who needs you',
            title: 'See who needs you',
            body:
              "Agents that report their status light up their tab and their worktree: **a pulsing dot while they work, yellow when they need you, green when they finish**, with Herdr's sound and alert. Stop checking every terminal.",
            figure:
              'Terminal tabs with agent status dots: one agent waiting for an answer, one working, one done.',
          },
          review: {
            nav: 'Review in place',
            title: 'Review what changed, then hand it back',
            body:
              'Files open as tabs beside the terminals. The diff shows **Changes and History**, unified or split. Click a line, or two to make a range, and leave a comment; **2code collects them per repo and copies them for the agent in one go**.',
            figure:
              'The 2code diff view with a review comment on a range of added lines.',
          },
          templates: {
            nav: 'Scripts & templates',
            title: 'Scripts and templates, in one file',
            body:
              "A project's `2code.json` holds the scripts its worktrees run and the **terminal templates** you start every day: Claude, a dev server, the script you always forget. Global ones live in `~/2code/2code.json`.",
            figure:
              'A project 2code.json with setup and teardown scripts and two terminal templates, next to the New Terminal menu that lists them.',
          },
        },
      },
      // Labels inside the drawn app windows, worded like the app's own UI.
      mock: {
        projects: 'Projects',
        newTerminal: 'New Terminal',
        needsYou: 'Needs you',
        changes: 'Changes',
        history: 'History',
        review: 'Review (1)',
        unified: 'Unified',
        split: 'Split',
        changedFiles: '2 changed files',
        addComment: 'Add comment',
        comment: 'Extract this into a Badge component',
        projectSettings: 'Project settings',
        globalTemplates: 'Global',
        agentTask: 'Add a loading state to the login form and cover it with a test',
        setupDone: 'setup finished, opening claude…',
      },
      install: {
        herdrTitle: 'Install Herdr',
        herdrBody: 'macOS on Apple silicon, Linux and Windows.',
        herdrCta: 'Download Herdr',
        layoutTitle: 'Add the 2code layout',
        promptComment: '# ask the agent in any Herdr terminal',
        // {keys} and {macKey} become keycaps.
        switchHint:
          "Switch layouts with {keys} ({macKey} on macOS). Herdr's own layout stays one key away.",
        copy: 'Copy',
        copied: 'Copied',
      },
      footer: {
        tagline: 'A Herdr layout for vibe coding.',
        openSource: 'Open source.',
        product: 'Product',
        learn: 'Learn',
        project: 'Project',
        releases: 'Legacy desktop app',
        languageLabel: 'Language',
        english: 'English',
        chinese: '简体中文',
        install: 'Install',
        gettingStarted: 'Getting started',
      },
      agent: {
        htmlLead: 'For AI agents: a documentation index is available at',
        htmlMarkdown:
          'Markdown versions are available at the same URL with a .md suffix, or by sending Accept: text/markdown.',
      },
      pages: {
        features: {
          metadataTitle:
            '2code Features | Worktrees, agent status, and git review',
          metadataDescription:
            'What 2code adds to Herdr: worktrees with setup scripts, agent status per task, git review with comments for agents, and terminal templates.',
        },
        faq: {
          metadataTitle: '2code FAQ | Terminal workstation questions',
          metadataDescription:
            'Answers about who 2code is for, platforms, agents, templates, and session restore.',
        },
        install: {
          metadataTitle: 'Install 2code | A layout for Herdr',
          metadataDescription:
            'Install Herdr, then add the 2code layout: ask the agent in any Herdr terminal, or clone the repo and run its install script.',
          title: 'Install 2code',
          lede: '2code runs inside Herdr, which hosts the terminals and agents. Install Herdr first, then add the 2code layout.',
          herdrHeading: '1. Install Herdr',
          herdrBody: 'Herdr runs on macOS (Apple silicon), Linux and Windows.',
          herdrCta: 'Download Herdr',
          layoutHeading: '2. Add the 2code layout',
          layoutBody: 'Ask the agent in any Herdr terminal:',
          scriptHeading: 'Or from a clone of the repo',
          switchBody: 'Switch layouts with ctrl-shift-l (cmd-shift-l on macOS).',
          legacyNote: 'The original 2code desktop app (Tauri) is no longer developed; its last builds stay on GitHub Releases.',
        },
        gettingStarted: {
          metadataTitle: 'Getting started with 2code',
          metadataDescription:
            'Who 2code is for, how to install it, and what to expect on each platform.',
          title: 'Getting started',
          lede: '2code is a Herdr layout for projects, worktrees, and AI coding agents.',
        },
      },
      faq: {
        kicker: 'FAQ',
        heading: 'Questions',
        title: 'What 2code adds to a normal terminal.',
        items: {
          audience: {
            question: 'Who is 2code for right now?',
            answer:
              'Developers who live in terminals, work across multiple projects or worktrees, and want agent runs, dev servers, git review, and quick edits in one place.',
          },
          terminal: {
            question: 'Is 2code a real terminal emulator?',
            answer:
              'The terminals are Herdr\'s: real terminals, hosted by herdr-core so they keep running when the window closes. 2code adds project and worktree management, templates, files and git review around them.',
          },
          agents: {
            question: 'How does it help with AI agents?',
            answer:
              'Agents that report their status show a pulsing dot while they work, a yellow one when they need you and a green one when they finish, with Herdr\'s sound and alert. You do not have to keep staring at every terminal pane.',
          },
          templates: {
            question: 'What are command templates for?',
            answer:
              'Templates let you quickly open command-line apps and recurring project commands, such as Claude, a dev server, or a custom script you launch all the time.',
          },
          restore: {
            question: 'What happens after restarting 2code?',
            answer:
              'Herdr keeps terminals running in herdr-core, so closing or restarting the window loses nothing; 2code keeps your project list and open files with them.',
          },
          production: {
            question: 'Is 2code production-ready today?',
            answer:
              'It is young. 2code moved from its own desktop app to a Herdr layout, and Herdr itself is in beta; expect changes.',
          },
          platforms: {
            question: 'What platforms does it support?',
            answer:
              'Wherever Herdr runs: macOS on Apple silicon, Linux and Windows. 2code is tested most on macOS and Linux.',
          },
        },
        cta: 'Add 2code to Herdr and see how it fits your terminal workflow.',
      },
  },
  'zh-cn': {
      metadata: {
        title: '2code | 管项目、Worktree 和 Agent 的 Herdr 布局',
        description:
          '2code 是 Herdr 的一个工作站布局：项目和 git worktree、安装与清理脚本、终端模板、文件编辑、Git review 和 Agent 状态。',
        keywords: [
          '2code',
          '终端工作站',
          'terminal multiplexer',
          'Agentic IDE',
          'harness',
          'agent',
          'AI 编程终端',
          'vibe coding',
          'git worktree',
          'coding agent',
          'Claude Code',
          'Codex',
          '持久终端',
          'Herdr',
          'Herdr 布局',
          'Git review',
          'AI 辅助开发',
        ],
        faviconAlt: '2code 网站图标',
      },
      nav: {
        home: '2code 首页',
        primary: '主导航',
        features: '亮点',
        faq: 'FAQ',
        blog: '博客',
        github: 'GitHub',
        theme: '切换浅色 / 深色',
        forHerdr: 'for Herdr',
      },
      blog: {
        metadataTitle: '2code 博客 | 终端、Worktree 与编程 Agent',
        metadataDescription:
          '2code 的开发笔记：终端工作流、git worktree，以及在桌面上真正跑起来的 AI 编程 Agent。',
        kicker: '博客',
        title: '来自终端的笔记。',
        lede: '关于终端工作流、git worktree，以及本地跑编程 Agent 的一些记录。',
        indexLink: '全部文章',
        backToList: '← 全部文章',
        readingTime: '约 {minutes} 分钟',
        draftBadge: '草稿',
        scheduledBadge: '{date} 发布',
        tagsLabel: '标签',
        feed: 'RSS',
        emptyTitle: '还没有发布文章。',
        emptyBody:
          '第一批文章正在写。在那之前，GitHub 上的 README 和 release notes 是最新的信息来源。',
        emptyCta: '去 GitHub 看源码',
      },
      hero: {
        eyebrow: 'Herdr 布局',
        eyebrowTags: ['开源', 'beta'],
        titleLineOne: '每个 Herdr 都不一样，',
        titleLineTwo: '这一个井井有条。',
        lede:
          'Herdr 随你怎么说就怎么长，**2code 给它定个形**：项目下是 worktree，worktree 里是终端，每个 Agent 都标着是不是在等你。',
        primaryCta: '在 Herdr 中使用 2code',
        secondaryCta: '查看亮点',
        shotAlt: 'Herdr 里的 2code：项目和 worktree、文件树，以及正在 tab 里干活的 Agent',
      },
      chapters: {
        railLabel: '本页目录',
        railProject: '项目',
        legend: {
          working: '在读',
          done: '已读',
          idle: '未读',
        },
        items: {
          worktrees: {
            nav: 'Worktree',
            title: '每个任务一条线',
            body:
              '项目的每个 git worktree 都会出现在侧栏里，**有自己的终端**。在项目上点 **+** 新建一个，会自动跑你的 `setup_script`；删除时会提醒还没推送的改动，跑 `teardown_script`，分支保留。',
            figure:
              '2code 侧栏：一个项目下有四个 worktree，最新的那个正在跑安装脚本。',
          },
          status: {
            nav: '谁在等你',
            title: '一眼看出谁在等你',
            body:
              '会上报状态的 Agent 会点亮它的 tab 和 worktree：**运行中是跳动的点，需要你时变黄，完成后变绿**，同时有 Herdr 的声音和提醒。不用再挨个盯终端。',
            figure:
              '带 Agent 状态点的终端 tab：一个在等你回答，一个在运行，一个已完成。',
          },
          review: {
            nav: '原地 review',
            title: '看完改动，再交回给 Agent',
            body:
              '文件在终端旁边以 tab 打开。diff 里能看**变更和历史**，统一或分栏都行。点一行（或点两行选一段）写评论，**2code 按仓库收集起来，一次复制给 Agent**。',
            figure: '2code 的 diff 视图，一段新增代码上挂着一条评审意见。',
          },
          templates: {
            nav: '脚本与模板',
            title: '脚本和模板，一个文件搞定',
            body:
              '项目里的 `2code.json` 存着 worktree 要跑的脚本，以及你每天都要开的**终端模板**：Claude、dev server、那个总记不住的脚本。全局模板放在 `~/2code/2code.json`。',
            figure:
              '一个项目的 2code.json，含安装、清理脚本和两个终端模板；旁边是列出这些模板的「新建终端」菜单。',
          },
        },
      },
      mock: {
        projects: '项目',
        newTerminal: '新建终端',
        needsYou: '需要你',
        changes: '变更',
        history: '历史',
        review: '评审 (1)',
        unified: '统一',
        split: '分栏',
        changedFiles: '2 个文件已变更',
        addComment: '添加评论',
        comment: '把这段抽成一个 Badge 组件',
        projectSettings: '项目设置',
        globalTemplates: '全局模板',
        agentTask: '给登录表单加上 loading 状态，并补一个测试',
        setupDone: '安装完成，正在打开 claude…',
      },
      install: {
        herdrTitle: '安装 Herdr',
        herdrBody: '支持 Apple 芯片的 macOS、Linux 和 Windows。',
        herdrCta: '下载 Herdr',
        layoutTitle: '添加 2code 布局',
        promptComment: '# 在任意 Herdr 终端里对 Agent 说',
        switchHint:
          '用 {keys}（macOS 上是 {macKey}）切换布局，Herdr 自带的布局随时能切回去。',
        copy: '复制',
        copied: '已复制',
      },
      footer: {
        tagline: '为 vibe coding 而生的 Herdr 布局。',
        openSource: '开源。',
        product: '产品',
        learn: '了解',
        project: '项目',
        releases: '旧版桌面应用',
        languageLabel: '语言',
        english: 'English',
        chinese: '简体中文',
        install: '安装',
        gettingStarted: '快速开始',
      },
      agent: {
        htmlLead: '给 AI agent：文档索引在',
        htmlMarkdown:
          '这些页面的 Markdown 版本可通过同路径加 .md 后缀获取，或发送 Accept: text/markdown。',
      },
      pages: {
        features: {
          metadataTitle: '2code 亮点 | Worktree、Agent 状态与 Git review',
          metadataDescription:
            '2code 给 Herdr 加了什么：带安装脚本的 worktree、按任务显示的 Agent 状态、能给 Agent 写评论的 Git review，以及终端模板。',
        },
        faq: {
          metadataTitle: '2code FAQ | 终端工作站常见问题',
          metadataDescription:
            '关于适用人群、平台、Agent、命令模板和会话恢复的说明。',
        },
        install: {
          metadataTitle: '安装 2code | Herdr 布局',
          metadataDescription:
            '先安装 Herdr，再添加 2code 布局：在任意 Herdr 终端里让 Agent 帮你装，或者克隆仓库运行安装脚本。',
          title: '安装 2code',
          lede: '2code 运行在 Herdr 里，终端和 Agent 由 Herdr 托管。先装 Herdr，再添加 2code 布局。',
          herdrHeading: '1. 安装 Herdr',
          herdrBody: 'Herdr 支持 macOS（Apple 芯片）、Linux 和 Windows。',
          herdrCta: '下载 Herdr',
          layoutHeading: '2. 添加 2code 布局',
          layoutBody: '在任意 Herdr 终端里对 Agent 说：',
          scriptHeading: '或者从克隆的仓库安装',
          switchBody: '用 ctrl-shift-l（macOS 上是 cmd-shift-l）切换布局。',
          legacyNote: '原来的 2code 桌面应用（Tauri）已停止开发，最后的版本仍保留在 GitHub Releases。',
        },
        gettingStarted: {
          metadataTitle: '开始使用 2code',
          metadataDescription:
            '2code 适合谁、怎么安装，以及各平台目前能期待什么。',
          title: '快速开始',
          lede: '2code 是面向项目、worktree 和 AI coding agent 的 Herdr 布局。',
        },
      },
      faq: {
        kicker: 'FAQ',
        heading: '常见问题',
        title: '它不只是又一个终端。',
        items: {
          audience: {
            question: '2code 现在适合谁？',
            answer:
              '适合重度使用终端的开发者，尤其是经常同时开多个项目、多个 worktree、多个 Agent 或 dev server 的人。',
          },
          terminal: {
            question: '2code 是真正的终端模拟器吗？',
            answer:
              '终端由 Herdr 提供：真正的终端，托管在 herdr-core 里，关掉窗口也照样运行。2code 在此之上加了项目和 worktree 管理、模板、文件和 Git review。',
          },
          agents: {
            question: '它怎么帮我看 Agent 有没有跑完？',
            answer:
              '会上报状态的 Agent，运行中显示跳动的点，需要你时变黄，完成后变绿，并配合 Herdr 的声音和提醒。你不用一直盯着每个终端窗口。',
          },
          templates: {
            question: '命令模板是干什么的？',
            answer:
              '模板用来快速打开常用命令行应用和项目命令，比如 Claude、Dev Server，或者你每天都会启动的自定义脚本。',
          },
          restore: {
            question: '重启能恢复什么？',
            answer:
              '终端一直运行在 herdr-core 里，关掉或重启窗口都不会丢；2code 的项目列表和打开的文件也会一起保留。',
          },
          production: {
            question: '现在可以作为主力工具使用吗？',
            answer:
              '还比较新。2code 从独立桌面应用迁到了 Herdr 布局，而 Herdr 本身也还在 beta，后续会有变化。',
          },
          platforms: {
            question: '支持哪些平台？',
            answer:
              'Herdr 能跑的地方都能用：Apple 芯片的 macOS、Linux 和 Windows。目前在 macOS 和 Linux 上测试得最多。',
          },
        },
        cta: '把 2code 装进 Herdr，看看它是否适合你的终端工作流。',
      },
  },
} as const

export const CHAPTER_IDS = ['worktrees', 'status', 'review', 'templates'] as const

export type ChapterId = (typeof CHAPTER_IDS)[number]

export const FAQ_IDS = [
  'audience',
  'terminal',
  'agents',
  'templates',
  'restore',
  'platforms',
  'production',
] as const

export type Messages = (typeof resources)[AppLocale]

export function detectPreferredLocale(
  language: string | readonly string[] | null | undefined,
): AppLocale {
  const candidate = Array.isArray(language) ? language[0] : language

  if (!candidate) {
    return defaultLocale
  }

  return candidate.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en'
}

export function getMessages(locale: AppLocale) {
  return resources[locale]
}
