// FMF MPP route core (shared template). One import gives a Worker: payment flow, openapi.json, llms.txt, landing page,
// /health, Budget DO (daily Workers-AI neuron cap + tiny KV), MPPX store DO.
// Payment rule: unpaid -> 402 challenge; paid -> HMAC-verify credential (cheap) -> load+validate input -> run ->
// settle on success. If work is still running SETTLE_MS after arrival, settle then (Tempo tx validity is 25 s from signing).
// BadInput / upstream failure before settlement -> 402 "<msg>; not charged" + fresh challenge.
import { Mppx, tempo, Store, Expires } from 'mppx/server'
import { Credential, Challenge } from 'mppx'
import { DurableObject } from 'cloudflare:workers'
import { serveDiscovery, noteRef } from './discover.mjs'
export class BadInput extends Error {}
export class Up extends Error {}
export const PAY_TO = '0xB2070a4A874E7141E551890a3642bF7B24a1a148'
export const USDCE = '0x20C000000000000000000000b9537d11c60E8b50', PATHUSD = '0x20c0000000000000000000000000000000000000'
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-expose-headers': 'WWW-Authenticate, Payment-Receipt, Content-Disposition' }
export const J = (code, obj, h = {}) => new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json', ...CORS, ...h } })
export const clamp = (x, a, b, d) => { x = Number(x); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : d }
export const bool = (x) => x === true || x === 'true' || x === '1'
let CAPV = 4000
export class MppxStore extends Store.DurableObjectStore {}
export class Budget extends DurableObject {
  async fetch(req) { const u = new URL(req.url); const n = Number(u.searchParams.get('n') || 0); const day = new Date().toISOString().slice(0, 10)
    if (u.pathname === '/kvget') return Response.json((await this.ctx.storage.get('kv:' + u.searchParams.get('k'))) || {})
    if (u.pathname === '/kvput') { await this.ctx.storage.put('kv:' + u.searchParams.get('k'), { v: await req.text(), at: Date.now() }); return Response.json({ ok: true }) }
    let s = (await this.ctx.storage.get('s')) || { day, used: 0 }; if (s.day !== day) s = { day, used: 0 }
    if (u.pathname === '/reserve') { const cap = Number(u.searchParams.get('cap') || CAPV); if (s.used + n > cap) return Response.json({ ok: false, used: s.used }); s.used += n }
    else if (u.pathname === '/add') s.used = Math.max(0, s.used + n)
    await this.ctx.storage.put('s', s); return Response.json({ ok: true, used: s.used, day }) }
}
const bud = (env) => env.BUDGET.get(env.BUDGET.idFromName('global'))
export async function reserve(env, n, cap) { const r = await (await bud(env).fetch(`https://b/reserve?n=${n}&cap=${cap || CAPV}`)).json(); if (!r.ok) throw new Up('daily free AI budget reached; try after 00:00 UTC'); return n }
export const addUsage = (env, n) => bud(env).fetch(`https://b/add?n=${n}`)
export const kvGet = async (env, k) => (await bud(env).fetch(`https://b/kvget?k=${encodeURIComponent(k)}`)).json()
export const kvPut = (env, k, v) => bud(env).fetch(`https://b/kvput?k=${encodeURIComponent(k)}`, { method: 'POST', body: v })
// cached upstream GET via Cache API
export async function up(url, { ttl = 300, headers = {}, type = 'json', what = 'upstream', ua, method = 'GET', body } = {}) {
  const key = method === 'GET' ? new Request(url) : null; let r = key ? await caches.default.match(key) : null
  if (!r) {
    try { r = await fetch(url, { method, body, headers: { 'user-agent': ua || 'fmf-mpp/1.0', ...headers }, signal: AbortSignal.timeout(20000) }) } catch { throw new Up(`${what} unreachable`) }
    if (r.status === 404) throw new BadInput(`${what}: not found`)
    if (!r.ok) throw new Up(`${what} HTTP ${r.status}`)
    const b = await r.arrayBuffer(); r = new Response(b, { headers: { 'content-type': r.headers.get('content-type') || '', 'cache-control': `public, max-age=${ttl}` } })
    if (key && ttl > 0) try { await caches.default.put(key, r.clone()) } catch {}
  }
  return type === 'json' ? r.json() : type === 'bytes' ? new Uint8Array(await r.arrayBuffer()) : r.text()
}
async function params(request, u) {
  const q = Object.fromEntries(u.searchParams); if (request.method !== 'POST') return { json: q, q, files: [] }
  const ct = (request.headers.get('content-type') || '').toLowerCase(); let j = {}
  if (ct.includes('application/json')) { const t = await request.text(); if (t.length > 2e6) throw new BadInput('body too large'); if (t.trim()) { try { j = JSON.parse(t) } catch { throw new BadInput('body is not valid JSON') } } if (typeof j !== 'object' || !j || Array.isArray(j)) throw new BadInput('JSON body must be an object') }
  else if (ct.includes('form')) { const fd = await request.formData(); for (const [k, v] of fd.entries()) if (typeof v === 'string') j[k] = v }
  else if (ct.startsWith('text/')) j.text = await request.text()
  return { json: { ...q, ...j }, q, files: [] }
}
const M = new Map()
function mppx(env, realm) {
  if (M.has(realm)) return M.get(realm)
  const m = Mppx.create({ methods: [tempo.charge({ recipient: PAY_TO, currencies: env.MPP_TESTNET ? undefined : [USDCE, PATHUSD], testnet: !!env.MPP_TESTNET, store: Store.durableObject(env.MPPX_STORE) })], secretKey: env.MPP_SECRET_KEY, realm })
  M.set(realm, m); return m
}
const bare = (r) => { const h = new Headers(r.headers); h.delete('content-length'); h.delete('content-type'); return new Request(r.url, { method: 'GET', headers: h }) }
const chargeFn = (env, u, t, r) => mppx(env, u.host).charge({ amount: t.amount, description: t.title, expires: Expires.minutes(t.expiresMin || 15) })(bare(r))
async function refuse(env, u, t, request, msg) { const h = new Headers(request.headers); h.delete('authorization'); const c = await chargeFn(env, u, t, new Request(request.url, { method: 'GET', headers: h })); return J(402, { error: msg + '; not charged', type: 'https://paymentauth.org/problems/payment-required' }, Object.fromEntries(new Headers(c.challenge.headers))) }
const SETTLE_MS = 11000
async function handle(request, env, ctx, u, t, loader) {
  if (!/^payment\s/i.test(request.headers.get('authorization') || '')) { const r = await chargeFn(env, u, t, request); return r.status === 402 ? r.challenge : J(500, { error: 'unexpected' }) }
  let ok = false; try { ok = Challenge.verify(Credential.fromRequest(request).challenge, { secretKey: env.MPP_SECRET_KEY }) } catch {}
  if (!ok) { const r = await chargeFn(env, u, t, request); return r.status === 402 ? r.challenge : J(400, { error: 'bad credential' }) }
  const t0 = Date.now(); let settled = null, inp
  const fail = (e) => { if (!(e instanceof BadInput)) console.log('error', u.pathname, e?.stack || e); return refuse(env, u, t, request, e instanceof BadInput ? e.message : 'failed: ' + String(e?.message || e).slice(0, 160)) }
  try { inp = await (t.loader || loader || params)(request, u, t) } catch (e) { return fail(e) }
  const work = Promise.resolve().then(() => t.run(inp, env, ctx)).then((v) => ({ v }), (e) => ({ e }))
  let r = await Promise.race([work, new Promise((ok) => setTimeout(() => ok(null), Math.max(0, SETTLE_MS - (Date.now() - t0))))])
  if (!r) { settled = await chargeFn(env, u, t, request); if (settled.status === 402) return settled.challenge; r = await work }
  if (r.e) { if (!settled) return fail(r.e); console.log('error AFTER settle', u.pathname, r.e?.stack || r.e); return settled.withReceipt(J(502, { error: 'processing failed after payment settled: ' + String(r.e?.message || r.e).slice(0, 160), charged: true })) }
  const out = r.v, res = settled || await chargeFn(env, u, t, request)
  if (res.status === 402) return res.challenge
  if (out.json !== undefined) return res.withReceipt(J(200, out.json))
  return res.withReceipt(new Response(out.body, { status: 200, headers: { 'content-type': out.type, ...CORS, ...(out.headers || {}) } }))
}
// t: { amount, title, summary, params: {name: {type, description, ...}}, required: [...], example: {...}, respType?, run(inp, env, ctx) }
export function makeWorker({ TOOLS, TITLE, DESC, GUIDE, SOURCES = '', CAP = 4000, loader, scheduled, EXTRA = {}, ID }) {
  CAPV = CAP
  const reqBody = (t) => t.reqBody || { required: true, content: { 'application/json': { schema: { type: 'object', properties: t.params || {}, ...(t.required?.length ? { required: t.required } : {}) }, example: t.example || {} } } }
  const openapi = (o) => ({ openapi: '3.1.0', info: { title: TITLE, version: '1.0.0', description: DESC, 'x-guidance': GUIDE || 'POST JSON (or GET with query params) to any /mpp/* route and pay the MPP 402 challenge on Tempo (USDC.e or pathUSD). Bad input or an upstream failure returns 402 with an error and you are not charged.', contact: { name: 'FMF Tools', url: o + '/' } },
    servers: [{ url: o }],
    paths: Object.fromEntries(Object.entries(TOOLS).map(([p, t]) => [p, { post: { operationId: p.replace(/^\/mpp\//, '').replace(/\W+/g, '_'), summary: t.title, description: t.summary + ` Price $${t.amount} per call.`, requestBody: reqBody(t),
      'x-payment-info': { protocols: [{ mpp: { method: 'tempo', intent: 'charge', currency: USDCE } }], price: { mode: 'fixed', currency: 'USD', amount: t.amount } },
      responses: { '200': { description: 'Result', content: t.respContent || { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, '402': { description: 'Payment required (MPP, Tempo USDC.e or pathUSD); also returned with an error message, not charged, for invalid input' } } } }])) })
  const llms = (o) => `# ${TITLE}\n\n> ${DESC}\n\n## Routes\n${Object.entries(TOOLS).map(([p, t]) => `- POST ${o}${p} ($${t.amount}) ${t.title}: ${t.summary}`).join('\n')}\n\n${SOURCES}\n\nOpenAPI: ${o}/openapi.json\nPay with any MPP client, e.g. npx mppx ${o}${Object.keys(TOOLS)[0]} -X POST -H 'content-type: application/json' -d '${JSON.stringify(Object.values(TOOLS)[0].example || {})}'\n`
  const page = () => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${TITLE}</title><style>body{font:15px/1.5 system-ui;max-width:900px;margin:40px auto;padding:0 16px;color:#222}code{background:#f3f3f5;padding:1px 4px;border-radius:4px}td{padding:4px 10px;border-bottom:1px solid #eee;vertical-align:top}</style><h1>${TITLE}</h1><p>${DESC.replace(/&/g, '&amp;')}</p><table>${Object.entries(TOOLS).map(([p, t]) => `<tr><td><code>POST ${p}</code></td><td>$${t.amount}</td><td><b>${t.title}</b><br>${t.summary}</td></tr>`).join('')}</table><p>${SOURCES}</p><p><a href="/openapi.json">openapi.json</a> · <a href="/llms.txt">llms.txt</a></p>`
  return {
    ...(scheduled ? { scheduled } : {}),
    async fetch(request, env, ctx) {
      const u = new URL(request.url)
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
      const disc = await serveDiscovery(request, env, ctx, {
        TOOLS, TITLE, DESC, GUIDE, SOURCES, ID,
        openapi: (o) => openapi(o),
        callTool: async (req, path) => {
          const tool = TOOLS[path]; if (!tool) return J(404, { error: 'not found' })
          return handle(req, env, ctx, new URL(req.url), tool, loader)
        },
      })
      if (disc) return disc
      if (EXTRA[u.pathname]) { try { return await EXTRA[u.pathname](request, env, ctx) } catch (e) { return J(503, { error: String(e?.message || e).slice(0, 160) }) } }
      const t = TOOLS[u.pathname]; if (t) { try { const res = await handle(request, env, ctx, u, t, loader); if (res.status === 200) ctx.waitUntil?.(noteRef(request, env, { paid: true })); return res } catch (e) { console.log('fatal', e?.stack || e); return J(500, { error: 'internal error; not charged' }) } }
      return J(404, { error: 'not found', see: u.origin + '/docs' })
    },
  }
}
