import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** BetterMyAdmin server configuration for the UI parity run (phpMyAdmin directive names). */
export default {
  blowfish_secret: 'uip-secret-uip-secret-uip-secret-0123456',
  // fresh local metadata store per run; a configuration storage of our own (created by global-setup
  // from docker/seed/pmadb.sql) and no ZeroConf, so the reference's `phpmyadmin` is never written
  DataDir: join(tmpdir(), `bma-uip-${process.pid}`),
  ZeroConf: false,
  Servers: [
    {
      host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
      port: Number(process.env.BMA_TEST_PORT ?? 3306),
      pmadb: 'uip_pmadb',
    },
  ],
}
