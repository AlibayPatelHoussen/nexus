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
    <div
      role="alert"
      className="flex items-start gap-2.5 px-4 py-3 text-[12.5px] leading-relaxed"
      style={{ background: 'var(--orange-dim)', color: 'var(--orange)', borderBottom: '1px solid var(--border)' }}
    >
      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
      <div>
        <strong>Le serveur n'est pas à jour.</strong>{' '}
        L'interface est en version <span className="font-mono">{FRONTEND_COMMIT}</span> mais le backend
        tourne {data?.build?.commit
          ? <>en version <span className="font-mono">{data.build.commit}</span></>
          : 'sur une ancienne version'}.
        {' '}La lecture et d'autres fonctions peuvent échouer. Sur le serveur, lance{' '}
        <span className="font-mono">bash scripts/deploy.sh</span> et vérifie qu'il se termine par « Deployment complete ».
      </div>
    </div>
  )
}
