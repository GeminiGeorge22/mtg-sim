// Shared discovery surfaces for FMF MPP Workers: rich llms.txt, /docs, OpenAPI
// enrichment, MCP (Streamable HTTP), cross-links, robots/sitemap, ref counters.
// Safe to add: does not change paid route behaviour or OpenAPI path/examples.
export const FLEET = [
  { id: 'docs', origin: 'https://mpp-docs.fmf-x402.workers.dev', title: 'Doc Tools', blurb: 'PDF, Office, audio, OCR and text tools' },
  { id: 'agent-data', origin: 'https://mpp-agent-data.fmf-x402.workers.dev', title: 'Web & Data', blurb: 'Scrape, extract, SEC filings, weather, FX' },
  { id: 'tools', origin: 'https://mpp-tools.fmf-x402.workers.dev', title: 'Utility Tools', blurb: 'Tempo chain, attestation, QR, DNS, email, IP, geo, math' },
  { id: 'ai', origin: 'https://mpp-ai.fmf-x402.workers.dev', title: 'AI Tools', blurb: 'Chat, translation, embeddings, rerank' },
  { id: 'research', origin: 'https://mpp-research.fmf-x402.workers.dev', title: 'Research', blurb: 'Papers, FDA drugs, recalls, clinical trials, LEI' },
  { id: 'chain', origin: 'https://mpp-chain.fmf-x402.workers.dev', title: 'EVM Decoder', blurb: 'Decode calldata and event logs, selector lookup, verified ABIs (any EVM chain)' },
  { id: 'controlplane', origin: 'https://controlplane-x402.fmf-x402.workers.dev', title: 'Control-plane', blurb: 'Contract control-plane snapshots and Tempo token data (MPP + x402)' },
]
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID, X-FMF-Ref',
  'access-control-allow-methods': 'GET, POST, OPTIONS, HEAD',
  'access-control-expose-headers': 'WWW-Authenticate, Payment-Receipt, Content-Disposition, MCP-Protocol-Version, Mcp-Session-Id',
}
const J = (code, obj, h = {}) => new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json', ...CORS, ...h } })
const TEXT = (body, type = 'text/plain; charset=utf-8', h = {}) => new Response(body, { headers: { 'content-type': type, ...CORS, ...h } })
const HTML = (body) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...CORS } })
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const REF_RE = /^[a-zA-Z0-9._-]{1,40}$/
const USDCE = '0x20C000000000000000000000b9537d11c60E8b50'

export function toolName(path) {
  return String(path).replace(/^\/mpp\//, '').replace(/^\/v1\//, 'v1_').replace(/^\//, '').replace(/\W+/g, '_') || 'tool'
}
export function toolMethod(t) { return (t.method || 'POST').toUpperCase() }
export function toolsFromOpenapi(TOOLS, doc) {
  const paths = (doc && doc.paths) || {}
  return Object.fromEntries(Object.entries(TOOLS || {}).map(([p, t]) => {
    const ops = paths[p] || {}
    const op = ops.post || ops.get || {}
    const content = ((op.requestBody || {}).content || {})['application/json'] || {}
    const schema = content.schema || {}
    const method = t.method || (ops.get && !ops.post ? 'GET' : 'POST')
    let example = t.example
    if (example == null) example = content.example
    if (example == null && Array.isArray(op.parameters)) {
      example = {}
      for (const prm of op.parameters) {
        if (prm.example != null) example[prm.name] = prm.example
        else if (prm.schema && prm.schema.example != null) example[prm.name] = prm.schema.example
        else if (prm.schema && prm.schema.enum) example[prm.name] = prm.schema.enum[0]
        else if (prm.name === 'address') example[prm.name] = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb'
        else if (prm.name === 'chain') example[prm.name] = 'base'
      }
    }
    return [p, { ...t, method, example: example ?? t.example ?? {}, params: t.params || schema.properties, required: t.required || schema.required }]
  }))
}
function exampleOf(t) { return t.example != null ? t.example : {} }
function exampleJson(t) { try { return JSON.stringify(exampleOf(t)) } catch { return '{}' } }
function pickDemo(TOOLS) {
  const entries = Object.entries(TOOLS || {})
  if (!entries.length) return null
  const score = ([, t]) => {
    const s = exampleJson(t)
    if (s.length > 400) return 1e9
    if (s === '{}') return 500
    return s.length
  }
  return entries.slice().sort((a, b) => score(a) - score(b))[0]
}
function sisters(id, origin) {
  return FLEET.filter((s) => s.id !== id).map((s) => `- [${s.title}](${s.origin}/docs?ref=cross-${id}): ${s.blurb}`).join('\n')
}
function sisterHtml(id) {
  return FLEET.filter((s) => s.id !== id).map((s) => `<li><a href="${esc(s.origin)}/docs?ref=cross-${esc(id)}">${esc(s.title)}</a> — ${esc(s.blurb)} · <a href="${esc(s.origin)}/llms.txt">llms.txt</a> · <a href="${esc(s.origin)}/openapi.json">OpenAPI</a></li>`).join('')
}
function guidance(GUIDE) {
  return GUIDE || 'POST JSON (or GET with query params) to any paid route and pay the MPP 402 challenge on Tempo (USDC.e or pathUSD). Bad input or an upstream failure returns 402 with an error and you are not charged. Optional ?ref=channel or header X-FMF-Ref attributes the call for our coverage map (ignored by the tool).'
}

async function storeGet(env) {
  if (env?.BUDGET) {
    try {
      const id = env.BUDGET.idFromName('global')
      const r = await env.BUDGET.get(id).fetch('https://b/kvget?k=refs')
      const j = await r.json()
      return JSON.parse(j.v || '{}')
    } catch { return {} }
  }
  if (env?.WATCHES) {
    try { return JSON.parse((await env.WATCHES.get('refs')) || '{}') } catch { return {} }
  }
  return {}
}
async function storePut(env, data) {
  const body = JSON.stringify(data)
  if (env?.BUDGET) {
    try {
      const id = env.BUDGET.idFromName('global')
      await env.BUDGET.get(id).fetch('https://b/kvput?k=refs', { method: 'POST', body })
    } catch {}
    return
  }
  if (env?.WATCHES) { try { await env.WATCHES.put('refs', body) } catch {} }
}
export function readRef(request, extra) {
  const u = new URL(request.url)
  const raw = extra || u.searchParams.get('ref') || u.searchParams.get('utm_source') || request.headers.get('x-fmf-ref') || ''
  const r = String(raw).trim()
  return REF_RE.test(r) ? r : ''
}
export async function noteRef(request, env, { paid = false, extra } = {}) {
  const ref = readRef(request, extra)
  if (!ref) return ''
  try {
    const data = await storeGet(env)
    data[ref] = data[ref] || { hits: 0, paid: 0 }
    data[ref].hits++
    if (paid) data[ref].paid++
    await storePut(env, data)
    console.log('fmf_ref', ref, paid ? 'paid' : 'hit', new URL(request.url).pathname)
  } catch (e) { console.log('fmf_ref_err', String(e?.message || e).slice(0, 80)) }
  return ref
}

export function enhanceOpenapi(doc, origin, { TITLE, DESC, SOURCES, ID, GUIDE } = {}) {
  const o = origin.replace(/\/$/, '')
  const d = doc || {}
  d.openapi = d.openapi || '3.1.0'
  d.info = d.info || {}
  d.info.title = d.info.title || TITLE
  d.info.version = d.info.version || '1.0.0'
  const appendix = `\n\nDocs: ${o}/docs — copy-paste examples for the mppx CLI, curl, the TypeScript SDK (mppx) and the Python SDK (pympp), plus an MCP config. Machine-readable: ${o}/llms.txt and ${o}/openapi.json. MCP (Streamable HTTP): ${o}/mcp. Fleet of sister services: ${FLEET.map((s) => s.origin).join(', ')}. ${SOURCES || ''}`.trim()
  const desc = d.info.description || DESC || ''
  if (!desc.includes('/docs')) d.info.description = (desc + ' ' + appendix).trim()
  d.info['x-guidance'] = d.info['x-guidance'] || guidance(GUIDE)
  d.info.contact = { name: 'FMF Tools', ...(d.info.contact || {}), url: o + '/docs' }
  d.info['x-docs'] = o + '/docs'
  d.info['x-mcp'] = o + '/mcp'
  d.info['x-llms'] = o + '/llms.txt'
  if (ID) d.info['x-fmf-id'] = ID
  d.externalDocs = { description: 'Copy-paste examples (CLI, curl, TypeScript, Python, MCP)', url: o + '/docs' }
  d.servers = d.servers?.length ? d.servers : [{ url: o }]
  d.components = d.components || {}
  d.components.securitySchemes = {
    ...(d.components.securitySchemes || {}),
    Payment: { type: 'http', scheme: 'Payment', description: 'MPP Payment credential on Tempo (USDC.e or pathUSD). Clients such as mppx handle the 402 challenge automatically. See https://mpp.dev/sdk' },
  }
  if (!d.tags?.length) {
    d.tags = [{ name: 'paid', description: 'Pay-per-call MPP routes. Unpaid requests receive 402. Invalid input is not charged.' }, { name: 'discovery', description: 'Free discovery surfaces: /docs, /llms.txt, /openapi.json, /mcp, /health.' }]
  }
  return d
}

function mppxCmd(origin, path, t) {
  const method = toolMethod(t)
  const url = origin + path
  if (method === 'GET') {
    const q = new URLSearchParams()
    const ex = exampleOf(t)
    if (ex && typeof ex === 'object' && !Array.isArray(ex)) for (const [k, v] of Object.entries(ex)) if (v != null && v !== '') q.set(k, String(v))
    const qs = q.toString()
    return `npx mppx '${url}${qs ? '?' + qs : ''}'`
  }
  return `npx mppx ${url} -X POST -H 'content-type: application/json' -d '${exampleJson(t)}'`
}
function curlUnpaid(origin, path, t) {
  const method = toolMethod(t)
  const url = origin + path
  if (method === 'GET') {
    const q = new URLSearchParams()
    const ex = exampleOf(t)
    if (ex && typeof ex === 'object' && !Array.isArray(ex)) for (const [k, v] of Object.entries(ex)) if (v != null && v !== '') q.set(k, String(v))
    const qs = q.toString()
    return `curl -i '${url}${qs ? '?' + qs : ''}'`
  }
  return `curl -i -X POST ${url} -H 'content-type: application/json' -d '${exampleJson(t)}'`
}
function tsSnippet(origin, path, t) {
  const method = toolMethod(t)
  const body = method === 'GET' ? '' : `\n  body: JSON.stringify(${exampleJson(t)}),`
  const headers = method === 'GET' ? '' : `\n    'content-type': 'application/json',`
  return `import { Mppx, tempo } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'

Mppx.create({
  methods: [tempo({ account: privateKeyToAccount(process.env.TEMPO_PRIVATE_KEY) })],
})

// Global fetch now pays the 402 automatically.
const res = await fetch('${origin}${path}', {
  method: '${method}',${headers ? '  headers: {' + headers + '\n  },' : ''}${body}
})
console.log(await res.json())`
}
function pySnippet(origin, path, t) {
  const method = toolMethod(t)
  const extra = method === 'GET' ? '' : `, method="POST", json=${exampleJson(t)}`
  return `# pip install pympp
# Docs: https://mpp.dev/sdk/python
import asyncio
from mpp.client import Mpp
from mpp.methods.tempo import TempoAccount
from mpp.methods.tempo import client as tempo

account = TempoAccount.from_key("0x...")

async def main():
    async with Mpp(methods=[tempo.charge(account=account)]) as mpp:
        response = await mpp.fetch("${origin}${path}"${extra})
        print(await response.json())

asyncio.run(main())`
}
function mcpConfig(origin, title, id) {
  const name = 'fmf-mpp-' + (id || 'tools')
  return `{
  "mcpServers": {
    "${name}": {
      "url": "${origin}/mcp"
    }
  }
}`
}

export function renderLlms({ origin, TOOLS, TITLE, DESC, SOURCES, ID, GUIDE }) {
  const o = origin.replace(/\/$/, '')
  const demo = pickDemo(TOOLS)
  const [dp, dt] = demo || [Object.keys(TOOLS || {})[0], Object.values(TOOLS || {})[0] || { amount: '0', title: '', summary: '', example: {} }]
  const routes = Object.entries(TOOLS || {}).map(([p, t]) => {
    return `- ${toolMethod(t)} ${o}${p} ($${t.amount}) ${t.title}: ${t.summary}\n  Example: \`${mppxCmd(o, p, t)}\``
  }).join('\n')
  return `# ${TITLE}

> ${DESC}

## Docs (free)
- Human docs with copy-paste examples: ${o}/docs
- OpenAPI 3.1: ${o}/openapi.json
- This file: ${o}/llms.txt
- MCP server (Streamable HTTP): ${o}/mcp
- Health: ${o}/health
- Attribution counters (no PII): ${o}/stats/refs

## How to pay
No account and no API key. Unpaid calls receive HTTP 402 with an MPP challenge on Tempo (USDC.e or pathUSD). Official clients pay the challenge and retry automatically.

${guidance(GUIDE)}

## Quick start

mppx CLI (creates/uses a Tempo account in your keychain):

\`\`\`bash
${demo ? mppxCmd(o, dp, dt) : 'npx mppx ' + o}
\`\`\`

TypeScript (mppx). After Mppx.create(), global fetch handles 402:

\`\`\`ts
${demo ? tsSnippet(o, dp, dt) : ''}
\`\`\`

Python (pympp):

\`\`\`python
${demo ? pySnippet(o, dp, dt) : ''}
\`\`\`

An unpaid curl shows the 402 (you are not charged):

\`\`\`bash
${demo ? curlUnpaid(o, dp, dt) : ''}
\`\`\`

## MCP

Add this to Cursor / Claude Desktop / VS Code MCP settings (Streamable HTTP):

\`\`\`json
${mcpConfig(o, TITLE, ID)}
\`\`\`

\`tools/list\` is free. \`tools/call\` requires an MPP Payment credential in the Authorization header (or just call the HTTP route with mppx). The wrapper does not settle payment on its own and stores nothing.

## Routes
${routes}

${SOURCES ? '## Sources and licences\n' + SOURCES + '\n' : ''}
## Sister services
${sisters(ID, o)}

## Attribution
Append \`?ref=your-channel\` or send header \`X-FMF-Ref: your-channel\` on any request (including unpaid 402s and /docs). We count hits and paid successes per channel so we can see what actually drives calls. The parameter is ignored by the tool.
`
}

const CSS = `*{box-sizing:border-box}body{font:16px/1.55 system-ui,sans-serif;max-width:920px;margin:32px auto;padding:0 18px 64px;color:#1a1a1a;background:#fff}h1{font-size:1.7rem;margin:0 0 .4em}h2{margin-top:1.8em;border-top:1px solid #ececec;padding-top:.9em}h3{margin:1.2em 0 .4em}p,li{color:#222}a{color:#0b57d0}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em}code{background:#f3f3f5;padding:1px 5px;border-radius:4px}pre{background:#0f1419;color:#f4f4f5;padding:14px 16px;border-radius:8px;overflow:auto}pre code{background:none;color:inherit;padding:0}table{border-collapse:collapse;width:100%;font-size:.95em}td,th{padding:7px 10px;border-bottom:1px solid #eee;vertical-align:top;text-align:left}nav{display:flex;flex-wrap:wrap;gap:.6rem 1rem;margin:1em 0 1.4em;font-size:.95em}.muted{color:#555;font-size:.95em}.price{white-space:nowrap;font-variant-numeric:tabular-nums}footer{margin-top:3em;color:#555;font-size:.9em}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}p,li{color:#ddd}a{color:#8ab4f8}code{background:#222;color:#eee}pre{background:#0a0a0a}td,th{border-bottom-color:#2a2a2a}h2{border-top-color:#2a2a2a}.muted,footer{color:#aaa}}`

export function renderPage({ origin, TOOLS, TITLE, DESC, SOURCES, ID, full }) {
  const o = origin.replace(/\/$/, '')
  const demo = pickDemo(TOOLS)
  const [dp, dt] = demo || []
  const rows = Object.entries(TOOLS || {}).map(([p, t]) => `<tr><td><code>${esc(toolMethod(t))} ${esc(p)}</code></td><td class=price>$${esc(t.amount)}</td><td><b>${esc(t.title)}</b><br>${esc(t.summary)}</td></tr>`).join('')
  const snippets = demo ? `
<h2>Copy-paste examples</h2>
<p class="muted">These call <code>${esc(toolMethod(dt))} ${esc(dp)}</code> (\$${esc(dt.amount)}) — ${esc(dt.title)}. Swap the path for any other route in the table.</p>
<h3>mppx CLI</h3>
<pre><code>${esc(mppxCmd(o, dp, dt))}</code></pre>
<p class="muted">The CLI creates or reuses a Tempo account in your keychain and pays the 402 automatically. See <a href="https://mpp.dev/sdk">mpp.dev/sdk</a>.</p>
<h3>curl (unpaid — shows the 402, not charged)</h3>
<pre><code>${esc(curlUnpaid(o, dp, dt))}</code></pre>
<h3>TypeScript SDK (mppx)</h3>
<pre><code>${esc(tsSnippet(o, dp, dt))}</code></pre>
<h3>Python SDK (pympp)</h3>
<pre><code>${esc(pySnippet(o, dp, dt))}</code></pre>
<h3>MCP config (Cursor, Claude Desktop, VS Code)</h3>
<pre><code>${esc(mcpConfig(o, TITLE, ID))}</code></pre>
<p class="muted">Transport is Streamable HTTP at <code>${esc(o)}/mcp</code>. <code>tools/list</code> is free. Paid <code>tools/call</code> needs an MPP Payment header, or just use mppx against the HTTP route.</p>` : ''
  const lead = full
    ? `<p>${esc(DESC)}</p><p>No account and no API key. Pay per successful call with <a href="https://mpp.dev">MPP</a> on Tempo (USDC.e or pathUSD). Invalid input or an upstream failure returns 402 and is <b>not charged</b>.</p>`
    : `<p>${esc(DESC)}</p><p><a href="/docs">Full docs with copy-paste examples</a> (mppx CLI, curl, TypeScript, Python, MCP).</p>`
  return `<!doctype html><html lang="en"><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(TITLE)}</title><style>${CSS}</style>
<body>
<h1>${esc(TITLE)}</h1>
${lead}
<nav>
  <a href="${esc(o)}/docs">Docs</a>
  <a href="${esc(o)}/llms.txt">llms.txt</a>
  <a href="${esc(o)}/openapi.json">OpenAPI</a>
  <a href="${esc(o)}/mcp">MCP</a>
  <a href="${esc(o)}/health">Health</a>
  <a href="https://mpp.dev">MPP</a>
</nav>
<h2>Routes</h2>
<table><thead><tr><th>Route</th><th>Price</th><th>What you get</th></tr></thead><tbody>${rows}</tbody></table>
${full ? snippets : ''}
${SOURCES ? `<h2>Sources and licences</h2><p>${esc(SOURCES)}</p>` : ''}
<h2>Sister services</h2>
<ul>${sisterHtml(ID)}</ul>
<footer>Operated by FMF Tools. Pay-per-call APIs for agents. Optional <code>?ref=</code> or <code>X-FMF-Ref</code> attributes traffic; see <a href="/stats/refs">/stats/refs</a>. Nothing is stored from your session payloads.</footer>
</body></html>`
}

function mcpTools(TOOLS, origin) {
  return Object.entries(TOOLS || {}).map(([p, t]) => ({
    name: toolName(p),
    description: `${t.title} ($${t.amount} per call, paid via MPP on Tempo). ${t.summary} HTTP ${toolMethod(t)} ${origin}${p}. This MCP wrapper does not settle payment by itself; call with an MPP Payment Authorization header, or use mppx against the HTTP route.`,
    inputSchema: {
      type: 'object',
      properties: t.params || (t.example && typeof t.example === 'object' && !Array.isArray(t.example)
        ? Object.fromEntries(Object.entries(t.example).map(([k, v]) => [k, { type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string', description: k }]))
        : {}),
      ...(t.required?.length ? { required: t.required } : {}),
    },
  }))
}

async function handleMcp(request, env, ctx, opts) {
  const { TOOLS, TITLE, ID, origin, callTool } = opts
  const o = origin.replace(/\/$/, '')
  if (request.method === 'GET' || request.method === 'HEAD') {
    return J(200, { transport: 'streamable-http', url: o + '/mcp', name: TITLE, protocol: '2025-03-26', docs: o + '/docs' })
  }
  if (request.method !== 'POST') return J(405, { error: 'POST JSON-RPC to /mcp (Streamable HTTP)' })
  let body
  try { body = await request.json() } catch { return J(400, { error: 'body is not valid JSON-RPC' }) }
  const msgs = Array.isArray(body) ? body : [body]
  const reply = async (msg) => {
    if (!msg || typeof msg !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
    const { id, method, params } = msg
    if (typeof method === 'string' && method.startsWith('notifications/')) return null
    const ok = (result) => ({ jsonrpc: '2.0', id, result })
    const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
    if (method === 'initialize') {
      return ok({
        protocolVersion: (params && params.protocolVersion) || '2025-03-26',
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: 'fmf-mpp-' + (ID || 'service'), title: TITLE, version: '1.0.0' },
        instructions: `Paid MPP tools on Tempo. List tools for free. To call a tool, send an MPP Payment credential in Authorization, or use the mppx CLI against ${o}. Docs: ${o}/docs`,
      })
    }
    if (method === 'ping') return ok({})
    if (method === 'tools/list') return ok({ tools: mcpTools(TOOLS, o) })
    if (method === 'tools/call') {
      const name = params?.name
      const entry = Object.entries(TOOLS || {}).find(([p]) => toolName(p) === name)
      if (!entry) return err(-32602, 'unknown tool: ' + name)
      const [path, t] = entry
      const auth = request.headers.get('authorization') || ''
      if (/^payment\s/i.test(auth) && typeof callTool === 'function') {
        try {
          const toolReq = new Request(o + path + (readRef(request) ? '?ref=' + encodeURIComponent(readRef(request)) : ''), {
            method: toolMethod(t),
            headers: { 'content-type': 'application/json', authorization: auth, 'x-fmf-ref': readRef(request) || 'mcp' },
            body: toolMethod(t) === 'GET' ? undefined : JSON.stringify(params?.arguments || {}),
          })
          const res = await callTool(toolReq, path)
          const text = await res.text()
          const paid = res.status === 200
          if (paid) await noteRef(toolReq, env, { paid: true, extra: 'mcp' })
          return ok({ content: [{ type: 'text', text: `HTTP ${res.status}\n${text}` }], isError: !paid })
        } catch (e) {
          return ok({ content: [{ type: 'text', text: 'tool failed: ' + String(e?.message || e).slice(0, 200) }], isError: true })
        }
      }
      return ok({
        content: [{ type: 'text', text: `${t.title} costs $${t.amount} per call (MPP on Tempo). This MCP wrapper does not settle payment itself.\n\nPay and call with:\n${mppxCmd(o, path, t)}\n\nOr POST JSON to ${o}${path} with an official MPP client (mppx / pympp). Docs: ${o}/docs\nUnpaid probe (not charged):\n${curlUnpaid(o, path, t)}` }],
        isError: true,
      })
    }
    if (method === 'resources/list') {
      return ok({ resources: [
        { uri: o + '/llms.txt', name: 'llms.txt', mimeType: 'text/plain', description: 'Machine-readable service description' },
        { uri: o + '/openapi.json', name: 'openapi.json', mimeType: 'application/json', description: 'OpenAPI 3.1' },
        { uri: o + '/docs', name: 'docs', mimeType: 'text/html', description: 'Copy-paste examples' },
      ] })
    }
    if (method === 'resources/read') {
      const uri = params?.uri || ''
      if (uri.endsWith('/llms.txt')) return ok({ contents: [{ uri, mimeType: 'text/plain', text: renderLlms(opts) }] })
      if (uri.endsWith('/openapi.json') && opts.openapi) return ok({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(opts.openapi(o), null, 2) }] })
      if (uri.endsWith('/docs')) return ok({ contents: [{ uri, mimeType: 'text/html', text: renderPage({ ...opts, origin: o, full: true }) }] })
      return err(-32602, 'unknown resource')
    }
    if (method === 'prompts/list') return ok({ prompts: [] })
    return err(-32601, 'Method not found: ' + method)
  }
  const out = []
  for (const m of msgs) {
    const r = await reply(m)
    if (r) out.push(r)
  }
  if (Array.isArray(body)) return J(200, out, { 'mcp-protocol-version': '2025-03-26' })
  if (!out.length) return new Response(null, { status: 202, headers: { ...CORS, 'mcp-protocol-version': '2025-03-26' } })
  return J(200, out[0], { 'mcp-protocol-version': '2025-03-26' })
}

export async function serveDiscovery(request, env, ctx, opts) {
  const u = new URL(request.url)
  const origin = (opts.origin || u.origin).replace(/\/$/, '')
  const path = u.pathname.replace(/\/$/, '') || '/'
  const meta = { ...opts, origin }
  const skip = new Set(opts.skip || [])
  if (skip.has(path) || skip.has(u.pathname)) return null
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  ctx?.waitUntil?.(noteRef(request, env))
  if (!ctx?.waitUntil) await noteRef(request, env)

  if (path === '/go' || path.startsWith('/go/')) {
    const ch = path.split('/')[2] || u.searchParams.get('ref') || 'link'
    const ref = REF_RE.test(ch) ? ch : 'link'
    await noteRef(request, env, { extra: ref })
    return new Response(null, { status: 302, headers: { location: origin + '/docs?ref=' + encodeURIComponent(ref), ...CORS } })
  }
  if (path === '/stats/refs') {
    const data = await storeGet(env)
    return J(200, { service: opts.ID, refs: data, note: 'hits include unpaid 402s and doc views; paid is a successful settled call that carried a ref' })
  }
  if (path === '/robots.txt') return TEXT(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`)
  if (path === '/sitemap.xml') {
    const urls = ['/', '/docs', '/llms.txt', '/openapi.json', '/mcp', '/health']
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${origin}${p === '/' ? '/' : p}</loc></url>`).join('\n')}\n</urlset>\n`
    return TEXT(body, 'application/xml; charset=utf-8')
  }
  if (path === '/.well-known/mcp.json' || path === '/.well-known/mcp') {
    return J(200, { name: 'fmf-mpp-' + (opts.ID || 'service'), title: opts.TITLE, description: opts.DESC, transport: 'streamable-http', url: origin + '/mcp', documentation: origin + '/docs', protocolVersion: '2025-03-26' })
  }
  if (path === '/llms.txt' || path === '/llms-full.txt') return TEXT(renderLlms(meta))
  if (path === '/openapi.json') {
    const doc = typeof opts.openapi === 'function' ? opts.openapi(origin) : opts.openapi
    return J(200, enhanceOpenapi(doc, origin, opts))
  }
  if (path === '/mcp') return handleMcp(request, env, ctx, meta)
  if (path === '/health') return J(200, { ok: true, routes: Object.keys(opts.TOOLS || {}).length, docs: origin + '/docs', mcp: origin + '/mcp' })
  if (path === '/docs') return HTML(renderPage({ ...meta, full: true }))
  if (path === '/') {
    const mode = opts.root || 'html'
    const accept = request.headers.get('accept') || ''
    if (mode === 'json') return null
    if (mode === 'auto' && !accept.includes('text/html')) return null
    return HTML(renderPage({ ...meta, full: false }))
  }
  return null
}
