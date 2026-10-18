import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'

/**
 * Outbound HTTP(S) requests (the version check feed, error reports), through `ProxyUrl` with
 * `ProxyUser`/`ProxyPass` when set, like phpMyAdmin's HttpRequest (CURLOPT_PROXY /
 * CURLOPT_PROXYUSERPWD): HTTPS through a CONNECT tunnel, plain HTTP as an absolute-URI request to
 * the proxy. User agent `phpMyAdmin` (X33: BetterMyAdmin), 10 s timeout, no redirects followed.
 * pma: src/Utils/HttpRequest.php
 */
export interface ProxySettings {
  ProxyUrl: string
  ProxyUser: string
  ProxyPass: string
}

export interface HttpResponse {
  status: number
  body: string
}

const TIMEOUT = 10_000
const USER_AGENT = 'BetterMyAdmin'

/** `host:port` (curl's CURLOPT_PROXY also takes `http://host:port`). */
function proxyAddress(url: string): { host: string; port: number } {
  const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`)
  return { host: u.hostname, port: u.port === '' ? 1080 : Number(u.port) }
}

const proxyAuth = (p: ProxySettings): Record<string, string> =>
  p.ProxyUser === ''
    ? {}
    : { 'Proxy-Authorization': `Basic ${Buffer.from(`${p.ProxyUser}:${p.ProxyPass}`).toString('base64')}` }

function collect(res: http.IncomingMessage): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    res.on('data', (d: Buffer) => chunks.push(d))
    res.on('end', () =>
      resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
    )
    res.on('error', reject)
  })
}

/** One request; rejects on a connection failure or the timeout. */
export function httpRequest(
  proxy: ProxySettings,
  url: string,
  opts: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> } = {},
): Promise<HttpResponse> {
  const target = new URL(url)
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
    ...opts.headers,
    ...(opts.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(opts.body)) } : {}),
  }
  const secure = target.protocol === 'https:'
  const port = target.port === '' ? (secure ? 443 : 80) : Number(target.port)
  return new Promise<HttpResponse>((resolve, reject) => {
    const send = (req: http.ClientRequest) => {
      req.setTimeout(TIMEOUT, () => req.destroy(new Error('timeout')))
      req.on('error', reject)
      req.on('response', (res) => collect(res).then(resolve, reject))
      req.end(opts.body)
    }
    if (proxy.ProxyUrl === '') {
      send((secure ? https : http).request(target, { method, headers }))
      return
    }
    const p = proxyAddress(proxy.ProxyUrl)
    if (!secure) {
      // an absolute-URI request to the proxy
      send(
        http.request({
          host: p.host,
          port: p.port,
          method,
          path: target.href,
          headers: { ...headers, ...proxyAuth(proxy), Host: target.host },
        }),
      )
      return
    }
    const connect = http.request({
      host: p.host,
      port: p.port,
      method: 'CONNECT',
      path: `${target.hostname}:${port}`,
      headers: { Host: `${target.hostname}:${port}`, ...proxyAuth(proxy) },
    })
    connect.setTimeout(TIMEOUT, () => connect.destroy(new Error('timeout')))
    connect.on('error', reject)
    connect.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`proxy CONNECT ${res.statusCode}`))
        return
      }
      const secureSocket = tls.connect({ socket, servername: target.hostname })
      send(https.request(target, { method, headers, createConnection: () => secureSocket }))
    })
    connect.end()
  })
}
