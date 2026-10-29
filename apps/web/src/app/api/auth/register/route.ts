import { authenticate } from '@/lib/server/auth'

export const POST = (request: Request) => authenticate('/auth/register', request)
