import type { Meeting } from '../generated/prisma/client.js'

export type PublicMeeting = Pick<Meeting, 'id' | 'title' | 'date' | 'participants' | 'ownerId'>

export const toPublicMeeting = ({
  id,
  title,
  date,
  participants,
  ownerId,
}: Meeting): PublicMeeting => ({ id, title, date, participants, ownerId })
