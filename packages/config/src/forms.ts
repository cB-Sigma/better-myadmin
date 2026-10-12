/**
 * phpMyAdmin's user preference forms (Settings tabs) and page settings forms, as data.
 *
 * generated/pma-forms.json is produced by scripts/dump-pma-forms.php running phpMyAdmin itself
 * (`pnpm --filter @bettermyadmin/config forms:pma`): the tab → form → field order with `:group:`
 * headers, each field's type (Form::readTypes), its select values (Form::getOptionValueList),
 * the Descriptions msgids (BBCode kept, translated at render time) and the validators.
 *
 * pma: src/Config/Forms/User/*, src/Config/Forms/Page/*, src/Config/Descriptions.php,
 *      src/Config/ConfigFile.php::getAllowedValues (_validators, _userValidators)
 */
import data from './generated/pma-forms.json' with { type: 'json' }

/** Form::getOptionType: `gettype()` of the default, or the ConfigFile db entry. */
export type FormFieldType = 'boolean' | 'integer' | 'double' | 'string' | 'short_string' | 'select' | 'array'

export interface FormMsg {
  msgid: string
  context?: string
}

/** One option of a select: its PHP array key and label (a msgid, or a raw scalar like `25` / `false`). */
export interface FormSelectValue {
  key: string | number
  label: FormMsg | number | boolean
}

export interface FormFieldDef {
  type: FormFieldType
  values?: FormSelectValue[]
  /** the values list is `['', ...$cfg['AvailableCharsets']]` (keys = values) */
  valuesFrom?: 'AvailableCharsets'
  /** Descriptions::getString(path, 'name' | 'desc' | 'cmt'): untranslated, BBCode kept */
  name?: string
  desc?: string
  cmt?: string
}

/** A field, a `:group:<title>` header or a `:group:end`. `setvalue` is a `'path' => ':group'` entry. */
export type FormItem = { path: string; setvalue?: string } | { group: string } | { groupEnd: true }

export interface FormDef {
  /** form name, also the tab id (`Sql_queries`) */
  name: string
  /** Descriptions `Form_<name>` name / desc */
  title: string
  desc: string
  items: FormItem[]
}

export interface FormTabDef {
  /** UserFormList / PageFormList key: Features, Sql, Navi, Main, Export, Import (Browse, Edit, … for pages) */
  tab: string
  /** BaseForm::getName() msgid ('' for page forms that have none) */
  name: string
  forms: FormDef[]
}

/** One validator call: `[name, ...args]` of ConfigFile `_validators` / `_userValidators`. */
export interface FormValidator {
  name: string
  args: string[]
}

type RawValidators = Record<string, string | Array<string | string[]>>

function normaliseValidators(raw: RawValidators): Record<string, FormValidator[]> {
  const out: Record<string, FormValidator[]> = {}
  for (const [path, v] of Object.entries(raw)) {
    out[path] = (Array.isArray(v) ? v : [v]).map((x) => {
      const [name, ...args] = Array.isArray(x) ? x : [x]
      return { name: name as string, args }
    })
  }
  return out
}

const json = data as unknown as {
  user: FormTabDef[]
  page: FormTabDef[]
  setup: FormTabDef[]
  fields: Record<string, FormFieldDef>
  validators: RawValidators
  userValidators: RawValidators
}

/** UserFormList, every tab (FeaturesForm lists `Developer` only when UserprefsDeveloperTab). */
export const USER_FORMS: readonly FormTabDef[] = json.user
/** PageFormList (PageSettings::init groups). */
export const PAGE_FORMS: readonly FormTabDef[] = json.page
/** SetupFormList: the setup script's form sets (Config, Export, Features, …, Servers, Sql). */
export const SETUP_FORMS: readonly FormTabDef[] = json.setup
/** Every field of the user, page and setup forms. */
export const FORM_FIELDS: Readonly<Record<string, FormFieldDef>> = json.fields
/** ConfigFile `_validators` */
export const FORM_VALIDATORS: Readonly<Record<string, FormValidator[]>> = normaliseValidators(json.validators)
/** ConfigFile `_userValidators`; `value:<path>` arguments are read from the base configuration. */
export const USER_VALIDATORS: Readonly<Record<string, FormValidator[]>> = normaliseValidators(
  json.userValidators,
)

/** UserFormList::get(tab) with FeaturesForm's UserprefsDeveloperTab condition. */
export function userFormTab(tab: string, developerTab: boolean): FormTabDef | undefined {
  const def = USER_FORMS.find((t) => t.tab === tab)
  if (def === undefined || def.tab !== 'Features' || developerTab) return def
  return { ...def, forms: def.forms.filter((f) => f.name !== 'Developer') }
}

/** SetupFormList::get(formset) */
export function setupFormTab(formset: string): FormTabDef | undefined {
  return SETUP_FORMS.find((t) => t.tab === formset)
}

/** PageFormList::get(group) */
export function pageFormTab(group: string): FormTabDef | undefined {
  return PAGE_FORMS.find((t) => t.tab === group)
}

/** BaseForm::getFields / UserFormList::getFields: every field path (keys of `'path' => ':group'` too). */
export function formFields(tabs: readonly FormTabDef[]): string[] {
  const out: string[] = []
  for (const t of tabs) for (const f of t.forms) for (const i of f.items) if ('path' in i) out.push(i.path)
  return out
}

/** UserFormList::getFields() */
export function userFormFieldPaths(developerTab: boolean): string[] {
  return formFields(USER_FORMS.map((t) => userFormTab(t.tab, developerTab)).filter((t) => t !== undefined))
}
