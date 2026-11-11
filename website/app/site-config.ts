export const siteConfig = {
  name: '2code',
  domain: '2code.akr.moe',
  url: 'https://2code.akr.moe',
  githubUrl: 'https://github.com/AkaraChen/2code',
  // The last desktop (Tauri) builds; 2code is a Herdr layout now.
  githubReleaseUrl:
    'https://github.com/AkaraChen/2code/releases/latest',
  installUrl: 'https://github.com/AkaraChen/2code#install',
  herdrDownloadUrl: 'https://herdr.dev/download/',
  installPrompt: 'Add the Herdr layout at github.com/AkaraChen/2code',
  installScript:
    'git clone https://github.com/AkaraChen/2code && cd 2code && ./scripts/install.sh',
  // Share images, one per locale, rendered at 2x from scripts/og-image.html.
  ogImages: { en: '/og/2code-en.png', 'zh-cn': '/og/2code-zh.png' },
  ogImageWidth: 2400,
  ogImageHeight: 1260,
  llmsTxtPath: '/llms.txt',
  llmsFullTxtPath: '/llms-full.txt',
  markdownHomePath: '/index.md',
  markdownZhPath: '/zh-cn.md',
  siblingProducts: [
    {
      name: 'akr.moe',
      url: 'https://akr.moe',
      description: "Akara Chen's site (hub)",
    },
    {
      name: 'Angel Engine',
      url: 'https://ag.akr.moe',
      description: 'Local desktop for coding agents',
    },
    {
      name: 'OGKit',
      url: 'https://ogkit.akr.moe',
      description: 'Open Graph lint for web, extension, and CLI',
    },
  ],
} as const
