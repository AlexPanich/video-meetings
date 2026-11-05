import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

// Документация раскрывает все маршруты и схемы, поэтому закрыта по умолчанию:
// включается только явным `SWAGGER_ENABLED=true` (и не в production, даже если флаг забыли снять)
export const setupSwagger = (app: INestApplication) => {
  if (process.env.SWAGGER_ENABLED !== 'true' || process.env.NODE_ENV === 'production') return

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
