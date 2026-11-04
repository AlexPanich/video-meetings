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
  className = 'size-10 text-sm',
}: {
  name: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground ${className}`}
    >
      {getInitials(name)}
    </span>
  )
}
