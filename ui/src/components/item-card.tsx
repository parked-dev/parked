import { useState } from 'react'
import { ArrowRightIcon, CheckIcon, ExternalLinkIcon, FolderIcon, Loader2Icon, PlayIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { ago, linkLabel, projectName, safeUrl, statusText } from '@/lib/format'
import type { Item } from '@/lib/types'

const TONE = {
  ready: { bar: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  waiting: { bar: 'bg-amber-500', badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
} as const

type Props = {
  item: Item
  onResume: (id: number) => Promise<void>
  onDone: (id: number) => Promise<void>
}

export function ItemCard({ item, onResume, onDone }: Props) {
  const [busy, setBusy] = useState<'resume' | 'done' | null>(null)
  const tone = TONE[item.status]
  const { label, note } = statusText(item)
  const url = safeUrl(item.link)

  const run = (kind: 'resume' | 'done', fn: (id: number) => Promise<void>) => async () => {
    setBusy(kind)
    try {
      await fn(item.id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="relative pl-1">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
      <CardHeader>
        <CardTitle className="text-base leading-snug">{item.waiting_on}</CardTitle>
        <CardAction className="text-xs text-muted-foreground">{ago(item.created_at)}</CardAction>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge className={tone.badge}>{label}</Badge>
          <Badge variant="outline" title={item.project_dir}>
            <FolderIcon />
            {projectName(item.project_dir)}
          </Badge>
          {url && (
            <Badge variant="outline" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon />
                {linkLabel(url)}
              </a>
            </Badge>
          )}
        </div>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </CardHeader>

      {(item.resume_context || item.next_steps.length > 0) && (
        <CardContent className="flex flex-col gap-3">
          {item.resume_context && <p className="whitespace-pre-wrap text-muted-foreground">{item.resume_context}</p>}
          {item.next_steps.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {item.next_steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <ArrowRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}

      <CardFooter className="gap-2 border-t-0 bg-transparent pt-0">
        <Button onClick={run('resume', onResume)} disabled={busy !== null}>
          {busy === 'resume' ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
          Resume session
        </Button>
        <Button variant="outline" onClick={run('done', onDone)} disabled={busy !== null}>
          {busy === 'done' ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
          Mark done
        </Button>
      </CardFooter>
    </Card>
  )
}
