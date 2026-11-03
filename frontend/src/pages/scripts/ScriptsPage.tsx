import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileCode2, RotateCw } from 'lucide-react'
import { api, getFreshAccessToken } from '@/services/api'
import toast from 'react-hot-toast'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import Spinner from '@/components/ui/Spinner'
import { cn } from '@/utils'

interface ScriptInfo {
  name:        string
  filename:    string
  path:        string
  description: string
  size:        number
  modified:    string
}

interface Run { script: string; lines: string[]; state: 'running' | 'done' | 'error' }

/** Runs a script and streams its output (server-sent events) into `onLine`. */
async function runScript(filename: string, onLine: (lines: string[]) => void): Promise<'done' | 'error'> {
  const token = await getFreshAccessToken()
  const res = await fetch(`/api/scripts/${encodeURIComponent(filename)}/run`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok || !res.body) throw new Error(`le serveur a répondu ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: 'done' | 'error' = 'done'
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data:')) {
        try {
          const payload = JSON.parse(line.slice(5).trim())
          if (payload.data) onLine(String(payload.data).split('\n').filter(Boolean))
        } catch { /* malformed SSE line */ }
      }
      if (line.startsWith('event: error')) result = 'error'
    }
  }
  return result
}

export default function ScriptsPage() {
  const { device } = useShell()
  const phone = device === 'phone'
  const [run, setRun] = useState<Run | null>(null)
  const { data: scripts = [], isLoading, isError, refetch, isFetching } = useQuery<ScriptInfo[]>({
    queryKey: ['scripts'],
    queryFn:  async () => {
      const { data } = await api.get<{ success: boolean; data: ScriptInfo[] }>('/scripts')
      return data.data
    },
  })
  const running = run?.state === 'running'

  async function start(script: ScriptInfo) {
    setRun({ script: script.filename, lines: [], state: 'running' })
    try {
      const state = await runScript(script.filename, (lines) => setRun((r) => r && { ...r, lines: [...r.lines, ...lines] }))
      setRun((r) => r && { ...r, state })
      if (state === 'done') toast.success(`${script.filename} terminé`)
      else toast.error(`${script.filename} s’est terminé avec une erreur`)
    } catch (err) {
      setRun((r) => r && { ...r, state: 'error', lines: [...r.lines, `Impossible de lancer le script : ${(err as Error).message}`] })
    }
  }

  const refresh = (
    <button type="button" className={phone ? 'w-11 h-11 grid place-items-center text-accent-text active:opacity-50' : 'w-8 h-8 grid place-items-center rounded-[6px] text-label2 hoverable'}
      onClick={() => refetch()} aria-label="Actualiser" title="Actualiser">
      <RotateCw size={phone ? 22 : 16} strokeWidth={phone ? 1.75 : 1.5} className={isFetching ? 'animate-spin' : ''} />
    </button>
  )

  return (
    <Page title="Scripts" subtitle="Lance les scripts du dossier /media/scripts et suis leur sortie en direct" actions={refresh} narrow>
      <div className="flex flex-col gap-8 max-w-[860px] mx-auto">
        {isLoading ? <SkeletonRows rows={3} /> : isError ? (
          <EmptyState tone="error" icon={<FileCode2 strokeWidth={1.25} />} title="Scripts indisponibles" message="Le serveur n’a pas répondu. Réessaie dans un instant." />
        ) : scripts.length === 0 ? (
          <EmptyState icon={<FileCode2 strokeWidth={1.25} />} title="Aucun script" message={<>Place des fichiers <span className="font-mono">.py</span> ou <span className="font-mono">.sh</span> dans <span className="font-mono">/media/scripts/</span>.</>} />
        ) : (
          <Group>
            {scripts.map((s) => {
              const mine = run?.script === s.filename
              return (
                <ListRow
                  key={s.filename}
                  icon={<FileCode2 strokeWidth={1.5} />}
                  title={<span className="font-mono">{s.filename}</span>}
                  subtitle={s.description || s.path}
                >
                  {mine && running ? (
                    <span className="flex items-center gap-1.5 text-subhead text-label2"><Spinner size={14} /> En cours</span>
                  ) : (
                    <Button size="small" variant={mine ? 'secondary' : 'primary'} disabled={running} onClick={() => start(s)}>Exécuter</Button>
                  )}
                </ListRow>
              )
            })}
          </Group>
        )}

        {run && (
          <section aria-label="Sortie du script">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <h2 className="text-subhead text-label2">
                Sortie de <span className="font-mono text-label">{run.script}</span> · {run.state === 'running' ? 'en cours' : run.state === 'done' ? 'terminé' : 'erreur'}
              </h2>
              {!running && <Button variant="plain" size="small" onClick={() => setRun(null)}>Effacer</Button>}
            </div>
            <div className="rounded-[10px] p-3 max-h-[50vh] overflow-auto font-mono text-[12px] leading-relaxed" style={{ background: 'var(--term-bg)', color: 'var(--term-fg)', boxShadow: 'inset 0 0 0 .5px var(--separator)' }} aria-live="polite">
              {run.lines.length === 0 ? <span className="text-label2">{running ? 'En attente de la sortie…' : 'Le script n’a rien affiché.'}</span> : run.lines.map((line, i) => (
                <div key={i} className={cn('whitespace-pre-wrap break-all', /error|traceback|erreur/i.test(line) && 'text-danger-text', /warning/i.test(line) && 'text-warn-text')}>
                  {line || '\u00a0'}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Page>
  )
}
