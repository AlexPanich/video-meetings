// @vitest-environment node
import { createRequire } from 'node:module'
import http from 'node:http'

describe('disable-request-timeout.cjs', () => {
  it('снимает requestTimeout у серверов, создаваемых через http.createServer', () => {
    expect(http.createServer().requestTimeout).toBe(300_000)

    createRequire(import.meta.url)('./disable-request-timeout.cjs')

    expect(http.createServer().requestTimeout).toBe(0)
    // повторная загрузка не оборачивает функцию второй раз
    createRequire(import.meta.url)('./disable-request-timeout.cjs')
    expect(http.createServer().requestTimeout).toBe(0)
  })
})
