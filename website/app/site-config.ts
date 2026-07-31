export const siteConfig = {
  name: '2code',
  domain: '2code.akr.moe',
  url: 'https://2code.akr.moe',
  githubUrl: 'https://github.com/AkaraChen/2code',
  githubReleaseUrl:
    'https://github.com/AkaraChen/2code/releases/latest',
  // The product window is the share image; there is no decorative hero art.
  ogImage: '/screenshots/terminal-tabs.png',
  ogImageWidth: 2498,
  ogImageHeight: 1802,
  // Shared discovery paths for GEO (served from /public)
  llmsTxtPath: '/llms.txt',
  llmsFullTxtPath: '/llms-full.txt',
  markdownHomePath: '/index.md',
  markdownZhPath: '/zh-cn.md',
} as const
