import { describe, expect, it } from 'vitest'
import {
  COVERAGE_KINDS,
  type Coverage,
  type ItemCoverage,
  type KindCoverage,
  STATUSES,
  type Status,
} from '../src/coverage.ts'
import { compareBaseline } from '../src/gate.ts'
import { type Disposition, dispositionProblems, lookup } from '../src/maps.ts'
import { baselineOf } from '../src/pipeline.ts'

function kind(k: (typeof COVERAGE_KINDS)[number], items: [string, Status][]): KindCoverage {
  const its: ItemCoverage[] = items.map(([key, status]) => ({
    key,
    area: '01',
    status,
    label: key,
    source: '',
    targets: [],
    problems: [],
  }))
  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, its.filter((i) => i.status === s).length]),
  ) as Record<Status, number>
  return {
    kind: k,
    total: its.length,
    counts,
    covered: its.filter((i) => ['implemented', 'exception', 'n/a'].includes(i.status)).length,
    items: its,
  }
}

function coverage(routes: [string, Status][]): Coverage {
  const kinds = Object.fromEntries(
    COVERAGE_KINDS.map((k) => [k, kind(k, k === 'routes' ? routes : [])]),
  ) as Coverage['kinds']
  return {
    referenceCommit: 'abc',
    kinds,
    problems: [],
    notes: [],
    scans: { endpoints: [], spaRoutes: [], claims: [], tests: [], checklist: [], unknownMsgids: [] },
  }
}

describe('ratchet', () => {
  const base = baselineOf(
    coverage([
      ['/a', 'implemented'],
      ['/b', 'n/a'],
      ['/c', 'planned'],
    ]),
  )

  it('passes when nothing changed and notes improvements', () => {
    expect(
      compareBaseline(
        coverage([
          ['/a', 'implemented'],
          ['/b', 'n/a'],
          ['/c', 'planned'],
        ]),
        base,
      ).failures,
    ).toEqual([])
    const up = compareBaseline(
      coverage([
        ['/a', 'implemented'],
        ['/b', 'n/a'],
        ['/c', 'implemented'],
      ]),
      base,
    )
    expect(up.failures).toEqual([])
    expect(up.warnings.join('\n')).toMatch(/parity:baseline/)
    expect(up.delta.get('routes')).toBe('+1 impl, +1 cov')
  })

  it('fails when an implemented or accounted item regresses, and on lower counts', () => {
    const r = compareBaseline(
      coverage([
        ['/a', 'planned'],
        ['/b', 'missing'],
        ['/c', 'planned'],
      ]),
      base,
    )
    expect(r.failures).toEqual([
      'routes: /a was implemented, now planned',
      'routes: /b was covered, now missing',
      'routes: covered 0 < baseline 2',
      'routes: implemented 0 < baseline 1',
      'routes: coverage 0.00% < baseline 66.67%',
    ])
  })

  it('fails when an item leaves the inventory or the ratio drops', () => {
    const gone = compareBaseline(
      coverage([
        ['/b', 'n/a'],
        ['/c', 'planned'],
      ]),
      base,
    )
    expect(gone.failures[0]).toBe('routes: /a was implemented, now gone from the inventory')
    // a grown inventory dilutes the ratio
    const grown = compareBaseline(
      coverage([
        ['/a', 'implemented'],
        ['/b', 'n/a'],
        ['/c', 'planned'],
        ['/d', 'missing'],
      ]),
      base,
    )
    expect(grown.failures).toEqual(['routes: coverage 50.00% < baseline 66.67%'])
  })

  it('requires a baseline', () => {
    expect(compareBaseline(coverage([]), null).failures[0]).toMatch(/no tools\/parity\/baseline.json/)
  })
})

describe('dispositions', () => {
  const exc = new Set(['X1', 'Q3'])
  const ms = new Set(['M1', 'M4'])
  const p = (d: Disposition) => dispositionProblems(d, exc, ms)
  it('checks exception ids and milestones', () => {
    expect(p({ exception: 'X1', planned: 'M4' })).toEqual([])
    expect(p({ exception: 'X1, Q3' })).toEqual([])
    expect(p({ exception: 'X99' })).toEqual(['exception X99 is not in docs/reference/parity-exceptions.md'])
    expect(p({ planned: 'M9' })).toEqual([
      'planned milestone M9 is not in docs/architecture/13-roadmap-and-milestones.md',
    ])
    expect(p({ 'n/a': 'x', planned: 'M1' })).toEqual(['n/a cannot be combined with planned'])
  })
  it('looks up exact keys, templates and the longest prefix', () => {
    const map = { 'setup/': { planned: 'M4' }, 'setup/home/': { 'n/a': 'x' }, 'a.twig': { planned: 'M1' } }
    expect(lookup(map, 'setup/home/index.twig#x')).toEqual({ 'n/a': 'x' })
    expect(lookup(map, 'setup/form/x.twig#y')).toEqual({ planned: 'M4' })
    expect(lookup(map, 'a.twig#b', ['a.twig'])).toEqual({ planned: 'M1' })
    expect(lookup(map, 'b.twig#b', ['b.twig'])).toBeUndefined()
  })
})
