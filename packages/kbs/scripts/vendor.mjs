// Copies the knowledge base phpMyAdmin ships (williamdes/mariadb-mysql-kbs, composer dependency of
// the reference checkout) into src/data. Usage: node scripts/vendor.mjs [path-to-phpmyadmin]
import { copyFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pma = process.argv[2] ?? process.env.BMA_PMA_SRC ?? '../phpmyadmin'
const src = join(pma, 'vendor/williamdes/mariadb-mysql-kbs')
const out = join(dirname(fileURLToPath(import.meta.url)), '../src/data')
copyFileSync(join(src, 'dist/merged-ultraslim.json'), join(out, 'merged-ultraslim.json'))
copyFileSync(join(src, 'LICENSE'), join(out, 'LICENSE'))
const { version } = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
console.log(`vendored mariadb-mysql-kbs ${version}`)
