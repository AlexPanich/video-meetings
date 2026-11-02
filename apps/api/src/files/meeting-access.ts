import { NotFoundException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service.js'

// встреча видна только владельцу: чужая и несуществующая — одинаково 404
export async function assertMeetingOwner(prisma: PrismaService, ownerId: string, id: string) {
  const meeting = await prisma.meeting.findFirst({ where: { id, ownerId }, select: { id: true } })
  if (!meeting) throw new NotFoundException('Встреча не найдена')
}
