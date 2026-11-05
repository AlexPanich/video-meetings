import { isIP } from 'node:net'

// IP клиента для API: нужен его rate limiting (иначе API видит один адрес сервера Next и лимит `ip`
// общий для всех пользователей). Значению из `X-Forwarded-For` от клиента как есть верить нельзя:
// он подделывает заголовок целиком. Поэтому берём запись, добавленную ближайшим доверенным прокси:
// `TRUSTED_PROXIES` — сколько обратных прокси стоит перед Next (каждый дописывает адрес своего
// соседа справа). Не задано или 0 — заголовок недоверенный, IP не определяется.
export const clientIp = (request: Request): string | undefined => {
  const hops = Number(process.env.TRUSTED_PROXIES ?? 0)
  if (!Number.isInteger(hops) || hops < 1) return undefined
  const chain = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const ip = chain[chain.length - hops]
  return ip && isIP(ip) ? ip : undefined
}

// Заголовок для запроса к API: одно проверенное значение вместо клиентской цепочки. API с
// `TRUST_PROXY=1` берёт `req.ip` из него; без IP заголовок не ставится, и API видит адрес сокета.
export const clientIpHeaders = (request: Request): Record<string, string> => {
  const ip = clientIp(request)
  return ip ? { 'X-Forwarded-For': ip } : {}
}
