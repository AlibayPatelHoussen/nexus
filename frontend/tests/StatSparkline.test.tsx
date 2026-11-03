import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatSparkline, { CapacityBar } from '@/components/ui/StatSparkline'

describe('StatSparkline', () => {
  it('is labelled for screen readers', () => {
    render(<StatSparkline values={[10, 20, 30]} max={100} label="Processeur" />)
    expect(screen.getByRole('img', { name: 'Processeur' })).toBeDefined()
  })
  it('draws a line and an area once there are two samples', () => {
    const { container } = render(<StatSparkline values={[10, 40]} max={100} label="x" />)
    expect(container.querySelectorAll('path').length).toBe(2)
  })
  it('draws only the grid with a single sample', () => {
    const { container } = render(<StatSparkline values={[10]} max={100} label="x" />)
    expect(container.querySelectorAll('path').length).toBe(0)
  })
  it('adds the secondary series', () => {
    const { container } = render(<StatSparkline values={[1, 2]} secondary={[1, 1]} label="x" />)
    expect(container.querySelectorAll('path').length).toBe(3)
  })
})

describe('CapacityBar', () => {
  it('exposes its value as a meter', () => {
    render(<CapacityBar percent={62.4} label="Disque" />)
    const m = screen.getByRole('meter', { name: 'Disque' })
    expect(m.getAttribute('aria-valuenow')).toBe('62')
  })
})
