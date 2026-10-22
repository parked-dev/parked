import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, fetchState, post } from '@/lib/api'
import type { State } from '@/lib/types'

const POLL_MS = 10_000

export function useParked() {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const token = useRef('')

  const apply = useCallback((s: State) => {
    token.current = s.token
    setState(s)
    setError(null)
  }, [])

  const refresh = useCallback(async () => {
    try {
      apply(await fetchState())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [apply])

  // Poll only while the tab is visible, and catch up as soon as it becomes visible again.
  useEffect(() => {
    refresh()
    const tick = () => { if (!document.hidden) refresh() }
    const id = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh])

  // A restarted server issues a new token; on 403 fetch the new one and retry once.
  const act = useCallback(async (path: string) => {
    try {
      await post(path, token.current)
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 403) throw e
      const fresh = await fetchState()
      apply(fresh)
      await post(path, fresh.token)
    }
  }, [apply])

  const resume = useCallback((id: number) => act(`/api/items/${id}/resume`), [act])

  const done = useCallback(async (id: number) => {
    setState((s) => s && { ...s, items: s.items.filter((i) => i.id !== id) })
    try {
      await act(`/api/items/${id}/done`)
    } catch (e) {
      await refresh()
      throw e
    }
  }, [act, refresh])

  return { items: state?.items ?? null, error, resume, done }
}
