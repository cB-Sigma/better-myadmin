import { getForeignKeysData } from '@bettermyadmin/metadata'
import { describe, expect, it } from 'vitest'
import { checkChildForeignReferences } from '../../src/table/forms.ts'

/** The change form before MySQL 5.6.6 (ColumnsDefinition::displayForm): Relation::checkChildForeignReferences. */
describe('checkChildForeignReferences', () => {
  const create = `CREATE TABLE \`c\` (
  \`id\` int NOT NULL,
  \`p\` int DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`p\` (\`p\`),
  CONSTRAINT \`c_ibfk_1\` FOREIGN KEY (\`p\`) REFERENCES \`parent\` (\`id\`)
) ENGINE=InnoDB`
  const foreigners = getForeignKeysData(create)
  const reader = (children: Record<string, Array<{ table_schema: string; table_name: string }>>) => ({
    childReferences: async (_db: string, _t: string, column: string, disableIs: boolean) =>
      disableIs ? [] : (children[column] ?? []),
  })

  it('a free column stays editable', async () => {
    expect(await checkChildForeignReferences(reader({}), 'd', 'c', 'v', foreigners, false)).toEqual({
      isEditable: true,
      isReferenced: false,
      isForeignKey: false,
      references: [],
    })
  })

  it('a foreign key column, and one referenced by other tables, are locked', async () => {
    const r = reader({
      id: [
        { table_schema: 'd', table_name: 'k1' },
        { table_schema: 'e', table_name: 'k`2' },
      ],
    })
    expect(await checkChildForeignReferences(r, 'd', 'c', 'p', foreigners, false)).toEqual({
      isEditable: false,
      isReferenced: false,
      isForeignKey: true,
      references: [],
    })
    expect(await checkChildForeignReferences(r, 'd', 'c', 'id', foreigners, false)).toEqual({
      isEditable: false,
      isReferenced: true,
      isForeignKey: false,
      references: ['`d`.`k1`', '`e`.`k``2`'],
    })
    // DisableIS: getChildReferences reads nothing
    expect((await checkChildForeignReferences(r, 'd', 'c', 'id', foreigners, true)).isEditable).toBe(true)
  })
})
