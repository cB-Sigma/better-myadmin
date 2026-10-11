import type { EngineResponse, EnginesResponse, InnodbBufferPool } from '@bettermyadmin/contracts'
import { formatByteDown, formatNumber, sprintf } from '@bettermyadmin/i18n'
import { engineData } from '@bettermyadmin/kbs'
import { type AdminCtx, mysqlDocuUrl } from './context.ts'
import { num } from './status-data.ts'

const SUPPORT = { NO: 0, DISABLED: 1, YES: 2, DEFAULT: 3 } as const

interface EngineRow {
  Engine: string
  Comment: string
  Support: string
}

/**
 * SHOW STORAGE ENGINES keyed by Engine; on MySQL ≥ 5.7.8 the engines listed in
 * @@disabled_storage_engines (SessionCache) are marked DISABLED.
 * pma: src/StorageEngine.php::getStorageEngines
 */
export async function storageEngines(ctx: AdminCtx): Promise<Map<string, EngineRow>> {
  const rows = await ctx.dbi.fetchResultSimple('SHOW STORAGE ENGINES')
  const engines = new Map<string, EngineRow>()
  for (const r of rows) {
    engines.set(r.Engine ?? '', {
      Engine: r.Engine ?? '',
      Comment: r.Comment ?? '',
      Support: r.Support ?? '',
    })
  }
  if (!ctx.isMariaDb && ctx.versionInt >= 50708) {
    let disabled = ctx.dbi.cache.disabled_storage_engines
    if (typeof disabled !== 'string') {
      disabled = String((await ctx.dbi.fetchValue('SELECT @@disabled_storage_engines')) || '')
      ctx.dbi.cache.disabled_storage_engines = disabled
    }
    for (const e of (disabled as string).split(',')) {
      const row = engines.get(e)
      if (row !== undefined) row.Support = 'DISABLED'
    }
  }
  return engines
}

/** pma: src/Controllers/Server/EnginesController.php */
export async function enginesPage(ctx: AdminCtx): Promise<EnginesResponse> {
  const engines = await storageEngines(ctx)
  return {
    engines: [...engines.values()].map((e) => ({ engine: e.Engine, comment: e.Comment, support: e.Support })),
  }
}

type Details = { title?: string; desc?: string; type?: number }
interface EngineClass {
  variables: Record<string, Details>
  like: string
  helpPage: string
  infoPages: Record<string, string>
}

const ENGINE_CLASSES = engineData.engines as unknown as Record<string, EngineClass>

/** StorageEngine::getEngine: the engine plugin by lower-cased name, else the generic one. */
function engineClass(engine: string): EngineClass {
  return (
    ENGINE_CLASSES[engine.toLowerCase()] ?? {
      variables: {},
      like: '',
      helpPage: '{engine}-storage-engine',
      infoPages: {},
    }
  )
}

const DETAILS_TYPE_SIZE = 1
const DETAILS_TYPE_NUMERIC = 2

/** Util::extractValueFromFormattedSize (Pbxt::resolveTypeSize) */
function extractValueFromFormattedSize(size: string): number {
  const m = /^(\d+)([GM])B$/.exec(size)
  if (m !== null) return Number(m[1]) * 1024 ** (m[2] === 'G' ? 3 : 2)
  const k = /^(\d+)K$/.exec(size)
  if (k !== null) return Number(k[1]) * 1024
  return -1
}

/**
 * The detail page of a storage engine: support sentence, its variables, or an information page
 * (InnoDB Buffer Pool / InnoDB Status, PBXT Documentation).
 * pma: src/Controllers/Server/ShowEngineController.php, src/StorageEngine.php, src/Engines/*.php
 */
export async function enginePage(ctx: AdminCtx, engine: string, page: string): Promise<EngineResponse> {
  const { tr } = ctx
  const engines = await storageEngines(ctx)
  const empty: EngineResponse = {
    isValid: false,
    engine,
    title: '',
    comment: '',
    docUrl: '',
    infoPages: [],
    page,
    support: '',
    variables: [],
    pageContent: { kind: 'none' },
  }
  // StorageEngine::isValid (PBMS is always accepted)
  if (engine !== 'PBMS' && !engines.has(engine)) return empty
  const row = engines.get(engine)
  const title = row?.Engine ?? 'PMA Dummy Engine Class'
  const comment = row?.Comment ?? 'If you read this text inside phpMyAdmin, something went wrong...'
  const support =
    row === undefined
      ? SUPPORT.NO
      : row.Support === 'DEFAULT'
        ? SUPPORT.DEFAULT
        : row.Support === 'YES'
          ? SUPPORT.YES
          : row.Support === 'DISABLED'
            ? SUPPORT.DISABLED
            : SUPPORT.NO
  const cls = engineClass(engine)
  const lower = engine.toLowerCase()
  const isInnodb = lower === 'innodb' || lower === 'innobase'
  // the engine id of a known row is its name; an unknown (PBMS) keeps 'dummy'
  const engineId = row !== undefined ? engine : 'dummy'
  const infoPages = isInnodb && support < SUPPORT.YES ? {} : cls.infoPages
  const message =
    support === SUPPORT.DEFAULT
      ? tr.gettext('%s is the default storage engine on this MySQL server.')
      : support === SUPPORT.YES
        ? tr.gettext('%s is available on this MySQL server.')
        : support === SUPPORT.DISABLED
          ? tr.gettext('%s has been disabled for this MySQL server.')
          : tr.gettext('This MySQL server does not support the %s storage engine.')

  const out: EngineResponse = {
    isValid: true,
    engine,
    title,
    comment,
    docUrl: mysqlDocuUrl(cls.helpPage.replace('{engine}', engineId), '', ctx.versionInt),
    infoPages: Object.entries(infoPages).map(([id, label]) => ({ id, label: tr.gettext(label) })),
    page,
    support: sprintf(message, title),
    variables: await variablesStatus(ctx, cls, engineId),
    pageContent: { kind: 'none' },
  }

  // StorageEngine::getPage: only the pages the engine offers
  if (page !== '' && Object.hasOwn(infoPages, page)) {
    if (page === 'Bufferpool') out.pageContent = { kind: 'bufferpool', bufferPool: await bufferPool(ctx) }
    else if (page === 'Status') {
      const r = await ctx.dbi.tryQuery('SHOW ENGINE INNODB STATUS;')
      const i = r?.fields.indexOf('Status') ?? -1
      out.pageContent = { kind: 'status', status: (i >= 0 ? r?.rows[0]?.[i] : null) ?? '' }
    } else if (page === 'Documentation') {
      out.pageContent = {
        kind: 'documentation',
        html: sprintf(
          tr.gettext(
            'Documentation and further information about PBXT can be found on the %sPrimeBase XT Home Page%s.',
          ),
          '<a href="https://mariadb.com/kb/en/about-pbxt/" rel="noopener noreferrer" target="_blank">',
          '</a>',
        ),
      }
    }
  }
  return out
}

/** StorageEngine::getVariablesStatus + the value formatting of getHtmlVariables */
async function variablesStatus(ctx: AdminCtx, cls: EngineClass, engineId: string) {
  const { tr } = ctx
  const like = cls.like !== '' ? ` LIKE '${cls.like}' ` : ''
  const res = await ctx.conn.rows(`SHOW GLOBAL VARIABLES ${like};`, 'engines.variables')
  const out: EngineResponse['variables'] = []
  for (const r of res) {
    const name = r.Variable_name ?? ''
    const value = r.Value ?? ''
    const info = Object.hasOwn(cls.variables, name) ? cls.variables[name] : undefined
    // mb_stripos($variableName, $this->engine) !== 0
    if (info === undefined && like === '' && !name.toLowerCase().startsWith(engineId.toLowerCase())) continue
    const type = info?.type ?? 0
    let shown: string
    if (type === DETAILS_TYPE_SIZE) {
      const v =
        engineId.toLowerCase() === 'pbxt' && /^[0-9]+[a-zA-Z]+$/.test(value)
          ? extractValueFromFormattedSize(value)
          : value
      const [n, unit] = formatByteDown(tr, v)!
      shown = `${n} ${unit}`
    } else if (type === DETAILS_TYPE_NUMERIC) {
      shown = formatNumber(tr, value)
    } else {
      shown = value
    }
    out.push({
      name,
      title: info?.title !== undefined && info.title !== '' ? tr.gettext(info.title) : name,
      desc: info?.desc !== undefined ? tr.gettext(info.desc) : null,
      value: shown,
    })
  }
  return out
}

/** Innodb::getBufferPoolStatus + engines/_innodb_buffer_pool.twig */
async function bufferPool(ctx: AdminCtx): Promise<InnodbBufferPool> {
  const { tr } = ctx
  const r = await ctx.dbi.tryQuery(
    "SHOW STATUS WHERE Variable_name LIKE 'Innodb\\_buffer\\_pool\\_%' OR Variable_name = 'Innodb_page_size';",
  )
  const kv: Record<string, string> = {}
  for (const row of r?.rows ?? []) kv[row[0] ?? ''] = row[1] ?? ''
  const isNum = (v: string | undefined) =>
    v !== undefined && /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(v)
  const get = (k: string) => (isNum(kv[k]) ? kv[k]! : '0')
  const fmt = (k: string) => formatNumber(tr, get(k), 0)
  const readRequests = num(get('Innodb_buffer_pool_read_requests'))
  const writeRequests = num(get('Innodb_buffer_pool_write_requests'))
  const latched = kv.Innodb_buffer_pool_pages_latched
  return {
    pagesFree: fmt('Innodb_buffer_pool_pages_free'),
    pagesDirty: fmt('Innodb_buffer_pool_pages_dirty'),
    pagesData: fmt('Innodb_buffer_pool_pages_data'),
    pagesFlushed: fmt('Innodb_buffer_pool_pages_flushed'),
    pagesMisc: fmt('Innodb_buffer_pool_pages_misc'),
    pagesLatched: isNum(latched) ? formatNumber(tr, latched!, 0) : null,
    totalPages: sprintf(tr.gettext('%s pages'), fmt('Innodb_buffer_pool_pages_total')),
    totalSize: formatByteDown(
      tr,
      num(get('Innodb_buffer_pool_pages_total')) * num(get('Innodb_page_size')),
    )!.join(' '),
    readRequests: fmt('Innodb_buffer_pool_read_requests'),
    writeRequests: fmt('Innodb_buffer_pool_write_requests'),
    reads: fmt('Innodb_buffer_pool_reads'),
    waitFree: fmt('Innodb_buffer_pool_wait_free'),
    readMissesPct:
      readRequests !== 0
        ? `${formatNumber(tr, (num(get('Innodb_buffer_pool_reads')) * 100) / readRequests, 3, 2)}%`
        : '---',
    writeWaitsPct:
      writeRequests !== 0
        ? `${formatNumber(tr, (num(get('Innodb_buffer_pool_wait_free')) * 100) / writeRequests, 3, 2)}%`
        : '---',
  }
}
