import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'

// Защитные заголовки и скрытие стека. upgrade-insecure-requests отключён: API ходит по http
// за прокси и в разработке, а на https-терминацию это не влияет
export const setupSecurity = (app: INestApplication) => {
  const express = app as NestExpressApplication
  express.disable('x-powered-by')
  express.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { upgradeInsecureRequests: null },
      },
    }),
  )
}
