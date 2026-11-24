import { makeWorker, Budget, MppxStore, J, CORS } from './core.mjs'
import { TOOLS } from './tools.mjs'
import { InputError } from './tcg.mjs'
import { drawOdds } from './compute.mjs'
import { deckCheck, FORMATS } from './mtg.mjs'
import * as P from './pages.mjs'
export { Budget, MppxStore }
const DESC = 'MTG Sim: a Magic: The Gathering simulator inside your AI (MCP server + pay-per-call API). Goldfish simulator and London mulligan sim for a pasted decklist (seeded Monte Carlo), draw odds and opening-hand odds (exact hypergeometric, joint odds for several cards, on the play or draw), land count and colored-source calculator, plus a FREE deck legality check (Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Commander/EDH color identity and ban list) with mana curve. Works in Claude, ChatGPT, Cursor and VS Code. Paid tools from $0.001 via MPP on Tempo, no account; invalid input is never charged.'
const base = makeWorker({ TOOLS, ID: 'tcg', TITLE: P.SERVER.title, DESC, SOURCES: P.FCP })
export const FREE = {
  '/free/mtg/deck-check': { name: 'mtg_deck_check', title: 'FREE MTG deck check: legality + mana curve (Commander/EDH, Standard, Modern, Pioneer, Pauper...)',
    summary: 'Paste a decklist (Arena, MTGO, Moxfield or plain text). Checks deck size, copy limits, banned/restricted/not-legal cards, Commander singleton and color identity, and returns mana curve, average mana value, card types, color pips, land color sources and goldfish_tags ready for mtg_goldfish. Card data from Scryfall; always free.',
    params: { decklist: { type: 'string', description: 'Pasted decklist; put the commander under a "Commander" line' }, format: { type: 'string', description: FORMATS.slice(0, 9).join(' | ') + ' | ... (default standard)' } }, required: ['decklist'],
    example: { format: 'commander', decklist: "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n96 Forest" }, run: (j, env) => deckCheck(j, env) },
  '/free/mtg/opening-hand': { name: 'mtg_opening_hand_odds', title: 'FREE MTG opening hand sim: odds for one card',
    summary: 'Chance that a card you run N copies of is in your opening hand (60-card, Commander 99, Limited 40). For several cards at once and turn-by-turn odds use mtg_draw_odds ($0.001).',
    params: { cards: { type: 'array', description: '[{"name":"Sol Ring","copies":1}]' }, format: { type: 'string', description: 'mtg | commander | limited' } }, required: ['cards'],
    example: { format: 'mtg', cards: [{ name: 'Lightning Bolt', copies: 4, min: 1 }] }, run: async (j) => drawOdds(j, { free: true }) },
}
const RL = new Map() // per-isolate soft rate limit for the free Scryfall-backed route
const limited = (ip) => { const now = Date.now(), w = (RL.get(ip) || []).filter((t) => now - t < 60000); w.push(now); RL.set(ip, w); if (RL.size > 5000) RL.clear(); return w.length > 30 }
async function runFree(path, args, ip, env) {
  const t = FREE[path]; if (path === '/free/mtg/deck-check' && limited(ip || 'x')) return { status: 429, body: { error: 'free deck check limited to 30 per minute per client; try again shortly' } }
  try { const out = await Promise.race([t.run(args || {}, env), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 20 s')), 20000))]); return { status: 200, body: { ...out, price: 'free' } } }
  catch (e) { return e instanceof InputError ? { status: 400, body: { error: e.message } } : { status: 502, body: { error: String(e?.message || e).slice(0, 200) } } }
}
const H = (s) => new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=600', ...CORS } })
const T = (s, ct = 'text/plain; charset=utf-8') => new Response(s, { headers: { 'content-type': ct, 'cache-control': 'public, max-age=600', ...CORS } })
function mcpList(o) {
  const f = Object.entries(FREE).map(([p, t]) => ({ name: t.name, title: t.title, description: `${t.title}. ${t.summary} (free, no payment)`, inputSchema: { type: 'object', properties: t.params, required: t.required }, annotations: { readOnlyHint: true, openWorldHint: path(p) } }))
  const pd = Object.entries(TOOLS).map(([p, t]) => ({ name: t.name, title: t.title, description: `${t.title}. ${t.summary} Costs $${t.amount} per call, paid with MPP on Tempo (send an MPP Payment credential in the Authorization header of the MCP request, or call POST ${o}${p} with mppx). Without payment the tool returns the price and how to pay; invalid input is never charged.`, inputSchema: { type: 'object', properties: t.params, ...(t.required.length ? { required: t.required } : {}) }, annotations: { readOnlyHint: true, openWorldHint: false } }))
  return [...f, ...pd]
}
const path = (p) => p.includes('deck-check')
async function mcp(request, env, ctx, o) {
  if (request.method === 'GET' || request.method === 'HEAD') return J(200, { transport: 'streamable-http', url: o + '/mcp', name: P.SERVER.name, title: P.SERVER.title, docs: o + '/install' })
  if (request.method !== 'POST') return J(405, { error: 'POST JSON-RPC to /mcp' })
  let body; try { body = await request.json() } catch { return J(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) }
  const ip = request.headers.get('cf-connecting-ip'), auth = request.headers.get('authorization') || ''
  const one = async (m) => {
    if (!m || typeof m !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
    const { id, method, params } = m; if (typeof method === 'string' && method.startsWith('notifications/')) return null
    const ok = (result) => ({ jsonrpc: '2.0', id, result }), err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
    if (method === 'initialize') return ok({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false }, resources: { listChanged: false } }, serverInfo: { name: P.SERVER.name, title: P.SERVER.title, version: '1.0.0', websiteUrl: o + '/' },
      instructions: 'MTG Sim, a Magic: The Gathering simulator. Use mtg_deck_check (free) first on any pasted decklist: legality for the format, Commander color identity, mana curve, and goldfish_tags. Use mtg_opening_hand_odds (free) for one card in the opening hand. For goldfish/mulligan simulation, several cards, turn-by-turn draw odds or land counts use the paid tools (MPP on Tempo, $0.001-$0.003). Quote the numbers from the tool, not estimates.' })
    if (method === 'ping') return ok({})
    if (method === 'tools/list') return ok({ tools: mcpList(o) })
    if (method === 'resources/list') return ok({ resources: [{ uri: o + '/llms.txt', name: 'llms.txt', mimeType: 'text/plain' }, { uri: o + '/install', name: 'install', mimeType: 'text/html' }] })
    if (method === 'resources/read') { const u = params?.uri || ''; if (u.endsWith('/llms.txt')) return ok({ contents: [{ uri: u, mimeType: 'text/plain', text: P.llms(o, FREE, TOOLS) }] }); return err(-32602, 'unknown resource') }
    if (method === 'prompts/list') return ok({ prompts: [] })
    if (method === 'tools/call') {
      const name = params?.name, args = params?.arguments || {}
      const fe = Object.entries(FREE).find(([, t]) => t.name === name)
      if (fe) { const r = await runFree(fe[0], args, ip, env); return ok({ content: [{ type: 'text', text: JSON.stringify(r.body, null, 1) }], structuredContent: r.body, isError: r.status !== 200 }) }
      const pe = Object.entries(TOOLS).find(([, t]) => t.name === name); if (!pe) return err(-32602, 'unknown tool: ' + name)
      const [p, t] = pe
      if (/^payment\s/i.test(auth)) {
        const res = await base.fetch(new Request(o + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth, 'x-fmf-ref': 'mcp' }, body: JSON.stringify(args) }), env, ctx)
        const txt = await res.text(); let sc; try { sc = JSON.parse(txt) } catch {}
        return ok({ content: [{ type: 'text', text: res.status === 200 ? txt : `HTTP ${res.status}: ${txt}` }], ...(res.status === 200 && sc ? { structuredContent: sc } : {}), isError: res.status !== 200, _meta: { 'payment-receipt': res.headers.get('payment-receipt') || undefined } })
      }
      return ok({ content: [{ type: 'text', text: `${t.title} costs $${t.amount} per call (MPP on Tempo, USDC; no account). This client sent no payment, so nothing ran and nothing was charged.\n\nPay and run it with mppx:\nnpx mppx ${o}${p} -X POST -H 'content-type: application/json' -d '${JSON.stringify(args && Object.keys(args).length ? args : t.example)}'\n\nFree alternatives here: mtg_deck_check (legality + curve), mtg_opening_hand_odds (one card, opening hand).` }], isError: true })
    }
    return err(-32601, 'Method not found: ' + method)
  }
  const msgs = Array.isArray(body) ? body : [body], out = []; for (const m of msgs) { const r = await one(m); if (r) out.push(r) }
  const h = { 'mcp-protocol-version': '2025-06-18' }
  if (Array.isArray(body)) return J(200, out, h); if (!out.length) return new Response(null, { status: 202, headers: { ...CORS, ...h } }); return J(200, out[0], h)
}
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url), o = u.origin, p = u.pathname.replace(/\/$/, '') || '/'
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id' } })
    if (p === '/') return (request.headers.get('accept') || '').includes('application/json') ? J(200, { name: P.SERVER.name, mcp: o + '/mcp', docs: o + '/docs' }) : H(P.home(o, FREE, TOOLS))
    if (p === '/install') return H(P.install(o))
    if (p === '/docs') return H(P.docs(o, FREE, TOOLS))
    if (p === '/mtg') return H(P.mtgLanding(o))
    if (p.startsWith('/mtg/')) { const h = P.faqPage(o, p.slice(5)); if (h) return H(h) }
    if (p === '/llms.txt' || p === '/llms-full.txt') return T(P.llms(o, FREE, TOOLS))
    if (p === '/sitemap.xml') return T(P.sitemap(o), 'application/xml; charset=utf-8')
    if (p === '/robots.txt') return T(P.robots(o))
    if (p === '/mcp') return mcp(request, env, ctx, o)
    if (p === '/.well-known/mcp.json' || p === '/.well-known/mcp' || p === '/.well-known/mcp/server.json') return J(200, { name: P.SERVER.name, title: P.SERVER.title, description: DESC, transport: 'streamable-http', url: o + '/mcp', documentation: o + '/install', tools: mcpList(o).map((t) => ({ name: t.name, description: t.description })), pricing: 'tools/list, mtg_deck_check, mtg_opening_hand_odds free; others $0.001-$0.003 per call via MPP', publisher: 'FMF Tools' })
    if (p === '/health') return J(200, { ok: true, free: Object.keys(FREE).length, paid: Object.keys(TOOLS).length, mcp: o + '/mcp' })
    if (FREE[p]) {
      if (request.method !== 'POST' && request.method !== 'GET') return J(405, { error: 'POST JSON' })
      let args = Object.fromEntries(u.searchParams)
      if (request.method === 'POST') { const txt = await request.text(); if (txt.length > 100000) return J(413, { error: 'body too large' }); if (txt.trim()) { try { args = { ...args, ...JSON.parse(txt) } } catch { if ((request.headers.get('content-type') || '').startsWith('text/')) args.decklist = txt; else return J(400, { error: 'body is not valid JSON' }) } } }
      if (typeof args.cards === 'string') { try { args.cards = JSON.parse(args.cards) } catch {} }
      const r = await runFree(p, args, request.headers.get('cf-connecting-ip'), env); return J(r.status, r.body)
    }
    return base.fetch(request, env, ctx)
  },
}
