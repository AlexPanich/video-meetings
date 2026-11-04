import { type FileHandle, open } from 'node:fs/promises'
import { NotFoundException, StreamableFile, UnauthorizedException } from '@nestjs/common'
import { type IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs'
import { FindUserByIdQuery } from '../../users/queries/find-user-by-id.query.js'
import { getAvatarPath } from '../avatar.js'
import { GetAvatarQuery } from './get-avatar.query.js'

@QueryHandler(GetAvatarQuery)
export class GetAvatarHandler implements IQueryHandler<GetAvatarQuery> {
  constructor(private readonly queryBus: QueryBus) {}

  async execute({ userId }: GetAvatarQuery): Promise<StreamableFile> {
    // только свой аватар: пользователь берётся из токена, имя файла — из БД.
    // Если параллельная замена успела удалить файл между чтением БД и open, перечитываем запись один раз
    for (let attempt = 0; ; attempt++) {
      const user = await this.queryBus.execute(new FindUserByIdQuery(userId))
      if (!user) throw new UnauthorizedException()
      if (!user.avatarStorageName || !user.avatarMimeType) {
        throw new NotFoundException('Аватар не найден')
      }
      try {
        const handle = await open(getAvatarPath(user.avatarStorageName), 'r')
        return await this.stream(handle, user.avatarMimeType)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (attempt >= 1) throw new NotFoundException('Аватар не найден')
      }
    }
  }

  private async stream(handle: FileHandle, mimeType: string): Promise<StreamableFile> {
    try {
      const { size } = await handle.stat()
      // MIME-тип — из БД (проверен по сигнатуре при загрузке), не из расширения
      return new StreamableFile(handle.createReadStream(), {
        type: mimeType,
        disposition: 'inline',
        length: size,
      })
    } catch (error) {
      await handle.close().catch(() => undefined)
      throw error
    }
  }
}
