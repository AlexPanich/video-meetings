'use client'

import { useCallback, useState } from 'react'
import { avatarUrl } from '@/lib/avatar'

// Инициалы: первая буква или цифра каждого из первых двух слов имени в верхнем регистре.
// Знаки препинания и невидимые символы пропускаются; без букв и цифр — «?»
export const getInitials = (name: string) => {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0])
    .filter((char): char is string => Boolean(char))
    .slice(0, 2)
    .join('')
  return initials ? initials.toUpperCase() : '?'
}

export function UserAvatar({
  name,
  hasAvatar = false,
  avatarVersion,
  className = 'size-10 text-sm',
}: {
  name: string
  hasAvatar?: boolean
  avatarVersion?: number | null
  className?: string
}) {
  // версия, для которой изображение не загрузилось: при новой версии пробуем снова
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const src = avatarUrl(avatarVersion)
  // Ошибка загрузки, случившаяся до гидратации, onError не вызывает: проверяем состояние при монтировании
  const checkLoaded = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailedSrc(img.getAttribute('src'))
  }, [])
  const showImage = hasAvatar && failedSrc !== src

  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent font-semibold text-accent-foreground ${className}`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- закрытый эндпоинт с cookie, оптимизатор не нужен
        <img
          ref={checkLoaded}
          src={src}
          alt=""
          className="size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        getInitials(name)
      )}
    </span>
  )
}
