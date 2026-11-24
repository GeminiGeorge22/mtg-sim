// Pure TCG math: decklist parsing, exact (multivariate) hypergeometric odds, land/colour-source counts, seeded Monte Carlo goldfish.
// No card data and no I/O here: everything works on what the caller supplies. Deterministic for a given seed.
export class InputError extends Error {}
const bad = (m) => { throw new InputError(m) }

// ---- game presets (public rules facts) ----
export const GAMES = {
  mtg:       { label: 'Magic: The Gathering (60-card constructed)', deck: 60, hand: 7, firstDraws: false },
  commander: { label: 'MTG Commander (99-card library + commander)', deck: 99, hand: 7, firstDraws: true, note: 'multiplayer Commander: the first player draws on turn 1 (rule 103.8c)' },
  limited:   { label: 'MTG Limited (40-card draft/sealed)', deck: 40, hand: 7, firstDraws: false },
  pokemon:   { label: 'Pokémon TCG', deck: 60, hand: 7, firstDraws: true, prizes: 6 },
  yugioh:    { label: 'Yu-Gi-Oh! TCG', deck: 40, hand: 5, firstDraws: false },
  lorcana:   { label: 'Disney Lorcana', deck: 60, hand: 7, firstDraws: false },
  onepiece:  { label: 'One Piece Card Game', deck: 50, hand: 5, firstDraws: false },
}
export function preset(game) {
  const g = String(game || 'mtg').toLowerCase().replace(/[^a-z]/g, '')
  const alias = { magic: 'mtg', mtga: 'mtg', arena: 'mtg', edh: 'commander', draft: 'limited', sealed: 'limited', ptcg: 'pokemon', ptcgl: 'pokemon', ygo: 'yugioh', masterduel: 'yugioh', op: 'onepiece', optcg: 'onepiece' }
  const k = GAMES[g] ? g : alias[g]; if (!k) bad('game must be one of: ' + Object.keys(GAMES).join(', ')); return { id: k, ...GAMES[k] }
}

// ---- integers / numbers ----
export function int(x, name, lo, hi, dflt) {
  if (x === undefined || x === null || x === '') { if (dflt === undefined) bad(name + ' is required'); return dflt }
  const n = Number(x); if (!Number.isInteger(n) || n < lo || n > hi) bad(`${name} must be an integer from ${lo} to ${hi}`); return n
}
export function prob(x, name, dflt) { if (x === undefined || x === null || x === '') return dflt; let n = Number(x); if (n > 1 && n <= 100) n /= 100; if (!(n > 0 && n < 1)) bad(name + ' must be a probability between 0 and 1 (or a percent)'); return n }
export const r4 = (x) => Math.round(x * 1e4) / 1e4
export const pct = (x) => (Math.round(x * 1000) / 10).toFixed(1) + '%'

// ---- exact combinatorics (log factorials up to 1000) ----
const LF = [0]; for (let i = 1; i <= 1000; i++) LF[i] = LF[i - 1] + Math.log(i)
const lC = (n, k) => (k < 0 || k > n ? -Infinity : LF[n] - LF[k] - LF[n - k])
export const hyperPmf = (N, K, n, k) => Math.exp(lC(K, k) + lC(N - K, n - k) - lC(N, n))
export function hyperAtLeast(N, K, n, k) { let s = 0; for (let i = Math.max(k, 0); i <= Math.min(K, n); i++) s += hyperPmf(N, K, n, i); return Math.min(1, Math.max(0, s)) }
// P(for every group g: drawn_g >= min_g (and <= max_g if set)) when drawing n from N, groups disjoint. Exact enumeration.
export function multiAtLeast(N, groups, n) {
  const rest = N - groups.reduce((a, g) => a + g.copies, 0); if (rest < 0) bad('group copies add up to more than the deck size')
  const lTot = lC(N, n); let total = 0
  const rec = (i, left, lw) => {
    if (i === groups.length) { if (left <= rest) total += Math.exp(lw + lC(rest, left) - lTot); return }
    const g = groups[i], hi = Math.min(g.copies, left, g.max ?? Infinity)
    for (let k = g.min; k <= hi; k++) rec(i + 1, left - k, lw + lC(g.copies, k))
  }
  rec(0, n, 0); return Math.min(1, Math.max(0, total))
}
export const seenBy = (p, turn, onPlay) => p.hand + Math.max(0, turn - 1) + ((onPlay && !p.firstDraws) ? 0 : 1) * (turn >= 1 ? 1 : 0)

// ---- decklist parsing (Arena / MTGO / Moxfield / PTCGL / plain "4 Card Name") ----
const SECTION = /^(deck|main ?deck|main|maindeck|sideboard|side ?board|side|commander|commanders|companion|maybeboard|considering|tokens?|extra|extra deck|about|name .*|pok[eé]mon(:.*)?|trainers?(:.*)?|energy(:.*)?|attractions?|stickers?)\s*:?\s*\d*$/i
export function cleanName(s) {
  return String(s).replace(/\s+#.*$/, '').replace(/\s*\*[A-Z]+\*\s*/g, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s+\([A-Za-z0-9]{2,6}\)\s*[A-Za-z0-9★-]*\s*$/, '').replace(/\s+[A-Z]{2,4}\d?\s+\d{1,4}[a-z]?$/, (m) => m) // PTCGL set+num kept for pokemon parse
    .replace(/\s+/g, ' ').trim()
}
export function parseDeck(text, { maxLines = 400 } = {}) {
  if (Array.isArray(text)) text = text.map((x) => typeof x === 'string' ? x : `${x.count ?? x.qty ?? 1} ${x.name}`).join('\n')
  text = String(text ?? ''); if (!text.trim()) bad('decklist is required (one card per line, e.g. "4 Lightning Bolt")'); if (text.length > 60000) bad('decklist too long')
  const lines = text.replace(/\r/g, '').split('\n'); if (lines.length > maxLines) bad(`decklist has more than ${maxLines} lines`)
  const out = { main: [], side: [], commander: [], companion: [], unparsed: [] }
  let sec = 'main', sawMain = false
  for (let raw of lines) {
    let line = raw.trim()
    if (!line) { if (sawMain && sec === 'main' && out.main.length) sec = 'side_pending'; continue }
    if (/^\/\/|^#/.test(line)) continue
    let tag = null; const tm = line.match(/\s#(\w[\w-]*)\s*$/); if (tm) tag = tm[1].toLowerCase()
    if (SECTION.test(line) && !/^\d/.test(line)) {
      const s = line.toLowerCase()
      sec = /side/.test(s) ? 'side' : /commander/.test(s) ? 'commander' : /companion/.test(s) ? 'companion' : /maybe|consider|token|about|^name|attraction|sticker/.test(s) ? 'skip' : 'main'
      if (sec === 'main') sawMain = true; continue
    }
    let target = sec === 'side_pending' ? 'side' : sec
    if (/^SB:\s*/i.test(line)) { target = 'side'; line = line.replace(/^SB:\s*/i, '') }
    const m = line.match(/^(\d{1,3})\s*x?\s+(.+)$/i)
    let count, name
    if (m) { count = Number(m[1]); name = m[2] } else { const m2 = line.match(/^(.+?)\s+x(\d{1,3})$/i); if (m2) { count = Number(m2[2]); name = m2[1] } else { count = 1; name = line } }
    name = cleanName(name)
    if (!name || count < 1) { out.unparsed.push(raw); continue }
    if (target === 'skip') continue
    if (!sawMain) sawMain = true
    const list = out[target] || out.main
    const ex = list.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (ex) { ex.count += count; if (tag) ex.tag = tag } else list.push({ name, count, ...(tag ? { tag } : {}) })
  }
  const total = (l) => l.reduce((a, c) => a + c.count, 0)
  out.counts = { main: total(out.main), side: total(out.side), commander: total(out.commander) }
  if (!out.counts.main && !out.counts.commander) bad('no cards found in decklist (expected lines like "4 Lightning Bolt")')
  return out
}

export const BASICS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes', 'snow-covered plains', 'snow-covered island', 'snow-covered swamp', 'snow-covered mountain', 'snow-covered forest', 'snow-covered wastes'])

// ---- seeded RNG ----
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
export const ci95 = (p, n) => { const h = 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-12) / n); return [r4(Math.max(0, p - h)), r4(Math.min(1, p + h))] }
