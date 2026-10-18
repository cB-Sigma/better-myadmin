import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

/**
 * Production smoke test: BetterMyAdmin run the way a release is, then logged in to and browsed
 * against MySQL (BMA_TEST_HOST/PORT, default 127.0.0.1:3306, root/root).
 *
 *   BMA_SMOKE=bundle (default, `pnpm test:smoke`): `pnpm build` output started with
 *     `node apps/server/bin/bettermyadmin.mjs` from a scratch directory holding a
 *     bettermyadmin.config.json (the config file loader)
 *   BMA_SMOKE=docker (`pnpm test:smoke:docker`): the Dockerfile built (BMA_SMOKE_BUILD_ARGS adds
 *     `docker build` arguments, e.g. `--secret id=ca,src=ca.pem` behind a TLS-intercepting proxy)
 *     and run with the phpMyAdmin image's variables only (PMA_HOST, PMA_PORT, APACHE_PORT, UPLOAD_LIMIT)
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const port = Number(process.env.BMA_SMOKE_PORT ?? 8469)
const mode = process.env.BMA_SMOKE ?? 'bundle'
const db = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
}
const chromium =
  process.env.PW_CHROMIUM ?? process.env.BMA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

function bundleCommand(): string {
  // a release directory: only the config file, no checkout around it
  const dir = join(repo, '.data/smoke')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'bettermyadmin.config.json'),
    JSON.stringify(
      {
        Servers: [{ host: db.host, port: db.port, auth_type: 'cookie' }],
        DataDir: join(dir, 'data'),
        Listen: { host: '127.0.0.1', port },
      },
      null,
      2,
    ),
  )
  return `cd ${dir} && exec node ${join(repo, 'apps/server/bin/bettermyadmin.mjs')}`
}

/** the docker mode's container: removed by global-teardown.ts (the CLI does not always pass the stop on) */
export const SMOKE_CONTAINER = `bma-smoke-${port}`

function dockerCommand(): string {
  const image = 'bettermyadmin:smoke'
  const args = process.env.BMA_SMOKE_BUILD_ARGS ?? ''
  return [
    `docker build --network host ${args} -t ${image} ${repo}`,
    `{ docker rm -f ${SMOKE_CONTAINER} >/dev/null 2>&1 || true; }`,
    // host networking: the container reaches the test MySQL on 127.0.0.1 like the runner does
    `exec docker run --rm --name ${SMOKE_CONTAINER} --network host -e PMA_HOST=${db.host} -e PMA_PORT=${db.port} -e APACHE_PORT=${port} -e UPLOAD_LIMIT=64M ${image}`,
  ].join(' && ')
}

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.smoke.ts'],
  outputDir: join(repo, '.data/smoke-results'),
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    ...(existsSync(chromium) ? { launchOptions: { executablePath: chromium } } : {}),
  },
  webServer: {
    command: mode === 'docker' ? dockerCommand() : bundleCommand(),
    url: `http://127.0.0.1:${port}/api/meta/health`,
    reuseExistingServer: false,
    // the docker mode builds the image first
    timeout: mode === 'docker' ? 1_200_000 : 60_000,
    stdout: 'pipe',
  },
})
