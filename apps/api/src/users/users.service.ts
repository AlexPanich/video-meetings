import { ConflictException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'

export interface PublicUser {
  id: string
  email: string
  name: string
}

export const toPublicUser = (user: PublicUser): PublicUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
})

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } })
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } })
  }

  async create(data: { email: string; name: string; passwordHash: string }) {
    try {
      return await this.prisma.user.create({ data })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Пользователь с таким email уже существует')
      }
      throw error
    }
  }
}
