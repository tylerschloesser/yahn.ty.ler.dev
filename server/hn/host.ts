/** Display host for a story url, `www.` stripped and lowercased. */
export function hostFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname
  } catch {
    return null
  }
}
