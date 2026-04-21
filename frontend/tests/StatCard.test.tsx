import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Cpu } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'

describe('StatCard', () => {
  const defaultProps = {
    icon:     <Cpu size={15} />,
    label:    'Utilisation CPU',
    value:    '34%',
    percent:  34,
    color:    'var(--blue)',
    dimColor: 'var(--blue-dim)',
  }

  it('renders value and label', () => {
    render(<StatCard {...defaultProps} />)
    expect(screen.getByText('34%')).toBeDefined()
    expect(screen.getByText('Utilisation CPU')).toBeDefined()
  })

  it('renders badge when provided', () => {
    render(<StatCard {...defaultProps} badgeText="Normal" badgeOk />)
    expect(screen.getByText('Normal')).toBeDefined()
  })

  it('renders sub text when provided', () => {
    render(<StatCard {...defaultProps} sub="Intel Core i5" />)
    expect(screen.getByText('Intel Core i5')).toBeDefined()
  })

  it('does not render badge when not provided', () => {
    render(<StatCard {...defaultProps} />)
    expect(screen.queryByText('Normal')).toBeNull()
  })
})
