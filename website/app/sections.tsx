import { Fragment, type ReactNode } from 'react'
import { ChapterFigure } from './app-mocks'
import { CopyButton } from './copy-button'
import {
  CHAPTER_IDS,
  FAQ_IDS,
  type Messages,
} from './i18n/resources'
import { RichText } from './rich-text'
import { siteConfig } from './site-config'
import { ArrowUpRightIcon } from './ui-icons'

/*
  Sections shared by the homepage and the product pages, so /features, /faq and
  /install say exactly what the homepage says.
*/

/** "## Title" chapter heading; the hashes are decoration. */
export function ChapterHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="chapter-title reveal">
      <span className="chapter-hash" aria-hidden="true">
        ##
      </span>
      <span>{children}</span>
    </h2>
  )
}

export function FeatureChapters({ messages }: { messages: Messages }) {
  return (
    <>
      {CHAPTER_IDS.map((id) => {
        const item = messages.chapters.items[id]

        return (
          <article className="chapter" id={id} key={id}>
            <ChapterHeading>{item.title}</ChapterHeading>
            <p className="chapter-body reveal">
              <RichText text={item.body} />
            </p>
            <ChapterFigure id={id} messages={messages} />
          </article>
        )
      })}
    </>
  )
}

/** Collapsible on the homepage; the /faq page shows every answer. */
export function FaqList({
  messages,
  open = false,
}: {
  messages: Messages
  open?: boolean
}) {
  const t = messages

  if (open) {
    return (
      <div className="faq-list reveal">
        {FAQ_IDS.map((id) => (
          <section className="faq-entry" key={id}>
            <h2>{t.faq.items[id].question}</h2>
            <p>{t.faq.items[id].answer}</p>
          </section>
        ))}
      </div>
    )
  }

  return (
    <div className="faq-list reveal">
      {FAQ_IDS.map((id) => (
        <details className="faq-entry" key={id}>
          <summary>{t.faq.items[id].question}</summary>
          <p>{t.faq.items[id].answer}</p>
        </details>
      ))}
    </div>
  )
}

export function InstallPrompt({ messages }: { messages: Messages }) {
  return (
    <div className="install-prompt">
      <div className="install-prompt-text">
        <span className="install-prompt-comment">
          {messages.install.promptComment}
        </span>
        <code>{siteConfig.installPrompt}</code>
      </div>
      <CopyButton
        text={siteConfig.installPrompt}
        label={messages.install.copy}
        copiedLabel={messages.install.copied}
      />
    </div>
  )
}

/** `{keys}` / `{macKey}` in the hint become keycaps. */
function SwitchHint({ template }: { template: string }) {
  const caps = {
    keys: ['ctrl', 'shift', 'L'],
    macKey: ['cmd', 'shift', 'L'],
  } as const

  return (
    <p className="install-hint">
      {template.split(/(\{keys\}|\{macKey\})/g).map((part, index) => {
        const name = part.slice(1, -1)
        if (name === 'keys' || name === 'macKey') {
          return (
            <span className="keycaps" key={index}>
              {caps[name].map((cap) => (
                <kbd className="keycap" key={cap}>
                  {cap}
                </kbd>
              ))}
            </span>
          )
        }
        return <Fragment key={index}>{part}</Fragment>
      })}
    </p>
  )
}

export function InstallSteps({ messages }: { messages: Messages }) {
  const t = messages.install

  return (
    <ol className="install-steps reveal">
      <li className="install-step">
        <span className="install-step-n" aria-hidden="true">
          01
        </span>
        <div className="install-step-row">
          <div>
            <h3>{t.herdrTitle}</h3>
            <p>{t.herdrBody}</p>
          </div>
          <a
            className="button button-secondary"
            href={siteConfig.herdrDownloadUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t.herdrCta}
            <ArrowUpRightIcon />
          </a>
        </div>
      </li>
      <li className="install-step">
        <span className="install-step-n" aria-hidden="true">
          02
        </span>
        <div>
          <h3>{t.layoutTitle}</h3>
          <InstallPrompt messages={messages} />
          <SwitchHint template={t.switchHint} />
        </div>
      </li>
    </ol>
  )
}
