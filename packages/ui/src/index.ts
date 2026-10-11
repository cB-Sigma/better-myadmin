/**
 * @bettermyadmin/ui — shadcn/ui-based component kit with the dense admin preset.
 * Components never import app state: directives they honour come through <UiSettingsProvider>.
 */
export { cn } from './lib/cn.ts'
export {
  type LinkMode,
  type UiSettings,
  UiSettingsProvider,
  defaultUiSettings,
  useUiSettings,
} from './settings.tsx'
export { iconParts, showIcons, showText } from './lib/link-mode.ts'
export { mysqlDocUrl, phpDocUrl, pmaDocUrl, serverDocUrl } from './lib/doc-urls.ts'
export {
  DISMISS_CLICK_MS,
  DISMISS_HINT,
  LOADING,
  type MessagePolicy,
  type MessageType,
  PROCESSING_REQUEST,
  messagePolicy,
} from './lib/messages.ts'
export { HAMBURGER_BREAKPOINT, visibleTabCount } from './lib/overflow.ts'
export { disclosureInitial } from './lib/sliders.ts'
export { type PmaIconName, pmaIcons } from './icons/pma-map.ts'

export { Button, type ButtonProps, buttonVariants } from './components/button.tsx'
export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Modal,
} from './components/dialog.tsx'
export {
  ConfirmDialog,
  type ConfirmDialogProps,
  type ConfirmOptions,
  ConfirmProvider,
  useConfirm,
} from './components/confirm-dialog.tsx'
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipProvider,
} from './components/menus.tsx'
export {
  Checkbox,
  Combobox,
  type ComboboxProps,
  FormRow,
  Input,
  Label,
  NativeSelect,
  Radio,
  Select,
  type SelectOption,
  type SelectProps,
  Textarea,
} from './components/form.tsx'
export { Alert, Panel, PanelBody, PanelItem, PanelList } from './components/panel.tsx'
export { MessageBox, type MessageBoxProps, type MessageBoxType, MessageLine } from './components/message.tsx'
export { Loading, PageHeader, Table } from './components/page.tsx'
export { PreviewSqlDialog } from './components/preview-sql.tsx'
export {
  SAFE_HTML_ATTRS,
  SAFE_HTML_TAGS,
  SafeHtml,
  type SafeHtmlProfile,
  TRANSFORMATION_HTML_ATTRS,
  TRANSFORMATION_HTML_TAGS,
  sanitizeHtml,
  sanitizeToFragment,
  stripTags,
} from './components/safe-html.tsx'
export { type MessageHandle, Toaster, removeMessage, showMessage } from './components/toaster.tsx'
export { Disclosure, type DisclosureProps } from './components/disclosure.tsx'
export { DocLink, Hint, MySqlDocLink } from './components/doc-link.tsx'
export { IconLink, type IconLinkProps, IconText, PmaIcon } from './components/icon.tsx'
export { TabBar, type TabBarProps, type TabItem, type TabLinkComponent } from './components/tab-bar.tsx'
export { NavPills, type NavPillItem, NavTabs, type NavTabItem } from './components/nav.tsx'
