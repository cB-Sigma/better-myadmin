import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The second e2e server (playwright.config.ts): the dev replica (mysql84-replica, :3308 by default,
 * docker/dev.compose.yml) for server-replica.e2e.ts. Same options as bma.config.ts.
 */
export default {
  blowfish_secret: 'e2e-secret-e2e-secret-e2e-secret-0123',
  DataDir: join(tmpdir(), `bma-e2e-replica-${process.pid}`),
  ZeroConf: false,
  Servers: [
    {
      host: process.env.BMA_PARITY_REPLICA_HOST ?? process.env.BMA_TEST_HOST ?? '127.0.0.1',
      port: Number(process.env.BMA_PARITY_REPLICA_PORT ?? 3308),
      pmadb: 'm1e2e_no_storage',
    },
  ],
}
