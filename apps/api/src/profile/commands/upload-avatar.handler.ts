import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { Transform, type Readable, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Logger, UnauthorizedException, UnsupportedMediaTypeException } from '@nestjs/common'
import { CommandBus, CommandHandler, type ICommandHandler, QueryBus } from '@nestjs/cqrs'
import { receiveSingleFile } from '../../files/multipart.js'
import { SetUserAvatarCommand } from '../../users/commands/set-user-avatar.command.js'
import { FindUserByIdQuery } from '../../users/queries/find-user-by-id.query.js'
import { type PublicUser, toPublicUser } from '../../users/user.js'
import {
  AVATAR_MAX_BYTES,
  AVATAR_SIGNATURE_BYTES,
  type AvatarMimeType,
  detectAvatarMimeType,
  getAvatarPath,
  getAvatarsDir,
  removeAvatarFile,
} from '../avatar.js'
import { UploadAvatarCommand } from './upload-avatar.command.js'

interface StoredAvatar {
  storageName: string
  mimeType: AvatarMimeType
}

// пропускает поток дальше только после проверки сигнатуры по первым байтам
class SignatureGate extends Transform {
  mimeType: AvatarMimeType | null = null
  private head = Buffer.alloc(0)
  private checked = false

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    if (this.checked) return callback(null, chunk)
    this.head = Buffer.concat([this.head, chunk])
    if (this.head.length < AVATAR_SIGNATURE_BYTES) return callback()
    this.release(callback)
  }

  override _flush(callback: TransformCallback) {
    if (this.checked) return callback()
    this.release(callback)
  }

  private release(callback: TransformCallback) {
    this.checked = true
    this.mimeType = detectAvatarMimeType(this.head)
    if (!this.mimeType) {
      return callback(
        new UnsupportedMediaTypeException('Допускаются только изображения JPEG, PNG и WebP'),
      )
    }
    const head = this.head
    this.head = Buffer.alloc(0)
    callback(null, head)
  }
}

@CommandHandler(UploadAvatarCommand)
export class UploadAvatarHandler implements ICommandHandler<UploadAvatarCommand> {
  private readonly logger = new Logger(UploadAvatarHandler.name)

  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ userId, request }: UploadAvatarCommand): Promise<PublicUser> {
    const stored = await receiveSingleFile(request, {
      maxSize: AVATAR_MAX_BYTES,
      // отказ по формату приходит на первых байтах: дочитываем небольшое тело, иначе клиент получит обрыв
      drainOnFailure: true,
      onFile: (stream) => this.store(stream),
      rollback: ({ storageName }) => this.remove(storageName),
    })

    // порядок: новый файл записан, затем БД, затем удаляется старый файл
    let result
    try {
      result = await this.commandBus.execute(
        new SetUserAvatarCommand(userId, stored.storageName, stored.mimeType),
      )
    } catch (error) {
      // ошибка могла прийти уже после COMMIT (обрыв соединения): тогда в БД новый аватар, и его
      // файл удалять нельзя, иначе запись останется без файла
      const current = await this.findUser(userId)
      // БД недоступна, исход неизвестен: файл оставляем, его уберёт очистка осиротевших
      if (!current.found) throw error
      if (current.user?.avatarStorageName === stored.storageName) return toPublicUser(current.user)
      await this.remove(stored.storageName)
      throw error
    }
    if (!result) {
      // пользователь из токена больше не существует
      await this.remove(stored.storageName)
      throw new UnauthorizedException()
    }

    if (result.previousStorageName) await this.remove(result.previousStorageName)
    return toPublicUser(result.user)
  }

  // found: false — перечитать пользователя не удалось
  private async findUser(userId: string) {
    try {
      return {
        found: true as const,
        user: await this.queryBus.execute(new FindUserByIdQuery(userId)),
      }
    } catch {
      return { found: false as const }
    }
  }

  // пишет поток на диск под uuid-именем; при любой ошибке убирает за собой частичный файл
  private async store(stream: Readable): Promise<StoredAvatar> {
    const storageName = randomUUID()
    const gate = new SignatureGate()
    try {
      await mkdir(getAvatarsDir(), { recursive: true })
      await pipeline(stream, gate, createWriteStream(getAvatarPath(storageName)))
      // сигнатура проверена в SignatureGate; без типа файл сохранять нельзя
      if (!gate.mimeType) throw new UnsupportedMediaTypeException('Не удалось определить формат')
    } catch (error) {
      await this.remove(storageName)
      throw error
    }
    return { storageName, mimeType: gate.mimeType }
  }

  private remove(storageName: string): Promise<void> {
    return removeAvatarFile(storageName, this.logger)
  }
}
