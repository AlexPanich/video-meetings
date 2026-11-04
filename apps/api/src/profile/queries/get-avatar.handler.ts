import { open } from 'node:fs/promises'
import { NotFoundException, StreamableFile, UnauthorizedException } from '@nestjs/common'
import { type IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs'
import { FindUserByIdQuery } from '../../users/queries/find-user-by-id.query.js'
import { getAvatarPath } from '../avatar.js'
import { GetAvatarQuery } from './get-avatar.query.js'

@QueryHandler(GetAvatarQuery)
export class GetAvatarHandler implements IQueryHandler<GetAvatarQuery> {
  constructor(private readonly queryBus: QueryBus) {}

  async execute({ userId }: GetAvatarQuery): Promise<StreamableFile> {
    // только свой аватар: пользователь берётся из токена, имя файла — из БД
    const user = await this.queryBus.execute(new FindUserByIdQuery(userId))
    if (!user) throw new UnauthorizedException()
    if (!user.avatarStorageName || !user.avatarMimeType) {
      throw new NotFoundException('Аватар не найден')
    }

    const handle = await open(getAvatarPath(user.avatarStorageName), 'r').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new NotFoundException('Аватар не найден')
        throw error
      },
    )
    try {
      const { size } = await handle.stat()
      // MIME-тип — из БД (проверен по сигнатуре при загрузке), не из расширения
      return new StreamableFile(handle.createReadStream(), {
        type: user.avatarMimeType,
        disposition: 'inline',
        length: size,
      })
    } catch (error) {
      await handle.close().catch(() => undefined)
      throw error
    }
  }
}
