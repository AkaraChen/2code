export const defaultLocale = 'en' as const

export const supportedLocales = ['en', 'zh-cn'] as const

export type AppLocale = (typeof supportedLocales)[number]

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
      announcement: {
        regionLabel: 'Announcement',
        badge: 'New',
        copy: 'aghub is out, the smoothest agent manager in the world.',
        dismiss: 'Dismiss announcement',
      },
      nav: {
        home: '2code home',
        primary: 'Primary',
        features: 'Features',
        faq: 'FAQ',
        blog: 'Blog',
        github: 'GitHub',
        theme: 'Switch between light and dark',
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
        kicker: 'Your next Agentic IDE',
        titleLineOne: 'Your agents need',
        titleLineTwo: 'a better terminal.',
        titleHighlight: 'better',
        sticker: 'for vibe coding',
        lede:
          'Normal terminals run commands. 2code also manages projects, worktrees, and agents.',
        supporting:
          'If you bounce between agents, dev servers, and multiple worktrees every day, add 2code to Herdr and keep them in one window.',
        primaryCta: 'Get 2code for Herdr',
        secondaryCta: 'Explore features',
        shotAlt: '2code in Herdr: projects with their worktrees, a file tree, and an agent at work in its tab',
      },
      footer: {
        tagline: 'A Herdr layout for vibe coding.',
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
            '2code Features | Persistent terminals, git, and worktrees',
          metadataDescription:
            'What 2code adds to a normal terminal: persistent sessions, in-app git review, and isolated worktree windows.',
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
      features: {
        items: {
          terminals: {
            eyebrow: 'Persistent terminals',
            title: 'Return to the terminal you left behind.',
            copy:
              '2code keeps terminal sessions, layouts, and history around after restarts. Reopen the app and get back to the same working state instead of rebuilding your setup.',
            points: [
              'Restore terminal history and workspace layout after restart.',
              'Keep long-running sessions tied to the project they belong to.',
              'Return to work without reopening every command by hand.',
            ],
            imageAlt: '2code persistent terminal tabs view',
          },
          git: {
            eyebrow: 'Built-in tools',
            title: 'Edit files and review changes in place.',
            copy:
              'A file tree and lightweight editor handle quick changes without an app switch. The simple git client keeps diffs and commit history close by, so reviewing what changed stays part of the terminal workflow.',
            points: [
              'Browse files beside the terminal and make small edits quickly.',
              'Review diffs without jumping to a separate git app.',
              'Open commit history when you need to check how a change evolved.',
            ],
            imageAlt: '2code git diff view',
          },
          profiles: {
            eyebrow: 'Worktrees',
            title: 'Keep each task in its own lane.',
            copy:
              'Every git worktree of a project sits in the sidebar with its own terminals and context. New worktrees run your setup script, deleted ones your teardown, so switching between tasks stays clear instead of turning into a tab hunt.',
            points: [
              'Create a worktree per feature, fix or experiment; setup runs for you.',
              'Keep terminals from one task away from another task.',
              'Switch back later and see the same context you left there.',
            ],
            imageAlt: '2code worktree view',
          },
        },
      },
      faq: {
        kicker: 'FAQ',
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
      announcement: {
        regionLabel: '公告',
        badge: '新',
        copy: 'aghub 已发布，它是世界上最顺滑的 agent 管理器。',
        dismiss: '关闭公告',
      },
      nav: {
        home: '2code 首页',
        primary: '主导航',
        features: '亮点',
        faq: 'FAQ',
        blog: '博客',
        github: 'GitHub',
        theme: '切换浅色 / 深色',
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
        kicker: '你的下一个 Agentic IDE',
        titleLineOne: '你的 Agent',
        titleLineTwo: '需要更好的终端',
        titleHighlight: '更好',
        sticker: '为 Vibe Coding 而生',
        lede:
          '普通终端只管命令，2code 还管项目、worktree 和 Agent。',
        supporting:
          '如果你每天都在终端、Agent、dev server 和多个 worktree 之间切来切去，把 2code 装进 Herdr，放在一个窗口里管。',
        primaryCta: '在 Herdr 中使用 2code',
        secondaryCta: '查看亮点',
        shotAlt: 'Herdr 里的 2code：项目和 worktree、文件树，以及正在 tab 里干活的 Agent',
      },
      footer: {
        tagline: '为 vibe coding 而生的 Herdr 布局。',
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
          metadataTitle: '2code 亮点 | 持久终端、Git 与 Worktree',
          metadataDescription:
            '2code 在普通终端之上加了持久会话、应用内 Git review，以及隔离的 worktree 窗口。',
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
      features: {
        items: {
          terminals: {
            eyebrow: '持久终端',
            title: '重启以后，终端还在原地。',
            copy:
              '2code 会保留终端会话、窗口布局和历史记录。重新打开应用时，不用从零开始恢复工作现场。',
            points: [
              '恢复终端历史和上次的窗口布局。',
              '长时间运行的会话会跟着所属项目保存。',
              '回来以后不用手动重新打开每条命令。',
            ],
            imageAlt: '2code 持久终端标签页视图',
          },
          git: {
            eyebrow: '文件与 Git',
            title: '小改动和 review，不用离开终端。',
            copy:
              '内置文件树和轻量编辑器，临时改文件不用再切到别的应用。简单的 Git client 可以看 diff、回顾历史 commit，适合快速 review。',
            points: [
              '在终端旁边直接浏览文件，顺手改配置或小段代码。',
              '打开 diff 看清这次到底改了什么。',
              '需要追溯时，直接查看历史 commit 做 review。',
            ],
            imageAlt: '2code Git diff 视图',
          },
          profiles: {
            eyebrow: 'Worktree',
            title: '每条任务线都有自己的 worktree。',
            copy:
              '项目的每个 git worktree 都会出现在侧栏里，有自己的终端和上下文。新建时自动跑安装脚本，删除时跑清理脚本，切换时不会混成一团。',
            points: [
              '一个功能、一个修复、一个实验，各建一个 worktree，安装脚本自动执行。',
              '不同窗口里的终端互不干扰，命令不会串到一起。',
              '切回某条任务线时，看到的就是上次离开时的现场。',
            ],
            imageAlt: '2code worktree 视图',
          },
        },
      },
      faq: {
        kicker: 'FAQ',
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
