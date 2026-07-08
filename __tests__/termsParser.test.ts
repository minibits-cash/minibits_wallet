/**
 * Tests for the Terms/Privacy HTML parser used by WelcomeScreen.
 *
 * Two layers:
 *  1. Deterministic unit tests over a fixed fixture — lock the parser's
 *     behaviour (block segmentation, inline formatting, entity decoding).
 *  2. A live guard test that fetches https://minibits.cash/terms and asserts
 *     structural invariants. This is what catches an *unexpected* change to
 *     the live Terms markup (e.g. a new element type the parser can't handle,
 *     which would otherwise leak raw HTML into the app). Requires network.
 */

import { htmlToBlocks, extractArticle, Block } from '../src/utils/htmlToBlocks'

const TERMS_URL = 'https://minibits.cash/terms'

const SAMPLE = `<header>ignored</header><main><article class="prose-minibits">
<h1>Terms and Conditions</h1>
<p><strong>Bitango</strong> &amp; friends said &quot;hello&quot; &#x27;again&#x27;</p>
<hr/>
<h2>Part 0 — General Terms</h2>
<h3>0.1 About</h3>
<p>Read the <a href="https://minibits.cash/privacy">Privacy Policy</a> and the <em>fine print</em>.</p>
<ul>
<li>First <em>item</em></li>
<li>Second item</li>
</ul>
<blockquote>
<p><strong>IMPORTANT</strong></p>
<p>Read carefully.</p>
</blockquote>
</article></main><footer>ignored</footer>`

const textOf = (block: Block): string =>
    block.type === 'hr' ? '' : block.segments.map(s => s.text).join('')

describe('htmlToBlocks (fixture)', () => {
    const blocks = htmlToBlocks(SAMPLE)

    test('extractArticle returns only the article inner HTML', () => {
        const inner = extractArticle(SAMPLE)
        expect(inner).toContain('<h1>Terms and Conditions</h1>')
        expect(inner).not.toContain('<header>')
        expect(inner).not.toContain('<footer>')
    })

    test('produces the expected block sequence', () => {
        expect(blocks.map(b => b.type)).toEqual([
            'h1', 'p', 'hr', 'h2', 'h3', 'p', 'li', 'li', 'quote', 'quote',
        ])
    })

    test('decodes HTML entities in text', () => {
        expect(textOf(blocks[1])).toBe('Bitango & friends said "hello" \'again\'')
    })

    test('marks <strong> segments as bold', () => {
        const strong = blocks[1].type !== 'hr' && blocks[1].segments.find(s => s.text === 'Bitango')
        expect(strong && strong.bold).toBe(true)
    })

    test('captures link href and marks <em> segments as italic', () => {
        const paragraph = blocks[5]
        if (paragraph.type === 'hr') throw new Error('unexpected hr')
        const link = paragraph.segments.find(s => s.href)
        expect(link?.href).toBe('https://minibits.cash/privacy')
        expect(link?.text).toBe('Privacy Policy')
        const italic = paragraph.segments.find(s => s.text === 'fine print')
        expect(italic?.italic).toBe(true)
    })

    test('splits <ul> into individual <li> blocks', () => {
        expect(textOf(blocks[6])).toBe('First item')
        expect(textOf(blocks[7])).toBe('Second item')
    })

    test('expands <blockquote> paragraphs into quote blocks', () => {
        expect(blocks[8].type).toBe('quote')
        expect(textOf(blocks[8])).toBe('IMPORTANT')
        expect(textOf(blocks[9])).toBe('Read carefully.')
    })

    test('never leaks raw HTML tags into rendered text', () => {
        for (const block of blocks) {
            expect(textOf(block)).not.toMatch(/<[a-zA-Z/][^>]*>/)
        }
    })

    test('parses an already-extracted fragment (no <article> wrapper)', () => {
        const fragment = htmlToBlocks('<p>Hello</p><h3>World</h3>')
        expect(fragment.map(b => b.type)).toEqual(['p', 'h3'])
    })
})

describe('htmlToBlocks (live minibits.cash/terms)', () => {
    // Fetching the live page is what catches an unexpected change to the Terms
    // markup. Generous timeout for CI networks.
    jest.setTimeout(30000)

    let blocks: Block[] = []
    let fetchError: Error | undefined

    beforeAll(async () => {
        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 25000)
            const response = await fetch(TERMS_URL, { signal: controller.signal })
            const html = await response.text()
            clearTimeout(timeout)
            expect(html).toContain('<article')
            blocks = htmlToBlocks(html)
        } catch (e: any) {
            fetchError = e
        }
    })

    test('the live page is reachable', () => {
        // If this fails the Terms page is unreachable or moved — surface it.
        expect(fetchError).toBeUndefined()
    })

    test('parses into a substantial, well-formed document', () => {
        expect(blocks.length).toBeGreaterThan(40)
    })

    test('contains the expected structural block types', () => {
        const present = new Set(blocks.map(b => b.type))
        for (const type of ['h2', 'h3', 'p', 'li', 'quote', 'hr']) {
            expect(present.has(type as Block['type'])).toBe(true)
        }
    })

    test('no unparsed HTML tags leak into rendered text', () => {
        // The strongest guard: a new/changed element the parser does not handle
        // would surface as literal "<tag>" inside a text segment.
        const leaking = blocks.filter(b => /<[a-zA-Z/][^>]*>/.test(textOf(b)))
        expect(leaking.map(textOf)).toEqual([])
    })

    test('still links to the Privacy Policy', () => {
        const hrefs = blocks
            .flatMap(b => (b.type === 'hr' ? [] : b.segments))
            .map(s => s.href)
            .filter(Boolean)
        expect(hrefs.some(h => h!.includes('minibits.cash/privacy'))).toBe(true)
    })
})
