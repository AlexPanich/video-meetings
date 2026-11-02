import type { MeetingFile } from '../generated/prisma/client.js'

export type PublicMeetingFile = Pick<
  MeetingFile,
  'id' | 'meetingId' | 'name' | 'size' | 'mimeType' | 'status' | 'createdAt'
>

export const toPublicMeetingFile = ({
  id,
  meetingId,
  name,
  size,
  mimeType,
  status,
  createdAt,
}: MeetingFile): PublicMeetingFile => ({ id, meetingId, name, size, mimeType, status, createdAt })
