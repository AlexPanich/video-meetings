/**
 * Значение для express `trust proxy` из env `TRUST_PROXY`.
 * Пусто/`false` — не доверять X-Forwarded-For (лимиты считаются по адресу сокета);
 * число — количество доверенных прокси-узлов перед API; `true` запрещён (клиент подделает IP);
 * иначе — строка express (`loopback`, `10.0.0.0/8`…).
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string {
  const v = value?.trim()
  if (!v || v.toLowerCase() === 'false') return false
  if (v.toLowerCase() === 'true') {
    throw new Error('TRUST_PROXY=true небезопасен: укажите число прокси или список адресов')
  }
  if (/^\d+$/.test(v)) return Number(v)
  return v
}
