/**
 * @bettermyadmin/config — every phpMyAdmin `$cfg` directive, typed, validated and loaded from
 * defaults <- `bettermyadmin.config.*` <- environment.
 */
export { defaultConfig, defaults, serverDefaults } from './defaults.ts'
export {
  DOCKER_ENV_NAMES,
  type DockerEnvLayer,
  ENV_DOCKER,
  iniQuantity,
  parseDockerEnv,
} from './docker-env.ts'
export { ENV_CONFIG_FILE, ENV_PREFIX, ENV_SHORTCUTS, type EnvLayer, parseEnv } from './env.ts'
export {
  FORM_FIELDS,
  FORM_VALIDATORS,
  type FormDef,
  type FormFieldDef,
  type FormFieldType,
  type FormItem,
  type FormMsg,
  type FormSelectValue,
  type FormTabDef,
  type FormValidator,
  formFields,
  PAGE_FORMS,
  pageFormTab,
  SETUP_FORMS,
  setupFormTab,
  USER_FORMS,
  USER_VALIDATORS,
  userFormFieldPaths,
  userFormTab,
} from './forms.ts'
export { type ConfigIssue, ConfigError, formatIssue } from './errors.ts'
export {
  CONFIG_FILE_NAMES,
  defineConfig,
  type LoadConfigOptions,
  type LoadedConfig,
  loadConfig,
  readConfigFile,
} from './loader.ts'
export type { AnyNode, DirectiveFlags, GroupNode, LeafNode, LeafType, ServersNode } from './nodes.ts'
export { importPmaConfig, PmaImportError, type PmaImportOptions, type PmaImportResult } from './pma-import.ts'
export { type PublicConfig, publicConfig } from './public.ts'
export {
  expectation,
  type Layer,
  type ResolveResult,
  resolveConfig,
  resolveLayers,
  validateConfig,
} from './resolve.ts'
export {
  CLIENT_VISIBLE_EXTRA_PATHS,
  type ConfigInput,
  configNode,
  directiveCount,
  directives,
  REMOVED_DIRECTIVES,
  type ResolvedConfig,
  resolvedConfigSchema,
  type ServerConfig,
  type ServerInput,
  serverNode,
  USERPREF_PATHS,
} from './schema.ts'
export { suggestionDistance } from './suggest.ts'
