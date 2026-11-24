// Generic paid E2E for any FMF MPP Worker. Run from a worker dir (needs mppx + viem).
// usage: node e2e.mjs BASE tests.json [filter]     tests.json: [{name, path, method?, body?, expect?: 200|402}]
// Testnet: funds a fresh wallet from the Moderato faucet. Live: refuses (no self-payments on live).
import fs from 'fs'
import { Mppx, tempo } from 'mppx/client'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
const [BASE, TESTS, FILTER = ''] = process.argv.slice(2)
if (!/testnet/.test(BASE)) { console.error('refusing: paid E2E only against a testnet Worker (no self-payments on live)'); process.exit(2) }
const tests = JSON.parse(fs.readFileSync(TESTS, 'utf8')), OUT = process.env.E2E_OUT || './raw/e2e-testnet/'; fs.mkdirSync(OUT, { recursive: true })
const prices = Object.fromEntries(Object.entries((await (await fetch(BASE + '/openapi.json')).json()).paths).map(([p, v]) => [p, Number(v.post['x-payment-info'].price.amount)]))
const account = privateKeyToAccount(generatePrivateKey())
const f = await fetch('https://rpc.moderato.tempo.xyz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tempo_fundAddress', params: [account.address] }) })
console.log('buyer', account.address, 'faucet', (await f.text()).slice(0, 90)); await new Promise((r) => setTimeout(r, 6000))
const mppx = Mppx.create({ methods: [tempo({ account })], polyfill: false })
const TOK = '0x20c0000000000000000000006a37DA5C996874BE'
const bal = async () => { try { const r = await fetch('https://rpc.moderato.tempo.xyz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: TOK, data: '0x70a08231' + account.address.slice(2).toLowerCase().padStart(64, '0') }, 'latest'] }) }); return Number(BigInt((await r.json()).result)) / 1e6 } catch { return null } }
let pass = 0, fail = 0
for (const t of tests) {
  if (FILTER && !t.name.includes(FILTER)) continue
  const expect = t.expect || 200, path = t.path.split('?')[0], b0 = await bal(), t0 = Date.now()
  const init = t.method === 'GET' ? { method: 'GET' } : t.file ? { method: 'POST', headers: { 'content-type': t.type || 'application/octet-stream' }, body: fs.readFileSync(t.file) } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(t.body || {}) }
  let r; try { r = await mppx.fetch(BASE + t.path, init) } catch (e) { console.log(`FAIL ${t.name} CLIENT_ERROR ${String(e).slice(0, 200)}`); fail++; continue }
  const ct = r.headers.get('content-type') || '', buf = Buffer.from(await r.arrayBuffer()), ms = Date.now() - t0, rec = r.headers.get('payment-receipt')
  fs.writeFileSync(OUT + t.name + (/json/.test(ct) ? '.json' : /svg/.test(ct) ? '.svg' : /png/.test(ct) ? '.png' : '.bin'), buf)
  let receipt = null; try { receipt = rec ? JSON.parse(Buffer.from(rec, 'base64url').toString()) : null } catch {}
  await new Promise((s) => setTimeout(s, 400)); const b1 = await bal(), paid = b0 != null && b1 != null ? Math.round((b0 - b1) * 1e6) / 1e6 : null
  const okPay = expect === 200 ? receipt?.status === 'success' && (paid == null || (paid - prices[path] > -1e-6 && paid - prices[path] < 1e-4)) : !receipt && (paid == null || paid === 0)
  const ok = r.status === expect && okPay; ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${t.name} ${path} HTTP ${r.status} ${ms}ms price=${prices[path]} paid=${paid} receipt=${receipt ? receipt.status + ' ' + (receipt.reference || '').slice(0, 20) : 'none'}`)
  console.log('     ' + (/json|text|svg/.test(ct) ? buf.toString('utf8', 0, 300) : `<${ct} ${buf.length} bytes>`).replace(/\n/g, ' '))
}
console.log(`SUMMARY pass=${pass} fail=${fail}`)
