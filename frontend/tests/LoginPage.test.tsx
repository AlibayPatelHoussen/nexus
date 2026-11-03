import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import LoginPage from '@/pages/login/LoginPage'

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('LoginPage', () => {
  it('renders the sign-in form with labelled fields', () => {
    render(<LoginPage />, { wrapper: Wrapper })
    expect(screen.getByRole('heading', { name: 'Se connecter à Nexus' })).toBeDefined()
    expect(screen.getByLabelText('Identifiant')).toBeDefined()
    expect(screen.getByLabelText('Mot de passe')).toBeDefined()
  })

  it('disables the button until both fields are filled', () => {
    render(<LoginPage />, { wrapper: Wrapper })
    const button = screen.getByRole('button', { name: 'Se connecter' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('toggles the password visibility', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    render(<LoginPage />, { wrapper: Wrapper })
    const pass = screen.getByLabelText('Mot de passe') as HTMLInputElement
    expect(pass.type).toBe('password')
    await userEvent.click(screen.getByRole('button', { name: 'Afficher le mot de passe' }))
    expect(pass.type).toBe('text')
  })
})
