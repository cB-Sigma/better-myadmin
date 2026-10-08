import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Server configuration for the e2e run (phpMyAdmin directive names). */
export default {
  blowfish_secret: 'e2e-secret-e2e-secret-e2e-secret-0123',
  DataDir: join(tmpdir(), 'bma-e2e'),
  Servers: [
    {
      host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
      port: Number(process.env.BMA_TEST_PORT ?? 3306),
    },
  ],
}
