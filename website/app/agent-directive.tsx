import { getMessages, type AppLocale } from './i18n/resources'
import { siteConfig } from './site-config'

type AgentDirectiveProps = Readonly<{
  locale: AppLocale
}>

/**
 * Server-rendered, visually hidden (clip-rect, not display:none) so agents
 * reading HTML still see a pointer to `/llms.txt` and the markdown alternates.
 */
export function AgentDirective({ locale }: AgentDirectiveProps) {
  const t = getMessages(locale)
  const href = siteConfig.llmsTxtPath

  return (
    <p className="agent-docs-directive">
      {t.agent.htmlLead}{' '}
      <a href={href}>{href}</a>. {t.agent.htmlMarkdown}
    </p>
  )
}
