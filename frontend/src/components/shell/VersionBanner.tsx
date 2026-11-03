import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { FRONTEND_COMMIT, getServerHealth, isBackendOutdated } from '@/services/versionService'

/** Warns when the backend is not running the same build as the UI. */
export default function VersionBanner() {
  const { data } = useQuery({
    queryKey: ['server-health'],
    queryFn:  getServerHealth,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  if (!isBackendOutdated(data)) return null

  return (
    <div role="alert" className="flex items-start gap-2.5 px-4 py-2.5 text-subhead bg-surface hairline-b">
      <AlertTriangle size={16} strokeWidth={1.75} className="flex-shrink-0 mt-px text-warn" aria-hidden="true" />
      <p className="text-label2">
        <strong className="font-semibold text-label">Le serveur n’est pas à jour.</strong>{' '}
        L’interface est en version <span className="font-mono">{FRONTEND_COMMIT}</span>, le serveur {data?.build?.commit
          ? <>en version <span className="font-mono">{data.build.commit}</span></>
          : 'sur une ancienne version'}. Certaines fonctions, dont la lecture, peuvent échouer. Sur le serveur, lance{' '}
        <span className="font-mono">bash scripts/deploy.sh</span> et vérifie qu’il se termine par « Deployment complete ».
      </p>
    </div>
  )
}
