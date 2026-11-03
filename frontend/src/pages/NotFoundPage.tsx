import { useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <main className="min-h-[100dvh] grid place-items-center bg-bg gutter safe-x">
      <EmptyState
        icon={<Compass strokeWidth={1.25} />}
        title="Page introuvable"
        message={<>L’adresse <span className="font-mono">{window.location.pathname}</span> ne correspond à aucune page de Nexus.</>}
        action={
          <div className="flex gap-2 justify-center">
            <Button onClick={() => navigate(-1)}>Retour</Button>
            <Button variant="primary" onClick={() => navigate('/dashboard')}>Vue d’ensemble</Button>
          </div>
        }
      />
    </main>
  )
}
