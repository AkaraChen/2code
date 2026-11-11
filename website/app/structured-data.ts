import type { AppLocale } from './i18n/resources'
import { siteConfig } from './site-config'

/** BCP 47 tag used for HTML `lang` and schema.org `inLanguage`. */
export function htmlLang(locale: AppLocale): 'zh-CN' | 'en' {
  return locale === 'zh-cn' ? 'zh-CN' : 'en'
}

/** Shared Organization node — blog posts reference it via `@id`. */
export function organizationNode() {
  return {
    '@type': 'Organization' as const,
    '@id': `${siteConfig.url}/#organization`,
    name: siteConfig.name,
    url: siteConfig.url,
    sameAs: [siteConfig.githubUrl],
  }
}
