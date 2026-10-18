import { describe, expect, it } from 'vitest'
import { messageCard } from '../../../web/src/features/sql/message-card.ts'
import { getMessageCard } from '../../src/query/message.ts'
import { testConfig } from '../support/app.ts'

/**
 * The client builds Generator::getMessage's query card for messages of page actions (structure,
 * find and replace…) from the client-visible directives: it must be the server's getMessageCard
 * for every kind of statement and every SQLQuery / MaxCharactersInDisplayedSQL setting.
 */
const SQLS = [
  'ALTER TABLE `t` ADD INDEX(`a`);',
  "UPDATE `review` SET `body` = REPLACE(`body`, 'shop', 'store') WHERE `body` LIKE '%shop%'",
  'SELECT * FROM `t` WHERE 1',
  'EXPLAIN SELECT * FROM `t`',
  'ANALYZE FORMAT=JSON SELECT 1',
  'SHOW TABLES',
  `INSERT INTO t VALUES ('${'x'.repeat(1200)}')`,
  ';',
  '',
]

describe('the client query card is the server’s getMessageCard', () => {
  for (const cfgIn of [
    {},
    { SQLQuery: { Edit: false, Explain: false, ShowAsPHP: false, Refresh: false } },
    { MaxCharactersInDisplayedSQL: 20 },
    { ShowSQL: false },
  ]) {
    it(JSON.stringify(cfgIn), async () => {
      const cfg = testConfig(cfgIn as never)
      for (const sql of SQLS) {
        const server = await getMessageCard(sql, {
          cfg,
          showAsPhp: null,
          db: 'd',
          table: 't',
          profilingOn: false,
          profilingSupported: () => Promise.resolve(false),
        })
        const client = messageCard(sql, { db: 'd', table: 't' }, cfg as unknown as Record<string, unknown>)
        expect(client, sql.slice(0, 40)).toEqual(server)
      }
    })
  }
})
