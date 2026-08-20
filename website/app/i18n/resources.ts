export const defaultLocale = 'en' as const

export const supportedLocales = ['en', 'zh-cn'] as const

export type AppLocale = (typeof supportedLocales)[number]

export const resources = {
  en: {
      metadata: {
        title: '2code | Terminal Workstation for Projects, Worktrees, and Agents',
        description:
          '2code is a terminal workstation with project and worktree tabs, independent windows, agent notifications, templates, file editing, git review, and session restore.',
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
          'developer desktop app',
          'macOS terminal',
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
        lede:
          'Normal terminals run commands. 2code also manages projects, worktrees, and agents.',
        supporting:
          'If you bounce between agents, dev servers, and multiple worktrees every day, 2code is worth a download.',
        primaryCta: 'Download for macOS',
        secondaryCta: 'Explore features',
        shotAlt: '2code running four agent terminals in one project window',
      },
      footer: {
        tagline: 'Desktop software for vibe coding.',
        releases: 'Releases',
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
          metadataTitle: 'Install 2code | Homebrew and GitHub Releases',
          metadataDescription:
            'Install 2code on macOS with Homebrew, or download a DMG from GitHub Releases. Windows and Linux are experimental.',
          title: 'Install 2code',
          lede: 'macOS is the primary platform. Windows and Linux builds are experimental.',
          brewHeading: 'Homebrew (macOS)',
          releasesHeading: 'GitHub Releases',
          releasesBody: 'DMG builds are also published on GitHub Releases.',
        },
        gettingStarted: {
          metadataTitle: 'Getting started with 2code',
          metadataDescription:
            'Who 2code is for, how to install it, and what to expect on each platform.',
          title: 'Getting started',
          lede: '2code is a local terminal workstation for projects, worktrees, and AI coding agents.',
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
            eyebrow: 'Worktree windows',
            title: 'Keep each task in its own lane.',
            copy:
              'Open each project or worktree in its own window when you need separation. Every lane keeps its own terminals and context, so switching between tasks stays clear instead of turning into a tab hunt.',
            points: [
              'Open multiple windows for different projects or worktrees.',
              'Keep terminals from one task away from another task.',
              'Switch back later and see the same context you left there.',
            ],
            imageAlt: '2code worktree profile view',
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
              'Yes. 2code is a full terminal emulator first, then adds project and worktree management, built-in tools, notifications, templates, and session restore around it.',
          },
          agents: {
            question: 'How does it help with AI agents?',
            answer:
              'Agent work is easier to monitor because 2code can show a green dot and play a sound when an agent finishes. You do not have to keep staring at every terminal pane.',
          },
          templates: {
            question: 'What are command templates for?',
            answer:
              'Templates let you quickly open command-line apps and recurring project commands, such as Claude, a dev server, or a custom script you launch all the time.',
          },
          restore: {
            question: 'What happens after restarting 2code?',
            answer:
              '2code restores your previous workspace so projects, worktrees, windows, terminals, and history can come back close to where you left them.',
          },
          production: {
            question: 'Is 2code production-ready today?',
            answer:
              'It is still evolving. macOS is the primary target today, with experimental Windows and Linux support available for testing; some Windows system customization is still being verified.',
          },
          platforms: {
            question: 'What platforms does it support?',
            answer:
              'macOS is the most mature build. Windows and Linux support is experimental and improving, with Windows system customization still being verified.',
          },
        },
        cta: 'Try the latest build and see how 2code fits your terminal workflow.',
      },
  },
  'zh-cn': {
      metadata: {
        title: '2code | 管项目、Worktree 和 Agent 的终端工作站',
        description:
          '2code 是一个完整的终端模拟器，内置项目和 worktree 管理、独立窗口、Agent 完成提醒、文件树、轻量编辑器、Git review、命令模板和历史恢复。',
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
          '开发者桌面应用',
          'macOS 终端',
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
        lede:
          '普通终端只管命令，2code 还管项目、worktree 和 Agent。',
        supporting:
          '如果你每天都在终端、Agent、dev server 和多个 worktree 之间切来切去，2code 值得你下载试一次。',
        primaryCta: '下载最新版本',
        secondaryCta: '查看亮点',
        shotAlt: '2code 在一个项目窗口里同时跑四个 Agent 终端',
      },
      footer: {
        tagline: '为 vibe coding 而生的桌面工具。',
        releases: '版本发布',
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
          metadataTitle: '安装 2code | Homebrew 与 GitHub Releases',
          metadataDescription:
            '用 Homebrew 在 macOS 上安装 2code，或从 GitHub Releases 下载 DMG。Windows 与 Linux 为实验支持。',
          title: '安装 2code',
          lede: '当前以 macOS 为主；Windows 与 Linux 构建为实验支持。',
          brewHeading: 'Homebrew（macOS）',
          releasesHeading: 'GitHub Releases',
          releasesBody: 'DMG 构建也会发布在 GitHub Releases。',
        },
        gettingStarted: {
          metadataTitle: '开始使用 2code',
          metadataDescription:
            '2code 适合谁、怎么安装，以及各平台目前能期待什么。',
          title: '快速开始',
          lede: '2code 是面向项目、worktree 和 AI coding agent 的本地终端工作站。',
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
            eyebrow: 'Worktree 窗口',
            title: '每个项目和 worktree 都能独立开窗口。',
            copy:
              '需要隔离的时候，每个项目或 worktree 都可以单独开窗口。终端、上下文和当前任务分开保存，切换时不会混成一团。',
            points: [
              '一个功能、一个修复、一个实验，都可以独立开窗口。',
              '不同窗口里的终端互不干扰，命令不会串到一起。',
              '切回某条任务线时，看到的就是上次离开时的现场。',
            ],
            imageAlt: '2code worktree profile 视图',
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
              '是。2code 首先是一个完整的终端模拟器，然后在这个基础上加了项目/worktree 管理、内置工具、通知、模板和历史恢复。',
          },
          agents: {
            question: '它怎么帮我看 Agent 有没有跑完？',
            answer:
              'Agent 完成后，2code 会用绿点和声音提醒你。你不用一直盯着每个终端窗口，也能知道哪条任务线有结果了。',
          },
          templates: {
            question: '命令模板是干什么的？',
            answer:
              '模板用来快速打开常用命令行应用和项目命令，比如 Claude、Dev Server，或者你每天都会启动的自定义脚本。',
          },
          restore: {
            question: '重启能恢复什么？',
            answer:
              '2code 会恢复上次的工作现场。项目、worktree、窗口、终端和历史记录都可以回到接近离开时的状态。',
          },
          production: {
            question: '现在可以作为主力工具使用吗？',
            answer:
              '可以。macOS 版本最成熟，Windows 和 Linux 目前是实验支持，其中 Windows 的部分系统自定义能力仍在验证。',
          },
          platforms: {
            question: '支持哪些平台？',
            answer:
              '支持 macOS，并已提供实验性质的 Windows 和 Linux 支持；Windows 的部分系统自定义能力仍在验证。',
          },
        },
        cta: '下载最新版本，看看 2code 是否适合你的终端工作流。',
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
