import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { setupSwagger } from './swagger.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  setupSwagger(app)
  await app.listen(process.env.PORT ?? 3001)
}
await bootstrap()
