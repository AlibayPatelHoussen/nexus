import { describe, it, expect, vi } from 'vitest'
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
  it('renders the login form', () => {
    render(<LoginPage />, { wrapper: Wrapper })
    expect(screen.getByText('Nexus')).toBeDefined()
    expect(screen.getByPlaceholderText('username ou email')).toBeDefined()
    expect(screen.getByPlaceholderText('••••••••')).toBeDefined()
  })

  it('renders the submit button', () => {
    render(<LoginPage />, { wrapper: Wrapper })
    expect(screen.getByText('Se connecter')).toBeDefined()
  })
})
