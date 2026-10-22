import type { State } from './types.ts'

export async function fetchState(): Promise<State> {
  const res = await fetch('/api/state')
  if (!res.ok) throw new Error(`Server returned ${res.status}`)
  return res.json()
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function post(path: string, token: string): Promise<void> {
  const res = await fetch(path, { method: 'POST', headers: { 'x-parked-token': token }, body: '{}' })
  if (res.ok) return
  const body = await res.json().catch(() => ({}))
  throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status)
}
