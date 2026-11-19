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

describe('LocalDateTime в часовом поясе браузера', () => {
  // Форматтеры создаются при загрузке модуля и запоминают пояс: модуль грузится заново после смены TZ
  const originalTz = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'Asia/Yekaterinburg'
  })
  afterAll(() => {
    process.env.TZ = originalTz
  })

  it('встреча на 15:00 (UTC+5) показывается как 15:00 на главной и на странице встречи', async () => {
    vi.resetModules()
    const { LocalDateTime: Local } = await import('./local-date-time')
    // это окно создания отправляет в API для 15.01.2030 15:00 в этом поясе
    const value = '2030-01-15T10:00:00.000Z'

    render(
      <>
        <Local value={value} />
        <Local value={value} style="long" />
      </>,
    )

    expect(screen.getByText(/янв\. 2030.*15:00/)).toBeInTheDocument()
    expect(screen.getByText(/15 января 2030.*15:00/)).toBeInTheDocument()
  })
})
