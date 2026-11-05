import { Command } from '@nestjs/cqrs'

// Заменяет хеш пароля на пересчитанный с актуальными параметрами. tokenVersion не меняется:
// пароль тот же, сессии остаются. Запись идёт, только если хеш всё ещё равен oldPasswordHash
// (иначе параллельная смена пароля была бы затёрта)
export class UpgradeUserPasswordHashCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly oldPasswordHash: string,
    public readonly newPasswordHash: string,
  ) {
    super()
  }
}
