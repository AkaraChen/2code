import { Fragment } from 'react'

/*
  Renders the two inline marks copy strings may carry: **emphasis** and `code`.
  Emphasis is set brighter rather than heavier, so a sentence can lean on a
  phrase without the paragraph turning into a wall of bold.
*/
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code className="inline-code" key={index}>
              {part.slice(1, -1)}
            </code>
          )
        }
        return <Fragment key={index}>{part}</Fragment>
      })}
    </>
  )
}

/** The same string with its marks removed, for alt text and metadata. */
export function plainText(text: string) {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
}
