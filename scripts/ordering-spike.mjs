/**
 * Does Algolia's nested `children` preserve HN's ranked display order?
 *
 * Ground truth is news.ycombinator.com's own HTML, which renders the comment
 * tree as a flat DFS sequence of rows carrying an `indent` level; rebuilding
 * the tree from (id, indent) recovers the exact per-parent child order HN
 * displays. Against that it checks three things per thread: whether every
 * Algolia `children` array is strictly ascending by id, whether Firebase's
 * `kids` agrees with HN's displayed top level, and whether HN's own order is
 * chronological (it is not — which is what makes the first question matter).
 *
 * Run: `node scripts/ordering-spike.mjs <storyId> [storyId...]`
 * The answer as of 2026-09-05, and what it decided, is in
 * `.claude/rules/hn-data.md`. Re-run this rather than re-deriving it.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const sortedAsc = (a) => a.every((v, i) => i === 0 || a[i - 1] < v)

function parse(html) {
  const re = /<tr class=["']athing comtr["'] id=["'](\d+)["']>[\s\S]{0,400}?<td class=["']ind["'] indent=["'](\d+)["']>/g
  const seq = [...html.matchAll(re)].map((m) => ({ id: +m[1], indent: +m[2] }))
  const children = new Map(); const stack = []
  for (const { id, indent } of seq) {
    const p = indent === 0 ? 0 : stack[indent - 1] ?? 0
    ;(children.get(p) ?? children.set(p, []).get(p)).push(id)
    stack[indent] = id; stack.length = indent + 1
  }
  return children
}
function alMap(node, out = new Map(), root = true) {
  const ids = (node.children ?? []).map((c) => c.id)
  out.set(root ? 0 : node.id, ids)
  for (const c of node.children ?? []) alMap(c, out, false)
  return out
}

for (const id of process.argv.slice(2)) {
  const [html, al, fb] = await Promise.all([
    fetch(`https://news.ycombinator.com/item?id=${id}`, { headers: { 'user-agent': UA } }).then((r) => r.text()),
    fetch(`https://hn.algolia.com/api/v1/items/${id}`).then((r) => r.json()),
    fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((r) => r.json()),
  ])
  const hn = parse(html), a = alMap(al)
  // 1. Is every Algolia children array ascending by id?
  let lists = 0, asc = 0
  for (const ids of a.values()) { if (ids.length < 2) continue; lists++; if (sortedAsc(ids)) asc++ }
  // 2. Firebase kids vs HN top level, positionally
  const hnTop = hn.get(0) ?? [], fbKids = fb.kids ?? []
  const shared = new Set(fbKids.filter((x) => hnTop.includes(x)))
  const A = hnTop.filter((x) => shared.has(x)), B = fbKids.filter((x) => shared.has(x))
  let firstDiff = -1
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) { firstDiff = i; break }
  // 3. Is HN's *displayed* top level ascending by id? (i.e. is ranked order == chronological?)
  console.log(`\n${id}: html-top=${hnTop.length} fb-kids=${fbKids.length} shared=${shared.length ?? shared.size}`)
  console.log(`  algolia children lists (len>=2): ${asc}/${lists} strictly ascending by id`)
  console.log(`  fb kids vs HN top: ${firstDiff < 0 ? 'identical' : `first difference at index ${firstDiff} of ${A.length}`}`)
  console.log(`  HN top level itself ascending by id? ${sortedAsc(hnTop)}`)
  if (firstDiff >= 0) console.log(`    hn: ${A.slice(Math.max(0,firstDiff-1), firstDiff+4)}\n    fb: ${B.slice(Math.max(0,firstDiff-1), firstDiff+4)}`)
}
