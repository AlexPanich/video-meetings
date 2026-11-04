import { Command } from '@nestjs/cqrs'

export interface ClearUserAvatarResult {
  // имя файла аватара, который теперь нужно удалить с диска; null — аватара не было
  previousStorageName: string | null
}

// Очищает поля аватара в User; null — пользователя с таким id нет
export class ClearUserAvatarCommand extends Command<ClearUserAvatarResult | null> {
  constructor(public readonly userId: string) {
    super()
  }
}
