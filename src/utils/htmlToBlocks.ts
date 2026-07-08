/**
 * Minimal, dependency-free HTML → block model converter.
 *
 * Purpose-built for the semantic, attribute-free markup produced by the
 * minibits.cash Terms & Privacy pages (h1-h3, p, ul/li, blockquote, hr with
 * inline strong/em/a). It is intentionally NOT a general-purpose HTML parser —
 * it only understands the subset of tags those pages emit.
 */

export type InlineSegment = {
  text: string
  bold?: boolean
  italic?: boolean
  href?: string
}

export type Block =
  | { type: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'quote'; segments: InlineSegment[] }
  | { type: 'hr' }

const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&copy;': '©',
}

function decodeEntities(input: string): string {
  return input
    .replace(/&quot;|&#x27;|&#39;|&amp;|&lt;|&gt;|&nbsp;|&mdash;|&ndash;|&copy;/g, m => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
}

/**
 * Parses the inner HTML of a single block into inline segments, resolving
 * nested strong/em/a formatting.
 */
function parseInline(html: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  const re = /<(strong|b|em|i|a)\b([^>]*)>([\s\S]*?)<\/\1>|([^<]+)/g
  let match: RegExpExecArray | null

  while ((match = re.exec(html)) !== null) {
    if (match[4] !== undefined) {
      const text = decodeEntities(match[4]).replace(/\s+/g, ' ')
      if (text.trim().length > 0 || text === ' ') segments.push({ text })
      continue
    }

    const tag = match[1]
    const attrs = match[2]
    const inner = match[3]
    const href = tag === 'a' ? attrs.match(/href="([^"]*)"/)?.[1] : undefined

    for (const child of parseInline(inner)) {
      segments.push({
        text: child.text,
        bold: child.bold || tag === 'strong' || tag === 'b',
        italic: child.italic || tag === 'em' || tag === 'i',
        href: child.href || href,
      })
    }
  }

  return segments
}

/** Extracts the inner HTML of the first <article> element (the content region). */
export function extractArticle(html: string): string {
  const start = html.indexOf('<article')
  if (start < 0) return ''
  const open = html.indexOf('>', start)
  const end = html.indexOf('</article>', open)
  if (open < 0 || end < 0) return ''
  return html.slice(open + 1, end)
}

/**
 * Converts the Terms/Privacy page HTML into an ordered list of renderable
 * blocks. Accepts either a full page or an already-extracted article fragment.
 */
export function htmlToBlocks(html: string): Block[] {
  const article = html.includes('<article') ? extractArticle(html) : html
  const cleaned = article.replace(/<!--[\s\S]*?-->/g, '')

  const blocks: Block[] = []
  const re = /<(h1|h2|h3|p)>([\s\S]*?)<\/\1>|<ul>([\s\S]*?)<\/ul>|<blockquote>([\s\S]*?)<\/blockquote>|<hr\s*\/?>/g
  let match: RegExpExecArray | null

  while ((match = re.exec(cleaned)) !== null) {
    if (match[1]) {
      const type = match[1] as 'h1' | 'h2' | 'h3' | 'p'
      const segments = parseInline(match[2])
      if (segments.length > 0) blocks.push({ type, segments })
    } else if (match[3] !== undefined) {
      const liRe = /<li>([\s\S]*?)<\/li>/g
      let li: RegExpExecArray | null
      while ((li = liRe.exec(match[3])) !== null) {
        blocks.push({ type: 'li', segments: parseInline(li[1]) })
      }
    } else if (match[4] !== undefined) {
      const pRe = /<p>([\s\S]*?)<\/p>/g
      let p: RegExpExecArray | null
      let matchedParagraph = false
      while ((p = pRe.exec(match[4])) !== null) {
        blocks.push({ type: 'quote', segments: parseInline(p[1]) })
        matchedParagraph = true
      }
      if (!matchedParagraph) blocks.push({ type: 'quote', segments: parseInline(match[4]) })
    } else {
      blocks.push({ type: 'hr' })
    }
  }

  return blocks
}
