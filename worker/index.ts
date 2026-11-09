/**
 * The game's only server code.
 *
 * Everything else is static files, served from dist/ before this Worker runs:
 * `run_worker_first` in wrangler.jsonc sends it /api/* only, and the one route
 * there is the analytics endpoint (endpoint.ts).
 *
 * This module exports the handler and nothing else: Cloudflare treats every
 * export of the entry module as an entrypoint.
 */

import { EVENT_PATH, handleEvent, type Context, type Env } from './endpoint'

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === EVENT_PATH) return handleEvent(request, url, env, ctx)
    return env.ASSETS.fetch(request)
  },
}
