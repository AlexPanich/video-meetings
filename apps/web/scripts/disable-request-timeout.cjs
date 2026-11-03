// Preload для `next dev` / `next start` (через NODE_OPTIONS=--require).
// Next не даёт настроить `requestTimeout` HTTP-сервера, а у Node он по умолчанию 5 минут:
// загрузка файла до 500 МиБ на медленном канале обрывалась бы на прокси `/api/*`.
// Снимаем лимит на всех серверах, которые создаёт `http.createServer` (как и в apps/api/src/main.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- preload обязан быть CommonJS
const http = require('node:http')

if (!http.createServer.__requestTimeoutDisabled) {
  const createServer = http.createServer
  http.createServer = function patchedCreateServer(...args) {
    const server = createServer.apply(this, args)
    server.requestTimeout = 0
    return server
  }
  http.createServer.__requestTimeoutDisabled = true
}
