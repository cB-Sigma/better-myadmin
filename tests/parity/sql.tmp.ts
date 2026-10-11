import mysql from 'mysql2/promise'
const c = await mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: 'root',
  multipleStatements: true,
})
const [r] = await c.query(process.argv[2] ?? 'SELECT 1')
console.log(JSON.stringify(r, null, 1).slice(0, 5000))
await c.end()
