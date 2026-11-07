import { useMemo, useState } from 'react'
import { BookOpen, RotateCw } from 'lucide-react'
import type { Chapter } from '@/types'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { useShell } from '@/components/shell/shellContext'
import { chapterVersions, versionName } from './chapterVersions'

interface Props {
  chapters:  Chapter[]
  /** version = the folder the chapter is in (« VF », « VF Noir et blanc »), for the reader */
  onRead:    (chapterId: string, version?: string) => void
  onScan:    () => void
  scanning:  boolean
}

const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))

function kindOf(path: string): 'PDF' | 'CBZ' | null {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'PDF'
  if (ext === 'cbz' || ext === 'zip') return 'CBZ'
  return null
}

/** Chapters of a manga: sorted by number, click to read; clear empty state.
 *  Several versions (VF / VOSTFR, colour / black & white): one at a time, chosen on top. */
export default function ChaptersSection({ chapters, onRead, onScan, scanning }: Props) {
  const [desc, setDesc] = useState(false)
  const phone = useShell().device === 'phone'
  const versions = useMemo(() => chapterVersions(chapters), [chapters])
  const [picked, setPicked] = useState<string | null>(null)
  const version = picked && versions.includes(picked) ? picked : versions[0] ?? null
  const shown = useMemo(() => (version ? chapters.filter((c) => c.language === version) : chapters), [chapters, version])
  const sorted = useMemo(
    () => [...shown].sort((a, b) => (desc ? -1 : 1) * (a.chapterNumber - b.chapterNumber || a.folderPath.localeCompare(b.folderPath, undefined, { numeric: true }))),
    [shown, desc],
  )

  if (chapters.length === 0) {
    return (
      <section className="bg-surface rounded-card mb-10">
        <EmptyState
          icon={<BookOpen strokeWidth={1.25} />}
          title="Aucun chapitre trouvé"
          message={<>Range les chapitres dans le dossier du manga : un dossier d’images par chapitre, ou des fichiers <span className="font-mono">.pdf</span> / <span className="font-mono">.cbz</span>. Lance ensuite une analyse.</>}
          action={<Button variant="primary" icon={<RotateCw size={14} strokeWidth={1.75} />} loading={scanning} onClick={onScan}>Analyser les chapitres</Button>}
        />
      </section>
    )
  }

  return (
    <div className="mb-10">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-title text-label">Chapitres</h2>
          <p className="text-subhead text-label2 mt-0.5 tabular">{shown.length} chapitre{shown.length > 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="plain" onClick={() => setDesc((d) => !d)} aria-label={desc ? 'Trier du premier au dernier' : 'Trier du dernier au premier'}>
            {desc ? 'Du plus récent' : 'Dans l’ordre'}
          </Button>
          <Button variant="primary" icon={<BookOpen size={14} strokeWidth={1.75} />} onClick={() => onRead(sorted[desc ? sorted.length - 1 : 0].id, version ?? undefined)}>
            Commencer
          </Button>
        </div>
      </div>
      {versions.length > 1 && (
        <SegmentedControl label="Version" value={version ?? ''} onChange={setPicked} full={phone} className="mb-3"
          options={versions.map((v) => ({ value: v, label: versionName(v, versions) }))} />
      )}
      <Group>
        {sorted.map((c) => (
          <ListRow
            key={c.id}
            onClick={() => onRead(c.id, version ?? undefined)}
            title={c.title || `Chapitre ${formatNumber(c.chapterNumber)}`}
            detail={[kindOf(c.folderPath), c.pageCount ? `${c.pageCount} p.` : null].filter(Boolean).join(' · ')}
            accessory="chevron"
          />
        ))}
      </Group>
    </div>
  )
}
