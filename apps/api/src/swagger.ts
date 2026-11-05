import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

// В production документация не публикуется (раскрывает все маршруты и схемы)
export const setupSwagger = (app: INestApplication) => {
  if (process.env.NODE_ENV === 'production') return

  const config = new DocumentBuilder()
    .setTitle('Video Meetings API')
    .setDescription('Регистрация, вход и встречи')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs-json',
  })
}
