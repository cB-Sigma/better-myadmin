import { describe, expect, it } from 'vitest'
import { treeGuides } from './rows'

const show = (depths: number[]) =>
  treeGuides(depths.map((depth) => ({ depth }))).map(
    (g) => `${g.pipes.map((p) => (p ? '│' : ' ')).join('')}${g.elbow === 'tee' ? '├' : '└'}`,
  )

describe('treeGuides (the navigation tree connector lines)', () => {
  it('draws tees for rows with a later sibling and an end for the last', () => {
    expect(show([0, 0, 0])).toEqual(['├', '├', '└'])
  })
  it('carries a parent line past its children while the parent has later siblings', () => {
    // New, db1 ▾ (tbl a, tbl b), db2
    expect(show([0, 0, 1, 1, 0])).toEqual(['├', '├', '│├', '│└', '└'])
  })
  it('stops the parent line under the last parent', () => {
    expect(show([0, 0, 1, 2, 2, 1])).toEqual(['├', '└', ' ├', ' │├', ' │└', ' └'])
  })
})
