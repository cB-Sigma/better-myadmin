import type { ReactNode } from 'react'

/**
 * The scope of the admin pages' phone layout (styles/mobile-admin.css): a `display: contents` box,
 * so it adds no layout box and the desktop render is unchanged; on phones (`@media (max-width:
 * 767px)`) the stylesheet restyles what is inside `.bma-admin` only (server pages, user accounts,
 * status, export/import, operations, routines/events/triggers, Designer, ER diagram).
 */
export function AdminPage({ children }: { children: ReactNode }) {
  return <div className="bma-admin contents">{children}</div>
}
