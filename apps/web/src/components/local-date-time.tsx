'use client'

import { useSyncExternalStore } from 'react'

const formats = {
  medium: new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }),
  long: new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }),
}

const subscribe = () => () => undefined

/**
 * Дата и время в часовом поясе зрителя. Сервер его не знает, поэтому на сервере и при гидратации
 * рендерится пустой <time>, а форматирование выполняется уже в браузере — без расхождения с разметкой.
 */
export function LocalDateTime({
  value,
  style = 'medium',
}: {
  value: string
  style?: keyof typeof formats
}) {
  const text = useSyncExternalStore(
    subscribe,
    () => formats[style].format(new Date(value)),
    () => '',
  )
  return <time dateTime={value}>{text}</time>
}
