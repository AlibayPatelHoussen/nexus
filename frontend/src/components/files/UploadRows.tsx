import { X } from 'lucide-react'
import { formatBytes } from '@/utils'
import { timeLeft, type UploadJob } from '@/hooks/useUploads'

/** Rows of a grouped list: one per send in progress, with its bar and « Annuler ». */
export default function UploadRows({ jobs, onCancel }: { jobs: UploadJob[]; onCancel: (id: string) => void }) {
  return (
    <>
      {jobs.map((job) => {
        const percent = job.total ? Math.min(100, (job.loaded / job.total) * 100) : 0
        const saving = job.total > 0 && job.loaded >= job.total
        const left = timeLeft(job)
        const text = saving
          ? 'Enregistrement sur le serveur…'
          : [`${Math.floor(percent)} %`, `${formatBytes(job.loaded)} sur ${formatBytes(job.total)}`, left].filter(Boolean).join(' · ')
        return (
          <div key={job.id} role="listitem" className="nx-row relative flex items-center gap-3 pl-4 pr-2 min-h-row">
            <span className="flex-1 min-w-0 py-[9px] max-md:py-[11px]">
              <span className="block truncate text-label">{job.label}</span>
              <span className="block mt-1.5 h-[4px] rounded-full bg-fill overflow-hidden" role="progressbar" aria-label={`Envoi de ${job.label}`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
                <span className="block h-full rounded-full bg-accent transition-[width] duration-slow ease-out" style={{ width: `${Math.max(2, percent)}%` }} />
              </span>
              <span className="block mt-1 text-caption text-label2 tabular truncate" aria-live="polite">{text}</span>
            </span>
            <button type="button" className="w-11 h-11 flex-shrink-0 grid place-items-center rounded-full text-label2 hoverable pressable"
              onClick={() => onCancel(job.id)} aria-label={`Annuler l’envoi de ${job.label}`} title="Annuler">
              <X size={17} strokeWidth={1.75} />
            </button>
          </div>
        )
      })}
    </>
  )
}
