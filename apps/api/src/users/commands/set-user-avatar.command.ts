import { Command } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'

export interface SetUserAvatarResult {
  // полная сущность (с passwordHash): команда внутренняя, для модуля profile
  user: User
  // имя прежнего файла аватара, который теперь нужно удалить с диска
  previousStorageName: string | null
}

// Записывает новый аватар в User; null — пользователя с таким id нет
export class SetUserAvatarCommand extends Command<SetUserAvatarResult | null> {
  constructor(
    public readonly userId: string,
    public readonly storageName: string,
    public readonly mimeType: string,
  ) {
    super()
  }
}
