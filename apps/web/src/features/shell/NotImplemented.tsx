import { MessageBox } from '@bettermyadmin/ui'
export function NotImplemented() {
  return (
    <MessageBox type="notice" flush>
      This page is not implemented yet. See docs/architecture/13-roadmap-and-milestones.md for when it lands.
    </MessageBox>
  )
}
