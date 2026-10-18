import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StepRecord } from './parity.ts'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Writes <dir>/index.html: per case and step, both screenshots side by side with the differences. */
export function writeGallery(dir: string): string | null {
  if (!existsSync(dir)) return null
  const cases = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'result.json')))
    .map((d) => ({
      slug: d.name,
      ...(JSON.parse(readFileSync(join(dir, d.name, 'result.json'), 'utf8')) as {
        name: string
        spec: { known?: string; pma: { route: string }; ours: { path: string } }
        records: StepRecord[]
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const body: string[] = []
  body.push('<h1>UI parity gallery</h1><p>phpMyAdmin left, BetterMyAdmin right. Review aid, not a gate.</p>')
  body.push('<ul class="toc">')
  for (const c of cases) {
    const n = c.records.reduce((k, r) => k + r.diff.differences.length, 0)
    body.push(
      `<li><a href="#${c.slug}">${esc(c.name)}</a> <span class="${n === 0 ? 'ok' : 'bad'}">${n} diff(s)</span></li>`,
    )
  }
  body.push('</ul>')
  for (const c of cases) {
    body.push(`<section id="${c.slug}"><h2>${esc(c.name)}</h2>`)
    body.push(`<p><code>${esc(c.spec.pma.route)}</code> ↔ <code>${esc(c.spec.ours.path)}</code></p>`)
    if (c.spec.known !== undefined) body.push(`<p class="todo">TODO: ${esc(c.spec.known)}</p>`)
    for (const r of c.records) {
      body.push(`<h3>${esc(r.step)}</h3><div class="pair">`)
      for (const side of ['pma', 'ours'] as const) {
        const s = r[side]
        body.push(
          `<figure><figcaption>${side === 'pma' ? 'phpMyAdmin' : 'BetterMyAdmin'} · ${s.controls.length} controls · <a href="${esc(s.url)}">${esc(s.url)}</a></figcaption>${s.shot === '' ? '<p class="ok">no differences (screenshots with BMA_UIP_SHOTS=all)</p>' : `<a href="${c.slug}/${s.shot}"><img loading="lazy" src="${c.slug}/${s.shot}" alt=""></a>`}</figure>`,
        )
      }
      body.push('</div>')
      if (r.diff.differences.length > 0)
        body.push(
          `<ul class="diffs">${r.diff.differences.map((d) => `<li class="${d.type}">${esc(d.message)}</li>`).join('')}</ul>`,
        )
      else body.push('<p class="ok">no differences</p>')
    }
    body.push('</section>')
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI parity gallery</title><style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#666;--bad:#b3261e;--ok:#1b6e2a;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--muted:#aaa;--bad:#ff8a80;--ok:#8bd49a;--line:#333}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0 16px 48px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0;min-width:0}figcaption{color:var(--muted);font-size:12px;overflow-wrap:anywhere}
img{width:100%;border:1px solid var(--line)}.bad,.missing,.extra,.field,.order{color:var(--bad)}.ok{color:var(--ok)}.todo{color:var(--bad);font-weight:600}
section{border-top:1px solid var(--line);margin-top:24px}code{font-size:12px}
@media (max-width:700px){.pair{grid-template-columns:1fr}}
</style></head><body>${body.join('\n')}</body></html>`
  const file = join(dir, 'index.html')
  writeFileSync(file, html)
  return file
}
