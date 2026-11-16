import { defineNitroConfig } from 'nitropack/config'
import { createRequire } from 'node:module'

export default defineNitroConfig({
  preset: 'node-server',
  srcDir: '.',
  compatibilityDate: '2026-09-24',
  externals: { traceInclude: [createRequire(import.meta.url).resolve('word-extractor')] },
  alias: { '@zingara/artwork': '../../packages/artwork/src/index.ts', '@zingara/automations': '../../packages/automations/src/index.ts', '@zingara/contracts': '../../packages/contracts/src/index.ts', '@zingara/core/campaigns': '../../packages/core/src/campaigns.ts', '@zingara/core': '../../packages/core/src/index.ts', '@zingara/database': '../../packages/database/src/index.ts', '@zingara/integrations': '../../packages/integrations/src/index.ts' },
})
