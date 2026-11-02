import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The visual run's server: the acme_store demo database only (docker/demo/acme_store.sql). */
export default {
  blowfish_secret: 'visual-secret-visual-secret-visual-01',
  DataDir: join(tmpdir(), `bma-visual-${process.pid}`),
  ZeroConf: false,
  Servers: [
    {
      host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
      port: Number(process.env.BMA_TEST_PORT ?? 3306),
      verbose: 'Production',
      only_db: ['acme_store'],
      pmadb: 'bma_visual_no_storage',
    },
  ],
}
