import http from 'node:http'
import type net from 'node:net'
import { describe, expect, it } from 'vitest'
import { getLatestVersions } from '../../src/shell/version.ts'

/** Feature 01 checklist items of the shell's server side. */
describe('version check (VersionInformation::getLatestVersions)', () => {
  it('[p01-bb3004] the feed is cached for 6 hours', async () => {
    let hits = 0
    const feed = http.createServer((_req, res) => {
      hits++
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ releases: [{ version: '9.9.9', date: '2026-01-01', node_versions: '>=20' }] }))
    })
    await new Promise<void>((r) => feed.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(feed.address() as net.AddressInfo).port}/feed.json`
    try {
      const t0 = 1_000_000_000_000
      expect((await getLatestVersions(url, t0))?.[0]?.version).toBe('9.9.9')
      await getLatestVersions(url, t0 + 5 * 3600 * 1000)
      expect(hits).toBe(1)
      await getLatestVersions(url, t0 + 6 * 3600 * 1000)
      expect(hits).toBe(2)
    } finally {
      feed.close()
    }
  })
})
