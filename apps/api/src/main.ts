import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module.js'
import { setupSwagger } from './swagger.js'
import { parseTrustProxy } from './trust-proxy.js'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  // от этого зависит req.ip, а значит и rate limiting: без явной настройки X-Forwarded-For не доверяем
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY))
  setupSwagger(app)
  // загрузка до 500 МиБ на медленном канале идёт дольше 5 минут (дефолт Node): лимит по времени снимаем
  app.getHttpServer().requestTimeout = 0
  await app.listen(process.env.PORT ?? 3001)
}
await bootstrap()
