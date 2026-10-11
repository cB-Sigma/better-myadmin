import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Server configuration for the e2e run (phpMyAdmin directive names). */
export default {
  blowfish_secret: 'e2e-secret-e2e-secret-e2e-secret-0123',
  // a fresh local metadata store per run; a configuration storage that does not exist and no
  // ZeroConf, so the shared MySQL's `phpmyadmin` storage (the reference phpMyAdmin's, found by the
  // default discovery) is never written by the e2e run
  DataDir: join(tmpdir(), `bma-e2e-${process.pid}`),
  ZeroConf: false,
  Servers: [
    {
      host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
      port: Number(process.env.BMA_TEST_PORT ?? 3306),
      pmadb: 'm1e2e_no_storage',
    },
  ],
}
