import type { Item } from './types.ts'

// SQLite's datetime('now') is UTC without a zone marker.
export function ago(created: string, now = Date.now()): string {
  const minutes = Math.max(0, (now - Date.parse(created.replace(' ', 'T') + 'Z')) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${Math.round(minutes)}m ago`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1440)}d ago`
}

// Links come from agents, so only http(s) may become an href.
export const safeUrl = (url?: string | null): string => (/^https?:\/\//i.test(url ?? '') ? url! : '')

export const linkLabel = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

export const projectName = (dir: string): string => dir.split('/').filter(Boolean).pop() || dir

export function statusText(item: Pick<Item, 'status' | 'status_reason'>): { label: string; note: string | null } {
  const reason = item.status_reason
  if (item.status === 'ready') return { label: reason || 'Ready', note: null }
  if (!reason) return { label: 'Waiting', note: null }
  return { label: 'Waiting', note: reason.replace(/^poll error: /, 'Last check failed: ') }
}
