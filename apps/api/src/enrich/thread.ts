import { createHash } from 'node:crypto'
import type { Comment, Story } from '@yahn/schema'

/**
 * How much of a thread goes to the model. `full` and `top-level` are the two
 * obvious baselines; `budget` is the one this epoch actually has to measure —
 * see `EnrichmentInputSchema` in `@yahn/schema` for why every stored summary
 * records which of these produced it.
 */
export type SelectionStrategy = 'full' | 'top-level' | 'budget'

export interface RenderOptions {
  strategy: SelectionStrategy
  /** Only meaningful for 'budget'. */
  budgetChars?: number
}

export interface RenderedThread {
  /** The exact text sent to the model. */
  text: string
  strategy: string
  /** Comments actually rendered. */
  comments: number
  /** Every node in the supplied tree, tombstones included. */
  totalComments: number
  /** `text.length`. */
  chars: number
}

const DEFAULT_BUDGET_CHARS = 40_000

/**
 * `sha256(text)` hex, first 16 chars — same shape as `contentKey` in
 * `packages/hn`, but keyed on the model input rather than the story, per the
 * comment on `ThreadSummarySchema.inputKey` in `@yahn/schema`.
 */
export function inputKey(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/**
 * HN `text` fields are HTML fragments (see docs/hn-api.md around line 130),
 * and there is no DOMParser in Node, so this is string work rather than a
 * real parse. `<p>`/`<br>` are the only tags with rendering meaning here;
 * everything else is dropped, keeping its inner text (an `<a href>` keeps
 * only its link text).
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\/?p(?:\s[^>]*)?>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
  const stripped = withBreaks.replace(/<[^>]+>/g, '')
  const decoded = stripped
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&nbsp;/g, ' ')
    // Last, deliberately: decoding this first would turn a literal
    // `&amp;lt;` into `<` instead of the `&lt;` it actually encodes.
    .replace(/&amp;/g, '&')
  return decoded.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * The tree with tombstones (`deleted` or `dead`) spliced out and their
 * children promoted to the tombstone's own position. docs/hn-api.md's
 * "Deleted and dead tombstones" section is explicit that a tombstone with
 * live children is normal HN behavior, not corruption — so its subtree is
 * real content and must render at the depth the tombstone itself occupied,
 * not one level deeper under a placeholder that never prints.
 */
interface Node {
  comment: Comment
  children: Node[]
}

function buildTree(comments: Comment[]): Node[] {
  const nodes: Node[] = []
  for (const comment of comments) {
    const children = buildTree(comment.children)
    if (comment.deleted || comment.dead) {
      nodes.push(...children)
    } else {
      nodes.push({ comment, children })
    }
  }
  return nodes
}

/** Every node including tombstones — the fixed denominator strategies are judged against. */
function countAll(comments: Comment[]): number {
  let total = 0
  for (const comment of comments) {
    total += 1 + countAll(comment.children)
  }
  return total
}

interface Line {
  id: number
  by: string | null
  text: string | null
  depth: number
}

function renderLine(line: Line): string {
  const indent = '  '.repeat(line.depth)
  const body = htmlToText(line.text ?? '')
  // Re-indent the comment's own internal breaks to its depth so a multi-line
  // comment stays legible instead of its continuation falling to column zero.
  const indented = body.split('\n').join('\n' + indent)
  return `${indent}[${line.id}] ${line.by ?? 'unknown'}: ${indented}`
}

function nodeToLine(node: Node, depth: number): Line {
  return { id: node.comment.id, by: node.comment.by, text: node.comment.text, depth }
}

/**
 * Tree-order (depth-first, sibling order preserved) walk, optionally gated by
 * an admitted-id predicate. `null` means "render everything" (the `full`
 * strategy); `budget` passes a predicate instead. A node that fails the
 * predicate is skipped along with its whole subtree, never just itself —
 * a comment whose parent wasn't admitted isn't rendered either.
 */
function collect(nodes: Node[], depth: number, admitted: ((id: number) => boolean) | null, out: Line[]): void {
  for (const node of nodes) {
    if (admitted !== null && !admitted(node.comment.id)) continue
    out.push(nodeToLine(node, depth))
    collect(node.children, depth + 1, admitted, out)
  }
}

/**
 * Breadth-first admission: all of depth 0 in tree order, then all of depth 1,
 * and so on, stopping the instant the running character total would exceed
 * `budgetChars`. This is a separate pass from `collect` above (which then
 * re-renders the admitted set in tree order) because BFS order and render
 * order are different things — BFS is what makes the budget spend itself on
 * HN's highest-ranked threads first, since depth 0 is already ranked order.
 */
function selectBudget(roots: Node[], budgetChars: number): (id: number) => boolean {
  const admitted = new Set<number>()
  let total = 0
  let seenAny = false
  const queue: { node: Node; depth: number }[] = roots.map((node) => ({ node, depth: 0 }))
  let i = 0
  while (i < queue.length) {
    const { node, depth } = queue[i]
    i++
    const cost = renderLine(nodeToLine(node, depth)).length + 1
    if (!seenAny) {
      // A non-empty thread must never render zero comments, even when the
      // very first one alone blows the budget.
      admitted.add(node.comment.id)
      total += cost
      seenAny = true
    } else if (total + cost <= budgetChars) {
      admitted.add(node.comment.id)
      total += cost
    } else {
      // Stop admitting entirely rather than skipping this one and scanning
      // deeper for something that fits — simpler, and nothing in the spec
      // requires squeezing in a smaller comment from later in the queue.
      break
    }
    queue.push(...node.children.map((child) => ({ node: child, depth: depth + 1 })))
  }
  return (id: number) => admitted.has(id)
}

export function renderThread(story: Story, comments: Comment[], options: RenderOptions): RenderedThread {
  const tree = buildTree(comments)
  const totalComments = countAll(comments)

  const lines: Line[] = []
  if (options.strategy === 'full') {
    collect(tree, 0, null, lines)
  } else if (options.strategy === 'top-level') {
    for (const node of tree) {
      lines.push(nodeToLine(node, 0))
    }
  } else {
    const admitted = selectBudget(tree, options.budgetChars ?? DEFAULT_BUDGET_CHARS)
    collect(tree, 0, admitted, lines)
  }

  const headerLines: string[] = [`Story: ${story.title}`]
  if (story.url !== null) headerLines.push(`URL: ${story.url}`)
  const scoreParts: string[] = []
  if (story.score !== null) scoreParts.push(`Score: ${story.score}`)
  if (story.descendants !== null) scoreParts.push(`Comments: ${story.descendants}`)
  if (scoreParts.length > 0) headerLines.push(scoreParts.join(' | '))

  const blocks: string[] = [headerLines.join('\n')]
  if (story.text !== null) blocks.push(htmlToText(story.text))
  blocks.push(`Comments (${lines.length} of ${totalComments} shown):`)
  if (lines.length > 0) blocks.push(lines.map(renderLine).join('\n'))

  const text = blocks.join('\n\n')

  return {
    text,
    strategy: options.strategy,
    comments: lines.length,
    totalComments,
    chars: text.length,
  }
}
