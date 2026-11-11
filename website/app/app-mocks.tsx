import type { CSSProperties, ReactNode } from 'react'
import type { ChapterId, Messages } from './i18n/resources'
import {
  AgentIcon,
  BranchIcon,
  ChevronIcon,
  CommentIcon,
  PlusIcon,
  TerminalIcon,
} from './ui-icons'

/*
  Pieces of the app drawn in HTML rather than screenshotted: they stay sharp at
  any width, follow the site's light/dark theme, and use the app's own labels in
  both languages. Each figure is one image to assistive tech (role="img" plus the
  chapter's description); the markup inside is decoration.
*/

type MockLabels = Messages['mock']

export type StatusState = 'idle' | 'working' | 'blocked' | 'done'

export function StatusDot({ state }: { state: StatusState }) {
  return <span className={`status-dot is-${state}`} aria-hidden="true" />
}

function NeedsYou({ label }: { label: string }) {
  return <span className="needs-you">{label}</span>
}

/** A line of the setup run that fades in, in order, once the figure is seen. */
function PlayLine({ index, children }: { index: number; children: ReactNode }) {
  return (
    <span className="play-line" style={{ '--i': index } as CSSProperties}>
      {children}
      {'\n'}
    </span>
  )
}

function Profile({
  name,
  selected,
  children,
}: {
  name: string
  selected?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`side-profile${selected ? ' is-selected' : ''}`}>
      <BranchIcon />
      <span>{name}</span>
      {children ?? <span />}
    </div>
  )
}

function ProfilesMock({ m }: { m: MockLabels }) {
  return (
    <div className="figure-row">
      <div className="mock mock-side">
        <div className="side-head">
          {m.projects}
          <PlusIcon />
        </div>
        <div className="side-project">
          <span className="side-avatar">A</span>
          acme-web
          <span className="side-tail">
            <PlusIcon />
            <ChevronIcon />
          </span>
        </div>
        <Profile name="herdr-layout-port">
          <StatusDot state="done" />
        </Profile>
        <Profile name="feature/login">
          <StatusDot state="working" />
        </Profile>
        <Profile name="fix/sidebar">
          <NeedsYou label={m.needsYou} />
        </Profile>
        <Profile name="feature/search" selected>
          <span className="status-swap">
            <StatusDot state="working" />
            <StatusDot state="done" />
          </span>
        </Profile>
        <div className="side-project is-spaced">
          <span className="side-avatar">A</span>
          api-server
          <span className="side-tail">
            <ChevronIcon />
          </span>
        </div>
        <Profile name="master" />
      </div>

      <div className="mock mock-term">
        <div className="term-tabs">
          <span className="term-tab is-active">
            <TerminalIcon />
            setup
            <span className="term-tab-close">×</span>
          </span>
          <span className="term-tab-new">
            <PlusIcon />
            {m.newTerminal}
          </span>
        </div>
        <pre className="term-body">
          <PlayLine index={0}>
            <span className="t-dim">## feature/search · setup_script</span>
          </PlayLine>
          <PlayLine index={1}>
            <span className="t-strong">$</span> bun install
          </PlayLine>
          <PlayLine index={2}>
            <span className="t-dim">  437 packages installed [0.76s]</span>
          </PlayLine>
          <PlayLine index={3}>
            <span className="t-strong">$</span> cp ../.env .env
          </PlayLine>
          <PlayLine index={5}>
            <span className="t-ok">✓ {m.setupDone}</span>
          </PlayLine>
          <PlayLine index={6}>
            ➜ feature-search git:(feature/search){' '}
            <span className="t-cursor" />
          </PlayLine>
        </pre>
      </div>
    </div>
  )
}

function StatusMock({ m }: { m: MockLabels }) {
  return (
    <div className="mock mock-term">
      <div className="term-tabs">
        <span className="term-tab">
          <TerminalIcon />
          Dev server
          <span className="term-tab-close">×</span>
        </span>
        <span className="term-tab is-active">
          <AgentIcon />
          claude
          <StatusDot state="blocked" />
          <span className="term-tab-close">×</span>
        </span>
        <span className="term-tab">
          <AgentIcon />
          codex
          <StatusDot state="working" />
          <span className="term-tab-close">×</span>
        </span>
        <span className="term-tab">
          <AgentIcon />
          review
          <StatusDot state="done" />
          <span className="term-tab-close">×</span>
        </span>
        <span className="term-tab-new">
          <PlusIcon />
          {m.newTerminal}
          <ChevronIcon />
        </span>
      </div>
      <pre className="term-body">
        <span className="t-dim">✻ Claude Code</span>
        {'\n\n'}
        <span className="t-strong">›</span> {m.agentTask}
        {'\n\n'}
        <span className="t-ok">●</span> Read(src/features/auth/LoginForm.tsx){'\n'}
        <span className="t-ok">●</span> Update(src/features/auth/LoginForm.tsx){'\n'}
        <span className="t-dim">  └ Added 14 lines, removed 3 lines</span>
        {'\n'}
        <span className="t-ok">●</span> Bash(bun test src/features/auth){'\n'}
        <span className="t-dim">  └ 12 pass, 0 fail</span>
        {'\n'}
        <span className="term-ask">
          Push the branch and open a pull request?{'\n'}
          <span className="t-dim">
            <b>1</b> Yes   <b>2</b> Yes, and don&apos;t ask again   <b>3</b> No
          </span>
        </span>
      </pre>
    </div>
  )
}

type DiffLine = readonly [
  oldNumber: string,
  newNumber: string,
  kind: '' | 'add' | 'pick',
  code: string,
]

const DIFF_LINES: readonly DiffLine[] = [
  ['17', '20', '', '}) {'],
  ['18', '21', '', '  const isActive = useMatch(pattern ?? to) !== null;'],
  ['', '22', 'add', '  const showBadge = badge !== undefined && badge > 0;'],
  ['19', '23', '', ''],
  ['', '33', 'pick', '      {showBadge ? ('],
  ['', '34', 'pick', '        <span className="ml-auto rounded-full px-1.5">'],
  ['', '35', 'pick', '          {badge > 99 ? "99+" : badge}'],
  ['', '36', 'pick', '        </span>'],
  ['', '37', 'pick', '      ) : null}'],
]

function ReviewMock({ m }: { m: MockLabels }) {
  return (
    <div className="mock mock-diff">
      <div className="diff-head">
        <BranchIcon />
        <span>herdr-layout-port</span>
        <span className="segmented">
          <span className="is-on">{m.changes}</span>
          <span>{m.history}</span>
        </span>
        <span className="diff-grow" />
        <span className="diff-review">
          <CommentIcon />
          {m.review}
        </span>
        <span className="segmented diff-view">
          <span className="is-on">{m.unified}</span>
          <span>{m.split}</span>
        </span>
      </div>
      <div className="diff-grid">
        <div className="diff-files">
          <div className="diff-count">{m.changedFiles}</div>
          <div className="diff-file is-selected">
            <span className="diff-check" />
            SidebarLink.tsx
            <span className="diff-plus">+9</span>
            <span className="diff-badge">M</span>
          </div>
          <div className="diff-file">
            <span className="diff-check" />
            NOTES.md
            <span className="diff-plus">+3</span>
            <span className="diff-badge">A</span>
          </div>
        </div>
        <div className="diff-code">
          <div className="diff-path">
            <span>src/shared/components/SidebarLink.tsx</span>
            <span className="diff-plus">+9 −0</span>
          </div>
          <div className="diff-hunk">@@ -17,6 +20,11 @@ export function SidebarLink({'{'}</div>
          {DIFF_LINES.map(([oldNumber, newNumber, kind, code], index) => (
            <div
              className={`diff-line${kind ? ` is-add${kind === 'pick' ? ' is-picked' : ''}` : ''}`}
              key={index}
            >
              <span>{oldNumber}</span>
              <span>{newNumber}</span>
              <span>{kind ? '+' : ''}</span>
              <span>{code}</span>
            </div>
          ))}
          <div className="diff-comment">
            <span className="diff-where">SidebarLink.tsx:33-37</span>
            <span className="diff-field">{m.comment}</span>
            <span className="diff-send">{m.addComment}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TemplatesMock({ m }: { m: MockLabels }) {
  return (
    <div className="figure-row figure-row-end">
      <div className="mock">
        <div className="json-head">
          <b>acme-web/2code.json</b>
          <span>{m.projectSettings}</span>
        </div>
        <pre className="json-body">
          {'{\n  '}
          <span className="j-key">&quot;setup_script&quot;</span>: [
          <span className="j-str">&quot;bun install&quot;</span>,{' '}
          <span className="j-str">&quot;cp ../.env .env&quot;</span>],{'\n  '}
          <span className="j-key">&quot;teardown_script&quot;</span>: [
          <span className="j-str">&quot;docker compose down&quot;</span>],{'\n  '}
          <span className="j-key">&quot;terminal_templates&quot;</span>: [{'\n    { '}
          <span className="j-key">&quot;name&quot;</span>:{' '}
          <span className="j-str">&quot;Claude&quot;</span>,{' '}
          <span className="j-key">&quot;commands&quot;</span>: [
          <span className="j-str">&quot;claude&quot;</span>] {'},\n    { '}
          <span className="j-key">&quot;name&quot;</span>:{' '}
          <span className="j-str">&quot;Dev server&quot;</span>,{' '}
          <span className="j-key">&quot;commands&quot;</span>: [
          <span className="j-str">&quot;bun dev&quot;</span>] {'}\n  ]\n}'}
        </pre>
      </div>
      <div className="mock mock-menu">
        <div className="menu-trigger">
          <PlusIcon />
          {m.newTerminal}
          <ChevronIcon />
        </div>
        <div className="menu-list">
          <div className="menu-group">acme-web</div>
          <div className="menu-item is-selected">
            <AgentIcon />
            Claude
            <span className="menu-cmd">claude</span>
          </div>
          <div className="menu-item">
            <TerminalIcon />
            Dev server
            <span className="menu-cmd">bun dev</span>
          </div>
          <div className="menu-group">{m.globalTemplates}</div>
          <div className="menu-item">
            <AgentIcon />
            Codex
            <span className="menu-cmd">codex</span>
          </div>
          <div className="menu-item">
            <TerminalIcon />
            lazygit
            <span className="menu-cmd">lazygit</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const MOCKS: Record<ChapterId, (props: { m: MockLabels }) => ReactNode> = {
  profiles: ProfilesMock,
  status: StatusMock,
  review: ReviewMock,
  templates: TemplatesMock,
}

export function ChapterFigure({
  id,
  messages,
}: {
  id: ChapterId
  messages: Messages
}) {
  const Mock = MOCKS[id]

  return (
    <figure
      className="chapter-figure reveal"
      role="img"
      aria-label={messages.chapters.items[id].figure}
      data-markdown-ignore
    >
      <Mock m={messages.mock} />
    </figure>
  )
}
