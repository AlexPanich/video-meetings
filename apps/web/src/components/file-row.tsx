import { File as FileIcon } from '@gravity-ui/icons'
import { Chip } from '@heroui/react'
import type { ReactNode } from 'react'

interface FileRowProps {
  name: string
  // строка под именем: размер и дата, прогресс или текст ошибки
  children?: ReactNode
  status: string
  color: 'default' | 'success' | 'warning' | 'danger'
  // кнопки справа от статуса
  actions?: ReactNode
}

export function FileRow({ name, children, status, color, actions }: FileRowProps) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <FileIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        {children}
      </div>
      <Chip color={color} size="sm">
        {status}
      </Chip>
      {actions}
    </li>
  )
}
