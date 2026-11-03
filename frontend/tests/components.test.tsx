import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Toggle from '@/components/ui/Toggle'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { Group, ListRow } from '@/components/ui/GroupedList'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'

describe('Toggle', () => {
  it('is a switch that flips its state', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} label="Notifications" />)
    const sw = screen.getByRole('switch', { name: 'Notifications' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('SegmentedControl', () => {
  function Demo() {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a')
    return <SegmentedControl label="Apparence" value={v} onChange={setV} options={[{ value: 'a', label: 'Auto' }, { value: 'b', label: 'Clair' }, { value: 'c', label: 'Sombre' }]} />
  }
  it('selects with a click and with the arrow keys', () => {
    render(<Demo />)
    const group = screen.getByRole('radiogroup', { name: 'Apparence' })
    fireEvent.click(screen.getByRole('radio', { name: 'Clair' }))
    expect(screen.getByRole('radio', { name: 'Clair' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Sombre' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('GroupedList', () => {
  it('renders a labelled list of rows with values and links', () => {
    render(
      <MemoryRouter>
        <Group header="Système" id="sys">
          <ListRow title="Nom" detail="houssen-serveur" />
          <ListRow title="Fichiers" to="/files" accessory="chevron" />
        </Group>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Système' })).toBeDefined()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('houssen-serveur')).toBeDefined()
    expect(screen.getByText('Fichiers').closest('a')?.getAttribute('href')).toBe('/files')
  })
})

describe('EmptyState and Button', () => {
  it('announces errors and shows the action', () => {
    const onClick = vi.fn()
    render(<EmptyState tone="error" title="Bibliothèque indisponible" message="Le serveur n’a pas répondu." action={<Button onClick={onClick}>Réessayer</Button>} />)
    expect(screen.getByRole('alert')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(onClick).toHaveBeenCalled()
  })
  it('a loading button is disabled', () => {
    render(<Button loading>Envoyer</Button>)
    expect((screen.getByRole('button', { name: /Envoyer/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
