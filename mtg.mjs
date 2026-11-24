// FREE MTG deck check using Scryfall card data. Scryfall data must never be paywalled (Scryfall API terms + WotC Fan Content Policy),
// so this route is free and is never behind MPP. Looks cards up with /cards/collection (75 per request), caches per isolate.
import { parseDeck, InputError, r4 } from './tcg.mjs'
const CACHE = new Map()
const bad = (m) => { throw new InputError(m) }
export const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'historic', 'timeless', 'explorer', 'alchemy', 'brawl', 'standardbrawl', 'oathbreaker', 'penny', 'premodern', 'oldschool', 'predh', 'paupercommander', 'duel', 'gladiator', 'future']
const SINGLETON = new Set(['commander', 'brawl', 'standardbrawl', 'oathbreaker', 'predh', 'paupercommander', 'duel', 'gladiator'])
const SIZE = { commander: [100, 100], duel: [100, 100], predh: [100, 100], paupercommander: [100, 100], brawl: [100, 100], standardbrawl: [60, 60], oathbreaker: [60, 60], gladiator: [100, 100] }
const FMT = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'historic', 'timeless', 'explorer', 'alchemy', 'brawl', 'standardbrawl', 'oathbreaker', 'penny', 'premodern', 'oldschool', 'predh', 'paupercommander', 'duel', 'gladiator', 'future']
const ST = { l: 'legal', b: 'banned', r: 'restricted', n: 'not_legal' }
const crcT = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c } return t })()
const crc32 = (s) => { const b = new TextEncoder().encode(s); let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const SH = new Map()
async function shardOf(env, i) {
  if (SH.has(i)) return SH.get(i)
  const r = await env.ASSETS.fetch(new Request('https://assets.local/data/mtg/' + i + '.json')); if (!r.ok) throw new Error('card data shard ' + i + ' missing')
  const d = await r.json(); SH.set(i, d); return d
}
const norm = (n) => n.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()
async function lookup(names, env) {
  for (const n of names) { const k = norm(n); if (CACHE.has(k)) continue
    const d = await shardOf(env, crc32(k) % 64); const x = d[k]
    CACHE.set(k, x ? { name: x.n, mv: x.m, type: x.t, ci: [...x.c], cost: x.k, produced: [...x.p], legal: Object.fromEntries(FMT.map((f, i) => [f, ST[x.g[i]]])), limit: x.x === 'any' ? Infinity : x.x ?? null, cmd: !!x.cmd, partner: !!x.pt } : null) }
  return (n) => CACHE.get(norm(n)) ?? null
}
const maxCopies = (c) => c.limit
export async function deckCheck(j, env) {
  const format = String(j.format || 'standard').toLowerCase().replace(/[^a-z]/g, ''); if (!FORMATS.includes(format)) bad('format must be one of: ' + FORMATS.join(', '))
  const d = parseDeck(j.decklist ?? j.deck)
  const all = [...d.main, ...d.side, ...d.commander, ...d.companion]; if (all.length > 250) bad('too many distinct cards (max 250)')
  const get = await lookup(all.map((c) => c.name), env)
  const problems = [], warnings = [], notFound = all.filter((c) => !get(c.name)).map((c) => c.name)
  if (notFound.length) problems.push(`unknown card names (check spelling): ${notFound.slice(0, 15).join(', ')}`)
  const single = SINGLETON.has(format)
  const deckCount = d.counts.main + d.counts.commander
  const [lo, hi] = SIZE[format] || [60, Infinity]
  if (deckCount < lo || deckCount > hi) problems.push(`deck has ${deckCount} cards (main ${d.counts.main}${d.counts.commander ? ` + ${d.counts.commander} commander` : ''}); ${format} needs ${lo === hi ? 'exactly ' + lo : 'at least ' + lo}`)
  if (!single && d.counts.side > 15) problems.push(`sideboard has ${d.counts.side} cards; max 15`)
  const byName = new Map(); for (const c of [...d.main, ...(single ? [] : d.side), ...d.commander]) { const k = (get(c.name)?.name || c.name).toLowerCase(); byName.set(k, (byName.get(k) || 0) + c.count) }
  for (const [k, n] of byName) { const c = get(k); if (!c) continue; const lim = maxCopies(c) ?? (single ? 1 : 4); const st = c.legal[format]
    const eff = st === 'restricted' ? 1 : lim
    if (n > eff) problems.push(`${c.name}: ${n} copies (max ${eff}${st === 'restricted' ? ', restricted' : single ? ', singleton' : ''})`) }
  for (const c of all) { const x = get(c.name); if (!x) continue; const st = x.legal[format]; if (st === 'banned') problems.push(`${x.name} is banned in ${format}`); else if (st === 'not_legal') problems.push(`${x.name} is not legal in ${format}`) }
  let identity = null
  if (single && format !== 'oathbreaker') {
    if (!d.commander.length) warnings.push('no "Commander" section found: put your commander under a line that says Commander')
    else { identity = [...new Set(d.commander.flatMap((c) => get(c.name)?.ci || []))].sort()
      for (const c of d.commander) { const x = get(c.name); if (x && !(/Legendary.*Creature/.test(x.type) || x.cmd)) problems.push(`${x.name} can't be your commander (not a legendary creature)`) }
      const off = d.main.map((c) => get(c.name)).filter((x) => x && x.ci.some((ch) => !identity.includes(ch))); for (const x of off.slice(0, 20)) problems.push(`${x.name} is outside the commander's color identity (${identity.join('') || 'colorless'})`) }
  }
  const main = d.main.map((c) => ({ ...c, x: get(c.name) })).filter((c) => c.x)
  const isLand = (x) => /\bLand\b/.test(x.type.split(' // ')[0])
  const lands = main.filter((c) => isLand(c.x)), spells = main.filter((c) => !isLand(c.x))
  const curve = {}; for (const c of spells) { const k = Math.min(7, Math.round(c.x.mv)); curve[k === 7 ? '7+' : k] = (curve[k === 7 ? '7+' : k] || 0) + c.count }
  const pips = {}; for (const c of spells) for (const m of (c.x.cost.match(/\{[WUBRG](\/[WUBRGP])?\}/g) || [])) for (const ch of m.replace(/[{}\/P]/g, '')) pips[ch] = (pips[ch] || 0) + c.count
  const sources = {}; for (const c of lands) for (const ch of c.x.produced) if ('WUBRGC'.includes(ch)) sources[ch] = (sources[ch] || 0) + c.count
  const types = {}; for (const c of main) { const t = (c.x.type.split(' — ')[0].split(' // ')[0].match(/Creature|Planeswalker|Instant|Sorcery|Artifact|Enchantment|Battle|Land/g) || ['Other']); const k = t.includes('Land') ? 'Land' : t.includes('Creature') ? 'Creature' : t[0]; types[k] = (types[k] || 0) + c.count }
  const spellCount = spells.reduce((a, c) => a + c.count, 0), avg = spellCount ? spells.reduce((a, c) => a + c.x.mv * c.count, 0) / spellCount : 0
  const landN = lands.reduce((a, c) => a + c.count, 0)
  return {
    format, legal: problems.length === 0, problems, warnings,
    counts: { main: d.counts.main, sideboard: d.counts.side, commander: d.counts.commander, lands: landN, nonland: spellCount }, color_identity: identity ?? undefined,
    mana_curve: curve, average_mana_value: r4(avg), types, color_pips: pips, land_color_sources: sources,
    goldfish_tags: { land: lands.map((c) => c.x.name.split(' // ')[0] === c.name ? c.x.name : c.name), creature: main.filter((c) => /Creature/.test(c.x.type)).map((c) => c.name), one_drop: spells.filter((c) => c.x.mv <= 1).map((c) => c.name), two_drop: spells.filter((c) => c.x.mv === 2).map((c) => c.name), interaction: spells.filter((c) => /Instant/.test(c.x.type)).map((c) => c.name) },
    next: 'Pass goldfish_tags to mtg_goldfish to simulate mulligans and land drops, or ask mtg_land_count whether ' + landN + ' lands is right for this curve.',
    unparsed_lines: d.unparsed.slice(0, 10),
    source: 'Card data from Scryfall (scryfall.com) bulk data, refreshed from the daily Oracle Cards file; this check is free and never paywalled. Unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
  }
}
