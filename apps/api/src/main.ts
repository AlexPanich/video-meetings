import type { Server } from 'node:http'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { setupSwagger } from './swagger.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  setupSwagger(app)
  // загрузка до 500 МиБ на медленном канале идёт дольше 5 минут (дефолт Node): лимит по времени снимаем
  ;(app.getHttpServer() as Server).requestTimeout = 0
  await app.listen(process.env.PORT ?? 3001)
}
await bootstrap()
