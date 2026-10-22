import type { ReactNode } from 'react'
import { CircleAlertIcon, InboxIcon, PauseCircleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemCard } from '@/components/item-card'
import { useParked } from '@/hooks/use-parked'
import type { Item } from '@/lib/types'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        <Badge variant="secondary">{count}</Badge>
      </h2>
      {children}
    </section>
  )
}

function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export default function App() {
  const { items, error, resume, done } = useParked()

  const onResume = async (id: number) => {
    try {
      await resume(id)
      toast.success('Opening Ghostty…')
    } catch (e) {
      toast.error(`Could not resume: ${message(e)}`)
    }
  }
  const onDone = async (id: number) => {
    try {
      await done(id)
      toast.success('Done and removed')
    } catch (e) {
      toast.error(`Could not mark done: ${message(e)}`)
    }
  }

  const ready = items?.filter((i) => i.status === 'ready') ?? []
  const waiting = items?.filter((i) => i.status === 'waiting') ?? []
  const cards = (list: Item[]) => list.map((i) => <ItemCard key={i.id} item={i} onResume={onResume} onDone={onDone} />)

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3.5">
          <span aria-hidden className="size-2.5 rounded-full bg-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Parked</h1>
          {items && (
            <div className="ml-auto flex items-center gap-1.5">
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">{ready.length} ready</Badge>
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">{waiting.length} waiting</Badge>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-6">
        {error && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Can’t reach the parked server</AlertTitle>
            <AlertDescription>
              Is <code>node web.js</code> still running?{items ? ' Showing the last known items.' : ''} ({error})
            </AlertDescription>
          </Alert>
        )}

        {items === null && !error ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : items && (
          <>
            <Section title="Ready for you" count={ready.length}>
              {ready.length ? cards(ready) : (
                <EmptyState icon={<InboxIcon />} title="Nothing is waiting on you">
                  Items show up here once a PR is approved or merged, or when it needs your next step.
                </EmptyState>
              )}
            </Section>
            <Section title="Waiting on others" count={waiting.length}>
              {waiting.length ? cards(waiting) : (
                <EmptyState icon={<PauseCircleIcon />} title="No parked work">
                  Agents add items here when they pause on something external, like a PR review, a deploy or a teammate’s reply.
                </EmptyState>
              )}
            </Section>
          </>
        )}
      </main>
    </div>
  )
}
