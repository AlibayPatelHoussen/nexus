import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, Square, FileCode2, RefreshCw } from 'lucide-react'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

interface ScriptInfo {
  name:        string
  filename:    string
  path:        string
  description: string
  size:        number
  modified:    string
}

function ScriptCard({ script }: { script: ScriptInfo }) {
  const [running, setRunning] = useState(false)
  const [output,  setOutput]  = useState<string[]>([])
  const [showOut, setShowOut] = useState(false)
  const token = useAuthStore((s) => s.accessToken)

  async function run() {
    setRunning(true)
    setOutput([])
    setShowOut(true)

    try {
      const res = await fetch(`/api/scripts/${script.name}/run`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok || !res.body) throw new Error('Stream failed')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

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
              if (payload.data) {
                setOutput((prev) => [...prev, ...payload.data.split('\n').filter(Boolean)])
              }
            } catch {}
          }
          if (line.startsWith('event: exit')) {
            setRunning(false)
            toast.success(`${script.name} terminé`)
          }
          if (line.startsWith('event: error')) {
            setRunning(false)
            toast.error(`Erreur: ${script.name}`)
          }
        }
      }
    } catch (err) {
      setOutput((prev) => [...prev, `Erreur: ${err}`])
      toast.error('Erreur lors de l\'exécution')
    } finally {
      setRunning(false)
    }
  }

  const colorMap: Record<string, string> = {
    anisama: 'var(--teal)',
    films:   'var(--red)',
    movix:   'var(--orange)',
    youtube: 'var(--blue)',
  }
  const color = colorMap[script.name] || 'var(--purple)'

  return (
    <div className="card animate-fade-up overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}
        >
          <FileCode2 size={18} strokeWidth={1.8} style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold font-mono" style={{ color: 'var(--text)' }}>
            {script.filename}
          </div>
          <div className="text-[11.5px]" style={{ color: 'var(--text3)' }}>
            {script.description || script.path}
          </div>
        </div>
        {running && (
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--green)' }}>
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse-glow"
              style={{ background: 'var(--green)' }}
            />
            En cours…
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 p-3" style={{ background: 'var(--surface2)' }}>
        <button
          className="btn-primary text-[12.5px] flex-1 justify-center"
          onClick={run}
          disabled={running}
        >
          {running
            ? <><Square size={12} strokeWidth={2} /> En cours</>
            : <><Play   size={12} strokeWidth={2} /> Exécuter</>
          }
        </button>
        {output.length > 0 && (
          <button
            className="btn-ghost text-[12px] px-3"
            onClick={() => setShowOut(!showOut)}
          >
            {showOut ? 'Cacher logs' : 'Voir logs'}
          </button>
        )}
      </div>

      {/* Output */}
      {showOut && (
        <div className="border-t" style={{ borderColor: 'var(--border)' }}>
          <div
            className="flex items-center justify-between px-3 py-1.5 border-b"
            style={{ background: '#111118', borderColor: 'var(--border)' }}
          >
            <span className="text-[10.5px] font-mono" style={{ color: 'var(--text3)' }}>
              OUTPUT — {script.name}
            </span>
            <button
              className="text-[11px]"
              style={{ color: 'var(--text3)' }}
              onClick={() => setOutput([])}
            >
              Effacer
            </button>
          </div>
          <div
            className="p-3 overflow-y-auto terminal-font text-[11.5px]"
            style={{
              background:  '#09090e',
              color:       '#9191a8',
              lineHeight:  '1.7',
              maxHeight:   '280px',
            }}
          >
            {output.length === 0 ? (
              <span style={{ color: 'var(--text3)' }}>Aucun output</span>
            ) : (
              output.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all"
                  style={{
                    color: line.toLowerCase().includes('error') || line.toLowerCase().includes('traceback')
                      ? 'var(--red)'
                      : line.toLowerCase().includes('warning')
                      ? 'var(--yellow)'
                      : line.toLowerCase().includes('success') || line.startsWith('✓') || line.startsWith('[+]')
                      ? 'var(--green)'
                      : undefined,
                  }}
                >
                  {line || '\u00a0'}
                </div>
              ))
            )}
            {running && (
              <div className="flex items-center gap-1.5 mt-1" style={{ color: 'var(--blue)' }}>
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--blue)' }} />
                <span>En cours…</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ScriptsPage() {
  const { data: scripts = [], isLoading, refetch } = useQuery<ScriptInfo[]>({
    queryKey: ['scripts'],
    queryFn:  async () => {
      const { data } = await api.get<{ success: boolean; data: ScriptInfo[] }>('/scripts')
      return data.data
    },
  })

  return (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>
      <div className="sticky top-0 z-40 flex items-center justify-between px-7 pt-6 pb-1"
        style={{ background: 'var(--bg)' }}>
        <div>
          <h1 className="text-[26px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>Scripts</h1>
          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text3)' }}>
            Exécutez vos scripts Python depuis l'interface — output en temps réel
          </p>
        </div>
        <button className="btn-ghost text-[12.5px]" onClick={() => refetch()}>
          <RefreshCw size={13} strokeWidth={2} /> Actualiser
        </button>
      </div>

      <div className="px-7 py-5">
        {isLoading ? (
          <div className="flex justify-center items-center h-40">
            <div className="w-5 h-5 border-2 rounded-full animate-spin"
              style={{ borderColor: 'var(--border2)', borderTopColor: 'var(--blue)' }} />
          </div>
        ) : scripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3">
            <FileCode2 size={48} strokeWidth={1} style={{ color: 'var(--text3)' }} />
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Aucun script trouvé</p>
            <p className="text-[12px] text-center" style={{ color: 'var(--text3)' }}>
              Placez vos fichiers .py ou .sh dans<br />
              <span className="font-mono">/media/scripts/</span>
            </p>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
          >
            {scripts.map((script, i) => (
              <div key={script.name} style={{ animationDelay: `${i * 50}ms` }}>
                <ScriptCard script={script} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
