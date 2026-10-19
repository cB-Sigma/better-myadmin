// Generates src/routeTree.gen.ts from src/routes (the TanStack Router codegen the Vite plugin runs
// at dev/build). The file is gitignored, so typecheck and the tests need it generated first; this
// runs the same generator with the plugin's options (vite.config.ts) so local and CI agree.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generator, getConfig } from '@tanstack/router-generator'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = getConfig({ target: 'react', autoCodeSplitting: true }, root)
await generator(config, root)
