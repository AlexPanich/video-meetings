// Инициалы: первые буквы первых двух слов имени в верхнем регистре
export const getInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase('ru')

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
