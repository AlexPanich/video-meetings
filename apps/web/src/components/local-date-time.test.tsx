import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LocalDateTime } from './local-date-time'

describe('LocalDateTime', () => {
  it('в браузере показывает дату и время по-русски', () => {
    render(<LocalDateTime value="2026-11-03T12:00:00.000Z" />)

    const time = screen.getByText(/нояб\. 2026/)
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', '2026-11-03T12:00:00.000Z')
  })

  it('поддерживает длинный формат', () => {
    render(<LocalDateTime value="2026-11-03T12:00:00.000Z" style="long" />)

    expect(screen.getByText(/ноября 2026/)).toBeInTheDocument()
  })

  it('на сервере не подставляет время часового пояса сервера', () => {
    const html = renderToString(<LocalDateTime value="2026-11-03T12:00:00.000Z" />)

    // текста нет: только атрибут datetime, а время в нужном поясе подставит браузер
    expect(html).toMatch(/<time[^>]*><\/time>/)
    expect(html).toContain('dateTime="2026-11-03T12:00:00.000Z"')
  })
})
