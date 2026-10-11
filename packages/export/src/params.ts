/**
 * The POSTed form of the export (or import) page, as ordered name/value pairs like a browser sends
 * them. `name[]` fields form lists; `name[a][b]` fields form nested maps (aliases).
 * pma: src/Http/ServerRequest.php (getParsedBodyParam / hasBodyParam)
 */
export class Params {
  readonly pairs: ReadonlyArray<readonly [string, string]>

  constructor(pairs: Iterable<readonly [string, string]> | Record<string, string | string[]>) {
    if (Symbol.iterator in Object(pairs)) {
      this.pairs = [...(pairs as Iterable<readonly [string, string]>)]
    } else {
      const out: Array<[string, string]> = []
      for (const [k, v] of Object.entries(pairs as Record<string, string | string[]>)) {
        if (Array.isArray(v)) for (const x of v) out.push([`${k}[]`, x])
        else out.push([k, v])
      }
      this.pairs = out
    }
  }

  /** hasBodyParam: the field was sent (whatever its value) */
  has(name: string): boolean {
    return this.pairs.some(([k]) => k === name || k === `${name}[]` || k.startsWith(`${name}[`))
  }

  /** getParsedBodyParam for a scalar: the last value, undefined when absent or a list */
  get(name: string): string | undefined {
    let v: string | undefined
    for (const [k, val] of this.pairs) if (k === name) v = val
    return v
  }

  /** getParsedBodyParamAsString($name, $default) */
  str(name: string, def = ''): string {
    return this.get(name) ?? def
  }

  /** `name[]` values; undefined when the list was not sent */
  list(name: string): string[] | undefined {
    const out: string[] = []
    let seen = false
    for (const [k, v] of this.pairs) {
      if (k === `${name}[]`) {
        out.push(v)
        seen = true
      }
    }
    return seen ? out : undefined
  }

  /** The nested map of `name[a][b]...` fields (PHP's array form parsing). */
  tree(name: string): Record<string, unknown> | undefined {
    let root: Record<string, unknown> | undefined
    for (const [k, v] of this.pairs) {
      if (!k.startsWith(`${name}[`)) continue
      const keys = [...k.slice(name.length).matchAll(/\[([^\]]*)\]/g)].map((m) => m[1] as string)
      root ??= {}
      let node: Record<string, unknown> = root
      keys.forEach((key, i) => {
        const last = i === keys.length - 1
        const kk = key === '' ? String(Object.keys(node).length) : key
        if (last) node[kk] = v
        else {
          if (typeof node[kk] !== 'object' || node[kk] === null) node[kk] = {}
          node = node[kk] as Record<string, unknown>
        }
      })
    }
    return root
  }

  with(name: string, value: string): Params {
    return new Params([...this.pairs.filter(([k]) => k !== name), [name, value]])
  }
}
