import { render, screen } from '@testing-library/react'
import Page from './page'

describe('Home page', () => {
  it('renders main heading', () => {
    render(<Page />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
