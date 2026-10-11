/**
 * The inventories: what phpMyAdmin has, extracted mechanically from the reference checkout.
 * Committed as JSON under tools/parity/inventory/ (one file per kind) with the reference commit.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { directives as schemaDirectives } from '@bettermyadmin/config'
import { msgKey, parsePot } from './extract/pot.ts'
import { type TemplateControl, parseTemplate } from './extract/twig-controls.ts'
import { INVENTORY_DIR, PARITY, REPO, pmaHead, readJson, walk, writeJson } from './util.ts'

export type InventoryKind = 'routes' | 'controls' | 'directives' | 'messages'
export const INVENTORY_KINDS: InventoryKind[] = ['routes', 'controls', 'directives', 'messages']

export interface InventoryMeta {
  generated: string
  referenceCommit: string
  source: string
  count: number
}

export interface Inventory<T> {
  _meta: InventoryMeta
  items: T[]
}

export interface RouteItem {
  /** `path` for the main app, `setup:<path>` for the setup script. */
  key: string
  path: string
  methods: string[]
  controller: string
  /** pma source file of the controller. */
  file: string
  scope: 'app' | 'setup'
  /** Concrete paths FastRoute's parser expands optional segments into. */
  variants: string[]
}

export type ControlItem = TemplateControl & { file: string }

export interface DirectiveItem {
  /** phpMyAdmin path, `Servers/*` for the per-server template (e.g. `Servers/*\/host`). */
  key: string
  /** `schema`: in packages/config; `pma-only`: in phpMyAdmin's Settings but not in our schema. */
  source: 'schema' | 'pma-only'
  type: string
  /** BetterMyAdmin-only directive (not in phpMyAdmin). */
  bma: boolean
  userPref: boolean
  /** Present in phpMyAdmin's Settings::asArray() dump. */
  inPma: boolean
}

export interface MessageItem {
  key: string
  msgid: string
  context: string | null
  plural: string | null
  /** `file:line` of every use in phpMyAdmin (pot references ∪ our own scan of src/templates/js). */
  refs: string[]
}

export interface Inventories {
  routes: Inventory<RouteItem>
  controls: Inventory<ControlItem>
  directives: Inventory<DirectiveItem>
  messages: Inventory<MessageItem>
}

const GENERATED = 'by `pnpm parity:inventory` from the phpMyAdmin reference checkout; do not edit'

function php(script: string, pma: string): string {
  return execFileSync('php', [join(PARITY, 'php', script), pma], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

function meta(commit: string, source: string, count: number): InventoryMeta {
  return { generated: GENERATED, referenceCommit: commit, source, count }
}

// ---------------------------------------------------------------------------

export function extractRoutes(pma: string, commit: string): Inventory<RouteItem> {
  const raw = JSON.parse(php('routes.php', pma)) as Omit<RouteItem, 'key'>[]
  const items = raw
    .map((r) => ({ key: r.scope === 'setup' ? `setup:${r.path}` : r.path, ...r }))
    .sort((a, b) => a.key.localeCompare(b.key))
  return {
    _meta: meta(
      commit,
      'src/Routing/Routes.php::collect (FastRoute collector, executed) + Routing::callSetupController',
      items.length,
    ),
    items,
  }
}

export function extractControls(pma: string, commit: string): Inventory<ControlItem> {
  const dir = join(pma, 'resources/templates')
  const items: ControlItem[] = []
  for (const template of walk(dir, (r) => r.endsWith('.twig'))) {
    for (const c of parseTemplate(template, readFileSync(join(dir, template), 'utf8'))) {
      items.push({ ...c, file: `resources/templates/${template}` })
    }
  }
  items.push(...extractHelperControls(pma))
  items.sort((a, b) => a.template.localeCompare(b.template) || a.line - b.line || a.key.localeCompare(b.key))
  return {
    _meta: meta(
      commit,
      'resources/templates/**/*.twig (HTML controls, links, link_or_button) + PHP helpers (tools/parity/php/helpers.php)',
      items.length,
    ),
    items,
  }
}

interface HelperUse {
  file: string
  line: number
  helper: string
  kind: 'link' | 'select'
  id: string | null
  name: string | null
  label: string | null
}

/** Controls printed by PHP helpers (Generator::getNavigationLink/linkOrButton, Util::pageselector). */
export function extractHelperControls(pma: string): ControlItem[] {
  const uses = JSON.parse(php('helpers.php', pma)) as HelperUse[]
  const out = new Map<string, ControlItem>()
  for (const u of uses) {
    const local =
      u.id !== null
        ? `id:${u.id}`
        : u.name !== null
          ? u.name
          : u.label !== null
            ? `link:${u.label}`
            : u.kind === 'select'
              ? 'select:pageselector'
              : null
    if (local === null) continue // an unlabelled dynamic link has no stable identity
    const key = `${u.file}#${local}`
    const prev = out.get(key)
    if (prev !== undefined) {
      prev.count++
      continue
    }
    out.set(key, {
      key,
      template: u.file,
      local,
      kind: u.kind,
      ...(u.id !== null ? { id: u.id } : {}),
      ...(u.name !== null ? { name: u.name } : {}),
      ...(u.label !== null ? { label: u.label } : {}),
      line: u.line,
      count: 1,
      file: u.file,
    })
  }
  return [...out.values()]
}

/** Flattens phpMyAdmin's Settings::asArray() into directive paths (`Servers/*` for the server template). */
export function flattenPmaSettings(
  settings: Record<string, unknown>,
  server: Record<string, unknown>,
): string[] {
  const out: string[] = []
  const isAssoc = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length > 0
  const visit = (prefix: string, obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix === '' ? k : `${prefix}/${k}`
      if (p === 'Servers') continue
      if (isAssoc(v)) visit(p, v)
      else out.push(p)
    }
  }
  visit('', settings)
  visit('Servers/*', server)
  return out
}

export function extractDirectives(pma: string, commit: string): Inventory<DirectiveItem> {
  const dump = JSON.parse(
    execFileSync('php', [join(REPO, 'packages/config/scripts/dump-pma-defaults.php'), pma], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as { settings: Record<string, unknown>; server: Record<string, unknown> }
  const pmaPaths = flattenPmaSettings(dump.settings, dump.server)
  const ours = schemaDirectives.map((d) => d.path)
  // a schema leaf covers the pma paths below it (e.g. a map-valued leaf like DefaultFunctions)
  const covered = (p: string) => ours.some((o) => o === p || p.startsWith(`${o}/`))
  const pmaSet = new Set(pmaPaths)
  const inPma = (o: string) => pmaSet.has(o) || pmaPaths.some((p) => p.startsWith(`${o}/`))
  const items: DirectiveItem[] = schemaDirectives.map((d) => ({
    key: d.path,
    source: 'schema' as const,
    type: d.node.type,
    bma: d.node.flags.bma,
    userPref: d.node.flags.userPref,
    inPma: inPma(d.path),
  }))
  for (const p of pmaPaths) {
    if (!covered(p))
      items.push({ key: p, source: 'pma-only', type: 'unknown', bma: false, userPref: false, inPma: true })
  }
  items.sort((a, b) => a.key.localeCompare(b.key))
  return {
    _meta: meta(
      commit,
      'packages/config schema leaves, cross-checked with phpMyAdmin Settings::asArray() (packages/config/scripts/dump-pma-defaults.php)',
      items.length,
    ),
    items,
  }
}

interface PhpUse {
  msgid: string
  plural: string | null
  context: string | null
  file: string
  line: number
  kind: 'twig' | 'php' | 'js'
}

export function extractMessages(pma: string, commit: string): Inventory<MessageItem> {
  const pot = parsePot(readFileSync(join(pma, 'resources/po/phpmyadmin.pot'), 'utf8'))
  const scanned = JSON.parse(php('messages.php', pma)) as { uses: PhpUse[] }
  const byKey = new Map<string, MessageItem>()
  for (const e of pot) {
    byKey.set(msgKey(e.msgid, e.context), {
      key: msgKey(e.msgid, e.context),
      msgid: e.msgid,
      context: e.context,
      plural: e.plural,
      refs: [...e.refs],
    })
  }
  for (const u of scanned.uses) {
    const key = msgKey(u.msgid, u.context)
    let item = byKey.get(key)
    if (item === undefined) {
      // used in the source but missing from the (older) pot: still a phpMyAdmin message
      item = { key, msgid: u.msgid, context: u.context, plural: u.plural, refs: [] }
      byKey.set(key, item)
    }
    const ref = `${u.file}:${u.line}`
    if (!item.refs.includes(ref)) item.refs.push(ref)
  }
  const items = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
  for (const it of items) it.refs.sort()
  return {
    _meta: meta(
      commit,
      'resources/po/phpmyadmin.pot ∪ uses found by tools/parity/php/messages.php (Twig AST, PHP tokens, JS Messages keys)',
      items.length,
    ),
    items,
  }
}

// ---------------------------------------------------------------------------

export function inventoryFile(kind: InventoryKind, dir = INVENTORY_DIR): string {
  return join(dir, `${kind}.json`)
}

export function extractAll(pma: string): Inventories {
  const commit = pmaHead(pma)
  if (commit === null) throw new Error(`No phpMyAdmin git checkout at ${pma} (set PMA_PATH).`)
  return {
    routes: extractRoutes(pma, commit),
    controls: extractControls(pma, commit),
    directives: extractDirectives(pma, commit),
    messages: extractMessages(pma, commit),
  }
}

export function writeInventories(inv: Inventories, dir = INVENTORY_DIR): void {
  for (const kind of INVENTORY_KINDS) writeJson(inventoryFile(kind, dir), inv[kind])
}

export function loadInventories(dir = INVENTORY_DIR): Inventories {
  const load = <T>(kind: InventoryKind): Inventory<T> => {
    const f = inventoryFile(kind, dir)
    if (!existsSync(f)) throw new Error(`Missing ${f}: run pnpm parity:inventory`)
    return readJson<Inventory<T>>(f)
  }
  return {
    routes: load<RouteItem>('routes'),
    controls: load<ControlItem>('controls'),
    directives: load<DirectiveItem>('directives'),
    messages: load<MessageItem>('messages'),
  }
}
