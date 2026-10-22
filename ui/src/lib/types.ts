export type Item = {
  id: number
  created_at: string
  project_dir: string
  session_id: string | null
  resume_mode: 'id' | 'continue'
  waiting_on: string
  link: string | null
  watch: { type: string; url: string } | null
  next_steps: string[]
  resume_context: string
  status: 'waiting' | 'ready'
  status_reason: string | null
}

export type State = { token: string; items: Item[] }
