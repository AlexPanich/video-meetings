import type { StreamableFile } from '@nestjs/common'
import { Query } from '@nestjs/cqrs'

export class GetAvatarQuery extends Query<StreamableFile> {
  constructor(public readonly userId: string) {
    super()
  }
}
