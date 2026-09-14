/**
 * `story.text` and `comment.text` are HN-flavored HTML fragments, not plain
 * text. This rebuilds the fragment from an allowlist rather than trusting it
 * verbatim, so it is safe to hand to `dangerouslySetInnerHTML`.
 */

const ALLOWED_TAGS = new Set(['P', 'I', 'B', 'EM', 'STRONG', 'CODE', 'PRE', 'BLOCKQUOTE', 'A', 'BR'])

export function sanitizeHnHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  sanitizeChildren(doc.body)
  return doc.body.innerHTML
}

function sanitizeChildren(parent: Element): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue
    if (child.nodeType !== Node.ELEMENT_NODE) {
      parent.removeChild(child)
      continue
    }
    const element = child as Element
    if (!ALLOWED_TAGS.has(element.tagName)) {
      parent.replaceChild(element.ownerDocument.createTextNode(element.textContent ?? ''), element)
      continue
    }
    sanitizeAttributes(element)
    sanitizeChildren(element)
  }
}

function sanitizeAttributes(element: Element): void {
  const href = element.tagName === 'A' ? element.getAttribute('href') : null
  for (const attribute of Array.from(element.attributes)) {
    element.removeAttribute(attribute.name)
  }
  if (element.tagName !== 'A' || !href || !isHttpUrl(href)) return
  element.setAttribute('href', href)
  element.setAttribute('rel', 'nofollow noreferrer')
}

function isHttpUrl(href: string): boolean {
  try {
    const url = new URL(href, window.location.origin)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
