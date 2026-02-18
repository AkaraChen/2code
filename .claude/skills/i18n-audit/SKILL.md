---
name: i18n-audit
description: Find hardcoded user-facing strings in frontend code and replace them with Paraglide.js i18n message calls. Use when the user asks to "find hardcoded strings", "i18n audit", "internationalize", "replace strings with i18n", "check for untranslated strings", or wants to ensure all UI text uses paraglide messages. Covers React/TSX components, hooks, and class files.
---

# i18n Audit

Scan frontend `.tsx` and `.ts` files for hardcoded user-facing strings, then replace them with `m.xxx()` calls from Paraglide.js.

## Workflow

### 1. Read existing messages

Read `messages/en.json` and `messages/zh.json` to understand what keys already exist. Note keys that are defined but possibly unused.

### 2. Scan for hardcoded strings

Use the Explore agent or Grep to scan all files under `src/` for hardcoded English strings in:

- JSX text content between tags: `<Text>Hardcoded</Text>`
- JSX attribute values: `placeholder="..."`, `title="..."`, `aria-label="..."`, `alt="..."`
- Toast/error messages, dialog titles, button labels, tab labels, menu items
- Template literals producing user-visible text: `` `Terminal ${n}` ``
- Fallback strings in nullish coalescing: `?? "Default"`

**Exclude** from findings:
- CSS values, style props, class names
- Import paths, module names, event names
- Query keys, store keys, technical identifiers
- `console.log` / `consola` messages (dev-only)
- Strings already using `m.xxx()`
- Comments

### 3. Report findings

Present a table grouped by priority:

| Priority | Criteria |
|----------|----------|
| High | Existing message key defined but component uses hardcoded string instead |
| Medium | User-visible string with no existing key — needs new key |
| Low | Accessibility text (`alt`, `aria-label`) with no existing key |

Include file path, line number, hardcoded string, and suggested message key for each finding.

### 4. Add new message keys

For strings needing new keys, add entries to both `messages/en.json` and `messages/zh.json`. Follow existing naming conventions:

- camelCase keys
- Feature prefix: `agent*`, `terminal*`, `topbar*`, `debug*`
- Parameterized messages use `{paramName}`: `"Terminal {n}"`, `"Failed: {error}"`

### 5. Replace hardcoded strings

For each finding:
1. Add `import * as m from "@/paraglide/messages.js"` if not already imported
2. Replace the hardcoded string with the appropriate `m.xxx()` call
3. For parameterized messages: `m.keyName({ param: value })`

```tsx
// Before
<Text>Execution Plan</Text>
`Terminal ${counter + 1}`
alt="Tool output"

// After
<Text>{m.agentPlan()}</Text>
m.terminalTabTitle({ n: counter + 1 })
alt={m.agentToolOutputAlt()}
```

### 6. Verify

Run `npx paraglide-js compile` then `npx tsc --noEmit` to confirm zero errors.
