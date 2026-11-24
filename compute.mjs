// MTG-facing computations built on tcg.mjs. Pure functions (no I/O) so they run identically in the Worker and in CI.
import { preset, int, prob, r4, pct, hyperAtLeast, multiAtLeast, parseDeck, BASICS, rng, ci95, InputError } from './tcg.mjs'
const bad = (m) => { throw new InputError(m) }
const bool = (x, d) => x === undefined || x === null || x === '' ? d : (x === true || x === 'true' || x === '1' || x === 1)
const seen = (p, turn, onPlay) => p.hand + Math.max(0, turn - 1) + ((onPlay && !p.firstDraws) ? 0 : 1)

// ---------- draw odds ----------
export function drawOdds(j, { free = false } = {}) {
  const p = preset(j.format || j.game)
  const deck = int(j.deck_size, 'deck_size', 20, 250, p.deck)
  const onPlay = bool(j.on_play, true)
  let groups = j.cards ?? j.groups
  if (!groups) groups = [{ name: j.card || 'target card', copies: j.copies, min: j.min ?? 1 }]
  if (typeof groups === 'string') { try { groups = JSON.parse(groups) } catch { bad('cards must be a JSON array like [{"name":"Lightning Bolt","copies":4,"min":1}]') } }
  if (!Array.isArray(groups) || !groups.length) bad('cards must be a non-empty array')
  if (groups.length > (free ? 1 : 6)) bad(free ? 'the free preview takes one card; use the paid mtg_draw_odds for several cards at once' : 'at most 6 card groups')
  groups = groups.map((g, i) => ({ name: String(g.name || `group ${i + 1}`).slice(0, 80), copies: int(g.copies, `cards[${i}].copies`, 1, deck, undefined), min: int(g.min, `cards[${i}].min`, 0, 60, 1), max: g.max === undefined ? undefined : int(g.max, `cards[${i}].max`, 0, 60, undefined) }))
  if (groups.reduce((a, g) => a + g.copies, 0) > deck) bad('copies add up to more than deck_size')
  const hand = int(j.hand_size, 'hand_size', 1, 10, p.hand), pp = { ...p, hand }
  const maxTurn = free ? 1 : int(j.turn, 'turn', 1, 20, 4)
  const rows = []
  for (let t = 1; t <= Math.max(maxTurn, free ? 1 : 1); t++) {
    const n = Math.min(deck, seen(pp, t, onPlay))
    rows.push({ turn: t, cards_seen: n, each: groups.map((g) => ({ name: g.name, p_at_least: r4(hyperAtLeast(deck, g.copies, n, g.min)) })), all: groups.length > 1 ? r4(multiAtLeast(deck, groups, n)) : undefined })
  }
  const opening = { cards_seen: hand, each: groups.map((g) => ({ name: g.name, p_at_least: r4(hyperAtLeast(deck, g.copies, hand, g.min)) })), all: groups.length > 1 ? r4(multiAtLeast(deck, groups, hand)) : undefined }
  const last = rows[rows.length - 1]
  const out = {
    format: p.id, rules: p.label + (p.note ? ' — ' + p.note : ''), deck_size: deck, hand_size: hand, on_play: onPlay,
    draw_rule: (onPlay && !p.firstDraws) ? 'on the play: no draw on turn 1' : 'draws on turn 1',
    cards: groups, opening_hand: opening, by_turn: free ? undefined : rows,
    answer: `${groups.map((g) => `${g.min}+ of ${g.copies} ${g.name}`).join(' and ')}: ${pct(free ? (opening.all ?? opening.each[0].p_at_least) : (last.all ?? last.each[0].p_at_least))} ${free ? 'in the opening hand' : `by turn ${last.turn} (${last.cards_seen} cards seen, ${onPlay ? 'on the play' : 'on the draw'})`}.`,
    method: 'exact hypergeometric (multivariate for several groups); no simulation error',
  }
  if (p.prizes && !free) out.prizes = groups.map((g) => ({ name: g.name, p_all_prized: r4(hyperAtLeast(deck - hand, g.copies, p.prizes, g.copies)), p_at_least_one_prized: r4(hyperAtLeast(deck - hand, g.copies, p.prizes, 1)) }))
  if (free) out.upgrade = 'Paid mtg_draw_odds ($0.001): several cards at once (joint odds), turn-by-turn table to turn 20, on the play vs draw, Commander/Limited presets.'
  return out
}

// ---------- land count / colour sources ----------
export function landCount(j) {
  const p = preset(j.format || j.game)
  const deck = int(j.deck_size, 'deck_size', 20, 250, p.deck), onPlay = bool(j.on_play, true), target = prob(j.probability, 'probability', 0.9)
  const hand = p.hand, sb = (t) => Math.min(deck, seen(p, t, onPlay))
  const minFor = (need, t) => { for (let L = need; L <= deck; L++) if (hyperAtLeast(deck, L, sb(t), need) >= target) return L; return null }
  const drops = []; for (let t = 1; t <= int(j.max_turn, 'max_turn', 1, 10, 6); t++) drops.push({ turn: t, lands_needed_for_drop: minFor(t, t), cards_seen: sb(t) })
  const lands = j.lands === undefined ? null : int(j.lands, 'lands', 0, deck, undefined)
  const curve = j.curve_top ? int(j.curve_top, 'curve_top', 1, 10, undefined) : null
  let colors = j.colors ?? j.pips ?? []
  if (typeof colors === 'string') { try { colors = JSON.parse(colors) } catch { bad('colors must be a JSON array like [{"color":"R","pips":2,"turn":2}]') } }
  if (!Array.isArray(colors) || colors.length > 10) bad('colors must be an array of at most 10 entries')
  const src = colors.map((c, i) => { const pips = int(c.pips, `colors[${i}].pips`, 1, 5, 1), t = int(c.turn, `colors[${i}].turn`, 1, 10, pips); return { color: String(c.color || c.name || '?').slice(0, 20), pips, turn: t, sources_needed: minFor(pips, t), cards_seen: sb(t) } })
  const out = { format: p.id, deck_size: deck, on_play: onPlay, target_probability: target, land_drops: drops, color_sources: src.length ? src : undefined,
    method: 'smallest count with P(at least k hits among cards seen by turn T) >= target, exact hypergeometric; mulligans and card draw not counted (conservative)' }
  if (curve) out.recommended_lands = { curve_top: curve, lands: minFor(curve, curve), note: `hit your land drop for a ${curve}-drop on turn ${curve} with ${pct(target)} odds` }
  if (lands !== null) out.your_lands = { lands, drops: drops.map((d) => ({ turn: d.turn, p_hit: r4(hyperAtLeast(deck, lands, d.cards_seen, d.turn)) })), p_flood_6plus_by_t6: r4(hyperAtLeast(deck, lands, sb(6), Math.min(sb(6), 7))) }
  return out
}

// ---------- goldfish / mulligan Monte Carlo ----------
export function goldfish(j) {
  const p = preset(j.format || j.game)
  const d = parseDeck(j.decklist ?? j.deck)
  const cards = []; const idx = new Map()
  for (const c of d.main) { idx.set(c.name.toLowerCase(), cards.length); cards.push(c) }
  const N = d.counts.main; if (N < 20 || N > 250) bad(`main deck has ${N} cards; need 20 to 250 (put the commander under a "Commander" header)`)
  const iters = int(j.iterations, 'iterations', 100, 20000, 10000), seed = int(j.seed, 'seed', 0, 2 ** 31 - 1, 1), onPlay = bool(j.on_play, true)
  const turns = int(j.turns, 'turns', 1, 12, 6)
  let tags = j.tags ?? {}; if (typeof tags === 'string') { try { tags = JSON.parse(tags) } catch { bad('tags must be an object like {"land":["Mountain","Inspiring Vantage"]}') } }
  if (typeof tags !== 'object' || Array.isArray(tags)) bad('tags must be an object of group -> [card names]')
  const groupOf = new Map() // card index -> Set(groups)
  const addG = (i, g) => { if (!groupOf.has(i)) groupOf.set(i, new Set()); groupOf.get(i).add(g) }
  cards.forEach((c, i) => { if (BASICS.has(c.name.toLowerCase()) || c.tag === 'land') addG(i, 'land'); if (c.tag) addG(i, c.tag) })
  const unknown = []
  for (const [g, names] of Object.entries(tags)) { if (!Array.isArray(names)) bad(`tags.${g} must be an array of card names`); for (const nm of names) { const i = idx.get(String(nm).toLowerCase()); if (i === undefined) unknown.push(nm); else addG(i, g.toLowerCase()) } }
  const libCards = []; cards.forEach((c, i) => { for (let k = 0; k < c.count; k++) libCards.push(i) })
  const isLand = cards.map((_, i) => groupOf.get(i)?.has('land') || false)
  const landCountDeck = libCards.filter((i) => isLand[i]).length
  if (!landCountDeck && !j.no_lands) bad('no lands identified: basics are detected by name; tag the rest with tags.land (the free mtg_deck_check returns ready-made tags) or add "#land" after the card line')
  const keep = j.keep || {}; const kMin = int(keep.min_lands, 'keep.min_lands', 0, 7, 2), kMax = int(keep.max_lands, 'keep.max_lands', 0, 7, 5), maxMull = int(keep.max_mulligans, 'keep.max_mulligans', 0, 3, 2)
  let goals = j.goals ?? []; if (typeof goals === 'string') { try { goals = JSON.parse(goals) } catch { bad('goals must be a JSON array') } }
  if (!Array.isArray(goals) || goals.length > 10) bad('goals must be an array of at most 10')
  goals = goals.map((g, gi) => {
    const t = int(g.turn, `goals[${gi}].turn`, 1, turns, turns)
    const need = (g.need || []).map((n, ni) => { const min = int(n.min, `goals[${gi}].need[${ni}].min`, 1, 60, 1)
      if (n.card) { const i = idx.get(String(n.card).toLowerCase()); if (i === undefined) bad(`goals[${gi}]: card "${n.card}" is not in the main deck`); return { kind: 'card', i, min, label: `${min}+ ${cards[i].name}` } }
      if (n.group) { const gname = String(n.group).toLowerCase(); if (![...groupOf.values()].some((s) => s.has(gname))) bad(`goals[${gi}]: group "${n.group}" has no cards (define it in tags)`); return { kind: 'group', g: gname, min, label: `${min}+ ${gname}` } }
      bad(`goals[${gi}].need[${ni}] needs "card" or "group"`) })
    return { name: String(g.name || `goal ${gi + 1}`).slice(0, 80), turn: t, lands_in_play: g.lands_in_play === undefined ? null : int(g.lands_in_play, `goals[${gi}].lands_in_play`, 0, 12, 0), need, hits: 0 }
  })
  const R = rng(seed), L = libCards.length, deckArr = new Int32Array(L), drawn = new Int32Array(cards.length)
  const firstDraw = (onPlay && !p.firstDraws) ? 2 : 1
  const mullDist = [0, 0, 0, 0], dropHit = new Array(turns + 1).fill(0), landsSum = new Array(turns + 1).fill(0), screw = new Array(turns + 1).fill(0)
  const groupList = [...new Set([...groupOf.values()].flatMap((s) => [...s]))]
  for (let it = 0; it < iters; it++) {
    let mulls = 0, hand, bottom = 0, pos
    for (;;) {
      for (let i = 0; i < L; i++) deckArr[i] = libCards[i]
      const need = p.hand + turns + 1
      for (let i = 0; i < Math.min(need, L); i++) { const r = i + Math.floor(R() * (L - i)); const tmp = deckArr[i]; deckArr[i] = deckArr[r]; deckArr[r] = tmp }
      let lands = 0; for (let i = 0; i < p.hand; i++) if (isLand[deckArr[i]]) lands++
      const keepSize = p.hand - mulls
      if ((lands >= Math.min(kMin, keepSize) && lands <= kMax) || mulls >= maxMull) {
        // London mulligan: bottom `mulls` cards — excess lands first if land-heavy, else spells
        hand = Array.from(deckArr.subarray(0, p.hand)); bottom = mulls
        for (let b = 0; b < bottom; b++) { const landsNow = hand.filter((x) => isLand[x]).length; const wantLand = landsNow > Math.ceil(keepSize * 0.45); let k = hand.findIndex((x) => isLand[x] === wantLand); if (k < 0) k = hand.length - 1; hand.splice(k, 1) }
        pos = p.hand; break
      }
      mulls++
    }
    mullDist[Math.min(mulls, 3)]++
    drawn.fill(0); for (const x of hand) drawn[x]++
    let inPlay = 0, landsInHand = hand.filter((x) => isLand[x]).length
    for (let t = 1; t <= turns; t++) {
      if (t >= firstDraw || t > 1) { if (!(t === 1 && firstDraw === 2) && pos < L) { const x = deckArr[pos++]; drawn[x]++; if (isLand[x]) landsInHand++ } }
      if (landsInHand > 0) { landsInHand--; inPlay++ }
      if (inPlay >= t) dropHit[t]++; if (inPlay < Math.min(t, 3)) screw[t]++; landsSum[t] += inPlay
      for (const g of goals) if (g.turn === t) {
        let ok = g.lands_in_play === null || inPlay >= g.lands_in_play
        for (const n of g.need) { if (!ok) break; const c = n.kind === 'card' ? drawn[n.i] : groupCount(n.g); ok = c >= n.min }
        if (ok) g.hits++
      }
    }
    function groupCount(gname) { let s = 0; for (let i = 0; i < drawn.length; i++) if (drawn[i] && groupOf.get(i)?.has(gname)) s += drawn[i]; return s }
  }
  return {
    format: p.id, deck: { main: N, lands_identified: landCountDeck, groups: Object.fromEntries(groupList.map((g) => [g, libCards.filter((i) => groupOf.get(i)?.has(g)).length])), unparsed_lines: d.unparsed.slice(0, 10), unknown_tag_names: unknown.slice(0, 20) },
    settings: { iterations: iters, seed, on_play: onPlay, turns, keep: { min_lands: kMin, max_lands: kMax, max_mulligans: maxMull, rule: 'London mulligan; bottoms excess lands first when land-heavy' } },
    mulligans: { keep_7: r4(mullDist[0] / iters), mull_to_6: r4(mullDist[1] / iters), mull_to_5: r4(mullDist[2] / iters), mull_to_4_or_less: r4(mullDist[3] / iters) },
    by_turn: Array.from({ length: turns }, (_, k) => { const t = k + 1; return { turn: t, p_hit_land_drop: r4(dropHit[t] / iters), avg_lands_in_play: r4(landsSum[t] / iters), p_mana_screwed: r4(screw[t] / iters) } }),
    goals: goals.map((g) => ({ name: g.name, turn: g.turn, requires: [...(g.lands_in_play !== null ? [`${g.lands_in_play}+ lands in play`] : []), ...g.need.map((n) => n.label)], p: r4(g.hits / iters), ci95: ci95(g.hits / iters, iters) })),
    method: 'seeded Monte Carlo goldfish (no opponent): shuffle, London mulligan by land count, draw per turn, play one land per turn when able; same seed + same input = same result',
  }
}
