import type { AgentCtx } from './service.ts'
import { describeTable, explain, listDatabases, listTables, runQuery } from './service.ts'

/**
 * The agent API as an MCP server (Model Context Protocol, Streamable HTTP transport, stateless):
 * one JSON-RPC request per POST, answered with JSON. Its tools are the agent API's endpoints.
 * https://modelcontextprotocol.io/specification
 */

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data?: unknown } }

const str = (description: string) => ({ type: 'string', description })

export const MCP_TOOLS = [
  {
    name: 'list_databases',
    description: 'The databases this MySQL user can see.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_tables',
    description: 'The tables and views of a database, with engine, estimated row count and comment.',
    inputSchema: {
      type: 'object',
      properties: { database: str('The database name.') },
      required: ['database'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'describe_table',
    description:
      "A table's columns (type, nullability, key, default, comment), indexes and CREATE TABLE statement.",
    inputSchema: {
      type: 'object',
      properties: { database: str('The database name.'), table: str('The table or view name.') },
      required: ['database', 'table'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'query',
    description:
      'Runs SQL (one or more statements separated by ";") with this MySQL user\'s privileges and returns each statement\'s rows or affected-row count. A SELECT without LIMIT returns at most max_rows rows ("truncated" says when there were more). Execution stops at the first error.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: str('The SQL to run.'),
        database: str('The default database for unqualified table names.'),
        max_rows: {
          type: 'integer',
          minimum: 1,
          maximum: 10000,
          description: 'Row limit per result (default: MaxRows).',
        },
      },
      required: ['sql'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'explain',
    description: "The server's EXPLAIN plan of one statement.",
    inputSchema: {
      type: 'object',
      properties: { sql: str('The statement to explain.'), database: str('The default database.') },
      required: ['sql'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
] as const

class ToolInputError extends Error {}

function arg(args: Record<string, unknown>, name: string, required: true): string
function arg(args: Record<string, unknown>, name: string, required?: false): string | undefined
function arg(args: Record<string, unknown>, name: string, required = false): string | undefined {
  const v = args[name]
  if (v === undefined || v === null) {
    if (required) throw new ToolInputError(`Missing argument: ${name}`)
    return undefined
  }
  if (typeof v !== 'string') throw new ToolInputError(`Argument ${name} must be a string`)
  return v
}

async function callTool(ctx: AgentCtx, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'list_databases':
      return { databases: await listDatabases(ctx) }
    case 'list_tables':
      return { tables: await listTables(ctx, arg(args, 'database', true)) }
    case 'describe_table':
      return describeTable(ctx, arg(args, 'database', true), arg(args, 'table', true))
    case 'query': {
      const max = args.max_rows
      if (max !== undefined && (typeof max !== 'number' || !Number.isInteger(max) || max < 1))
        throw new ToolInputError('Argument max_rows must be a positive integer')
      const db = arg(args, 'database')
      return runQuery(ctx, {
        sql: arg(args, 'sql', true),
        ...(db !== undefined ? { db } : {}),
        ...(max !== undefined ? { maxRows: max as number } : {}),
      })
    }
    case 'explain': {
      const db = arg(args, 'database')
      return explain(ctx, { sql: arg(args, 'sql', true), ...(db !== undefined ? { db } : {}) })
    }
    default:
      return undefined
  }
}

/** The result of tools/call: the JSON as text (and structured), isError for a failed statement. */
function toolResult(value: unknown) {
  const failed =
    typeof value === 'object' &&
    value !== null &&
    ((value as { error?: unknown }).error !== undefined ||
      ((value as { statements?: Array<{ error?: unknown }> }).statements ?? []).some(
        (s) => s.error !== undefined,
      ))
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
    isError: failed,
  }
}

/**
 * One JSON-RPC message. `connect` authenticates and opens the connection only for the methods that
 * need the database (tools/call), so initialize and tools/list answer without credentials checks
 * beyond the route's own.
 */
export async function handleMcp(
  msg: unknown,
  version: string,
  connect: <T>(fn: (ctx: AgentCtx) => Promise<T>) => Promise<T>,
): Promise<JsonRpcResponse | null> {
  if (typeof msg !== 'object' || msg === null || (msg as JsonRpcRequest).jsonrpc !== '2.0')
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
  const req = msg as JsonRpcRequest
  const id = req.id ?? null
  // a notification (no id): nothing to answer
  if (req.id === undefined) return null
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
  const fail = (code: number, message: string): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  })
  switch (req.method) {
    case 'initialize': {
      const asked = String(req.params?.protocolVersion ?? '')
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
        ? asked
        : MCP_PROTOCOL_VERSIONS[0]
      return ok({
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'bettermyadmin', title: 'BetterMyAdmin', version },
        instructions:
          'Tools for one MySQL / MariaDB server, as the signed-in MySQL user: list_databases, list_tables and describe_table to explore, query to run SQL (with that user\'s privileges), explain for query plans. Values come back as text (numbers exactly as the server sent them), NULL as null, binary data as {"base64": …}.',
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: MCP_TOOLS })
    case 'tools/call': {
      const name = String(req.params?.name ?? '')
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>
      if (!MCP_TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`)
      if (typeof args !== 'object' || args === null || Array.isArray(args))
        return fail(-32602, 'arguments must be an object')
      try {
        return ok(toolResult(await connect((ctx) => callTool(ctx, name, args))))
      } catch (e) {
        if (e instanceof ToolInputError) return fail(-32602, e.message)
        // an error of the database (unknown database, a privilege): the tool's result, not the protocol's
        const message = e instanceof Error ? e.message : String(e)
        if ((e as { status?: number }).status === 401) throw e
        return ok({ content: [{ type: 'text', text: message }], isError: true })
      }
    }
    default:
      return fail(-32601, `Method not found: ${req.method}`)
  }
}
