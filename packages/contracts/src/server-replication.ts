import { z } from 'zod'
import { AdminMessage, ReplicationStatusTable } from './server-admin.ts'

/**
 * Server › Replication (/server/replication): the page model ReplicationController hands to
 * server/replication/index.twig, and the actions it handles before rendering (control the replica,
 * skip errors, change the primary) plus the "Add replica replication user" form, which phpMyAdmin
 * posts to /server/privileges. docs/features/06-server-level.md#replication-serverreplication
 */

/**
 * The page variant, phpMyAdmin's POST flags: `primary_configure` (primary configuration wizard),
 * `replica_configure` (+ `replica_clear_screen`: the change-primary form), `primary_add_user`
 * (+ `replica_clear_screen`: the add-replica-user form).
 */
export const ReplicationView = z.enum(['', 'primary_configure', 'replica_configure', 'primary_add_user'])
export type ReplicationView = z.infer<typeof ReplicationView>

export const ReplicationQuery = z.object({
  view: ReplicationView.catch('').default(''),
  /** MariaDB multi-source: the connection whose replica status is shown (`primary_connection`) */
  primary_connection: z.string().optional(),
  /** add-replica-user form prefill (`username`, `hostname`) */
  username: z.string().optional(),
  hostname: z.string().optional(),
})
export type ReplicationQuery = z.input<typeof ReplicationQuery>

export const ReplicationPage = z.object({
  isSuperUser: z.boolean(),
  isPrimary: z.boolean(),
  view: ReplicationView,
  /** primary_replication.twig without `clear_screen`: status table and connected replicas */
  primary: z
    .object({
      statusTable: ReplicationStatusTable,
      replicas: z.array(z.object({ serverId: z.string(), host: z.string() })),
    })
    .nullable(),
  /** primary_add_replica_user.twig */
  addUser: z
    .object({
      usernameLength: z.number().int(),
      hostnameLength: z.number().int(),
      username: z.string(),
      hostname: z.string(),
      predefinedUsername: z.enum(['any', 'userdefined']),
      predefinedHostname: z.enum(['any', 'localhost', 'userdefined']),
      /** `has_username`: "No password" is preselected when a username was posted */
      hasUsername: z.boolean(),
      /** the current user's host when it is neither localhost nor 127.0.0.1 ("This host") */
      thisHost: z.string().nullable(),
    })
    .nullable(),
  /** primary_configuration.twig: the non-system databases of the multibox */
  primaryConfiguration: z.object({ databases: z.array(z.string()) }).nullable(),
  /** replica_configuration.twig */
  replica: z
    .object({
      /** MariaDB multi-source connection names (`Connection_name`); empty elsewhere */
      connections: z.array(z.string()),
      primaryConnection: z.string(),
      isReplica: z.boolean(),
      /**
       * The thread states (they choose the error boxes, link labels and actions). phpMyAdmin passes
       * them swapped and reads the IO state from Replica_SQL_Running (Q16, Q62: fixed).
       */
      sqlRunning: z.boolean(),
      ioRunning: z.boolean(),
      /** the `sr_replica_action` of the Full / SQL thread / IO thread links */
      fullAction: z.enum(['start', 'stop']),
      sqlAction: z.enum(['start', 'stop']),
      ioAction: z.enum(['start', 'stop']),
      statusTable: ReplicationStatusTable.nullable(),
    })
    .nullable(),
  /** change_primary.twig */
  changePrimary: z
    .object({
      serverId: z.number().int(),
      usernameLength: z.number().int(),
      hostnameLength: z.number().int(),
    })
    .nullable(),
})
export type ReplicationPage = z.infer<typeof ReplicationPage>

/** An action's message (null when phpMyAdmin sets none, e.g. skipping errors) and the page after it. */
export const ReplicationActionResponse = z.object({
  success: z.boolean(),
  message: AdminMessage.nullable(),
  page: ReplicationPage,
})
export type ReplicationActionResponse = z.infer<typeof ReplicationActionResponse>

/** `sr_replica_server_control`: Full start/stop, SQL or IO thread only, Reset replica */
export const ReplicaControlRequest = z.object({
  action: z.string(),
  control: z.string().nullable().default(null),
  primary_connection: z.string().optional(),
})
export type ReplicaControlRequest = z.input<typeof ReplicaControlRequest>

/** `sr_replica_skip_error` with `sr_skip_errors_count` (cast like PHP's (int)) */
export const ReplicaSkipErrorsRequest = z.object({
  count: z.string().default('1'),
  primary_connection: z.string().optional(),
})
export type ReplicaSkipErrorsRequest = z.input<typeof ReplicaSkipErrorsRequest>

/** `replica_changeprimary`: the change_primary.twig form */
export const ChangePrimaryRequest = z.object({
  username: z.string().default(''),
  password: z.string().default(''),
  hostname: z.string().default(''),
  port: z.string().default(''),
  primary_connection: z.string().optional(),
})
export type ChangePrimaryRequest = z.input<typeof ChangePrimaryRequest>

/** primary_add_replica_user.twig (posted to /server/privileges with `Repl_slave_priv=Y`) */
export const ReplicaUserRequest = z.object({
  pred_username: z.enum(['any', 'userdefined']).catch('userdefined').default('userdefined'),
  username: z.string().default(''),
  pred_hostname: z
    .enum(['any', 'localhost', 'thishost', 'hosttable', 'userdefined'])
    .catch('any')
    .default('any'),
  hostname: z.string().default(''),
  pred_password: z.enum(['none', 'userdefined']).catch('userdefined').default('userdefined'),
  pma_pw: z.string().default(''),
})
export type ReplicaUserRequest = z.input<typeof ReplicaUserRequest>

export const ReplicaUserResponse = z.object({
  success: z.boolean(),
  /** HTML (Message::error with `[em]`, Message::rawError) */
  message: AdminMessage,
  /** the statements as phpMyAdmin shows them (password masked) */
  sql: z.string(),
})
export type ReplicaUserResponse = z.infer<typeof ReplicaUserResponse>
