import type { NavNode, NavPageSelector, NavSettings } from '@bettermyadmin/contracts'
import { useRouter } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react'
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { navIcon } from './icons'
import { navHref } from './links'
import type { Row } from './rows'
import type { NavTreeStore } from './store'

const HEIGHT = { node: 22, filter: 34, pager: 30 } as const
const INDENT = 14

export interface NavTreeProps {
  store: NavTreeStore
  rows: Row[]
  settings: NavSettings
  /** Extension point: controls after a node's text (hide / show hidden items). */
  nodeControls?: ((node: NavNode) => ReactNode) | undefined
  /** Hover prefetch of a branch (database and container nodes). */
  onPrefetch?: ((node: NavNode) => void) | undefined
}

/** The tree as one flat, virtualized list of visible rows (docs/architecture/03-frontend-architecture.md#navigation-tree). */
export function NavTree({ store, rows, settings, nodeControls, onPrefetch }: NavTreeProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => HEIGHT[(rows[i] as Row).type],
    getItemKey: (i) => (rows[i] as Row).key,
    overscan: 12,
  })

  // scrollToView: keep the highlighted item visible (to the top for a database)
  const request = store.scrollRequest
  useEffect(() => {
    if (request === null) return
    const i = rows.findIndex((r) => r.key === request.key)
    if (i >= 0) virtualizer.scrollToIndex(i, { align: request.toTop ? 'start' : 'auto' })
    store.scrollRequest = null
  }, [request, rows, store, virtualizer])

  return (
    <div
      ref={parentRef}
      id="pma_navigation_tree_content"
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      role="tree"
      aria-label="Databases"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index] as Row
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: vi.size,
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {row.type === 'node' ? (
                <NodeRow
                  row={row}
                  store={store}
                  pointer={settings.NavigationTreePointerEnable}
                  nodeControls={nodeControls}
                  onPrefetch={onPrefetch}
                />
              ) : row.type === 'filter' ? (
                <FilterRow row={row} store={store} />
              ) : (
                <PagerRow row={row} store={store} mode={settings.TableNavigationLinksMode} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function useNavigate() {
  const router = useRouter()
  return (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    router.history.push(href)
  }
}

function NodeRow({
  row,
  store,
  pointer,
  nodeControls,
  onPrefetch,
}: {
  row: Extract<Row, { type: 'node' }>
  store: NavTreeStore
  pointer: boolean
  nodeControls?: ((node: NavNode) => ReactNode) | undefined
  onPrefetch?: ((node: NavNode) => void) | undefined
}) {
  const { node, depth } = row
  const go = useNavigate()
  const href = (route: string, params: NavNode['icons'][number]['params']) =>
    navHref(store.server, route, params)
  const italic = node.kind === 'container' || node.isNew
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textLink = node.link
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={node.expandable ? row.expanded : undefined}
      aria-selected={row.selected}
      data-kind={node.kind}
      data-name={node.realName}
      className={clsx(
        'flex h-[22px] items-center gap-1 whitespace-nowrap pr-1 text-[13px]',
        node.classes,
        pointer && 'hover:bg-nav-pointer',
        row.selected && 'selected bg-nav-pointer font-semibold',
        italic && 'italic',
      )}
      style={{ paddingLeft: 4 + depth * INDENT }}
      onMouseEnter={() => {
        if (onPrefetch === undefined || !node.expandable || node.loaded) return
        timer.current = setTimeout(() => onPrefetch(node), 50)
      }}
      onMouseLeave={() => {
        if (timer.current !== null) clearTimeout(timer.current)
      }}
    >
      {node.expandable ? (
        <button
          type="button"
          className="flex size-4 shrink-0 items-center justify-center rounded text-fg-muted hover:text-fg"
          title="Expand/Collapse"
          aria-label="Expand/Collapse"
          onClick={() => void store.toggle(node)}
        >
          {row.loading ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          ) : row.expanded ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
        </button>
      ) : (
        <span className="size-4 shrink-0" />
      )}
      {node.kind === 'group' ? (
        <>
          {node.icons.map((i) => {
            const Icon = navIcon(i.image)
            return <Icon key={i.image} className="size-3.5 shrink-0 text-fg-muted" aria-label={i.title} />
          })}
          <FullName className="text-fg">{node.label}</FullName>
        </>
      ) : (
        <>
          {node.icons.map((i) => {
            const Icon = navIcon(i.image)
            const h = href(i.route, i.params)
            return (
              <a
                key={`${i.image}${i.route}`}
                href={h}
                onClick={(e) => go(e, h)}
                title={i.title}
                className="shrink-0 text-fg-muted hover:text-accent"
              >
                <Icon className="size-3.5" aria-hidden />
                <span className="sr-only">{i.title}</span>
              </a>
            )
          })}
          {textLink !== null && (
            <FullName>
              <a
                href={href(textLink.route, textLink.params)}
                onClick={(e) => go(e, href(textLink.route, textLink.params))}
                title={textLink.title === '' ? undefined : textLink.title}
                className="hover_show_full text-fg hover:text-accent hover:no-underline"
              >
                {node.label}
              </a>
            </FullName>
          )}
        </>
      )}
      {nodeControls?.(node)}
    </div>
  )
}

/** A name that may be wider than the panel: hovering shows it whole (pma: showFullName). */
function FullName({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [layer, setLayer] = useState<{ left: number; top: number } | null>(null)
  return (
    <span
      ref={ref}
      className={clsx('min-w-0 truncate', className)}
      onMouseEnter={() => {
        const el = ref.current
        if (el === null || el.scrollWidth <= el.clientWidth) return
        const r = el.getBoundingClientRect()
        setLayer({ left: r.left, top: r.top })
      }}
      onMouseLeave={() => setLayer(null)}
    >
      {children}
      {layer !== null && (
        <span
          id="full_name_layer"
          className="pointer-events-none fixed z-50 rounded border border-border bg-bg-elevated px-1 shadow"
          style={{ left: layer.left, top: layer.top }}
          aria-hidden
        >
          {children}
        </span>
      )}
    </span>
  )
}

function FilterRow({ row, store }: { row: Extract<Row, { type: 'filter' }>; store: NavTreeStore }) {
  const { ownerKey } = row
  const kind = row.filter.kind
  const value = store.filters.get(ownerKey) ?? ''
  const label = 'Type to filter these, Enter to search all'
  return (
    <div
      className={clsx('fast_filter flex items-center gap-1 py-1 pr-1', kind === 'db' && 'db_fast_filter')}
      style={{ paddingLeft: 4 + row.depth * INDENT }}
    >
      <input
        className="searchClause h-6 min-w-0 flex-1 rounded border border-border bg-bg px-1.5 text-[13px]"
        type="text"
        name={kind === 'db' ? 'searchClause' : 'searchClause2'}
        // biome-ignore lint/a11y/noAccessKey: phpMyAdmin's fast filter has accesskey="q"
        accessKey="q"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => store.setFilter(ownerKey, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void store.search(row.filter, ownerKey, e.currentTarget.value)
        }}
      />
      <button
        type="button"
        className="searchClauseClear h-6 rounded border border-border px-1.5 text-xs hover:bg-bg-subtle"
        aria-label="Clear fast filter"
        onClick={() => store.clearFilter(ownerKey)}
      >
        X
      </button>
    </div>
  )
}

function PagerRow({
  row,
  store,
  mode,
}: {
  row: Extract<Row, { type: 'pager' }>
  store: NavTreeStore
  mode: NavSettings['TableNavigationLinksMode']
}) {
  const p: NavPageSelector = row.selector
  const icons = mode !== 'text'
  const text = mode !== 'icons'
  const go = (v: number | null) => {
    if (v !== null) void store.paginate(p, row.ownerKey, v)
  }
  const btn = 'rounded px-1 text-accent hover:bg-bg-subtle disabled:opacity-40'
  const link = (v: number | null, title: string, symbol: string, before: boolean) =>
    v === null ? null : (
      <button type="button" className={btn} title={title} onClick={() => go(v)}>
        {before && icons && symbol}
        {before && icons && text && ' '}
        {text && title}
        {!before && icons && text && ' '}
        {!before && icons && symbol}
      </button>
    )
  return (
    <div
      className={clsx(
        'pageselector flex items-center gap-0.5 py-0.5 text-[13px]',
        p.paramName === 'pos' && 'dbselector',
      )}
      style={{ paddingLeft: 4 + row.depth * INDENT }}
    >
      {link(p.begin, 'Begin', '<<', true)}
      {link(p.prev, 'Previous', '<', true)}
      <select
        className="pageselector h-6 rounded border border-border bg-bg px-1 text-[13px]"
        name={p.paramName}
        aria-label="Page number:"
        value={String(p.pages.find((x) => x.selected)?.value ?? p.pages[0]?.value ?? 0)}
        onChange={(e) => go(Number(e.target.value))}
      >
        {p.pages.map((x) => (
          <option key={x.value} value={x.value}>
            {x.page}
          </option>
        ))}
      </select>
      {link(p.next, 'Next', '>', false)}
      {link(p.end, 'End', '>>', false)}
    </div>
  )
}
