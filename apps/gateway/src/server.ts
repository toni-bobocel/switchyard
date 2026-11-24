import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { Ledger } from './finops/ledger.js'

const config = loadConfig(process.env.SWITCHYARD_CONFIG ?? 'switchyard.json')
const ledger = new Ledger(process.env.LEDGER_PATH ?? 'switchyard.db')
const port = Number(process.env.PORT ?? 8080)

const server = serve({ fetch: createApp({ config, ledger }).fetch, port }, () =>
  process.stdout.write(`switchyard listening on :${port}\n`),
)

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () =>
    server.close(() => {
      ledger.close()
      process.exit(0)
    }),
  )
}
