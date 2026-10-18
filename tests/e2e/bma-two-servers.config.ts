import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The third e2e server (playwright.config.ts): two cookie-auth servers, the shared MySQL and the dev
 * replica, for f01-servers.e2e.ts (the login form's server choice). Same options as bma.config.ts.
 */
export default {
  blowfish_secret: 'e2e-secret-e2e-secret-e2e-secret-0123',
  DataDir: join(tmpdir(), `bma-e2e-two-${process.pid}`),
  ZeroConf: false,
  Servers: [
    {
      host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
      port: Number(process.env.BMA_TEST_PORT ?? 3306),
      verbose: 'f01 first',
      pmadb: 'm1e2e_no_storage',
    },
    {
      host: process.env.BMA_PARITY_REPLICA_HOST ?? process.env.BMA_TEST_HOST ?? '127.0.0.1',
      port: Number(process.env.BMA_PARITY_REPLICA_PORT ?? 3308),
      verbose: 'f01 second',
      pmadb: 'm1e2e_no_storage',
    },
  ],
}
