// CI unit tests: node test/unit.mjs (exit 1 on failure). Uses local public/data shards as env.ASSETS.
import fs from 'fs'; import assert from 'assert/strict'
import { hyperAtLeast, multiAtLeast, parseDeck } from '../tcg.mjs'
import { drawOdds, landCount, goldfish } from '../compute.mjs'
import { deckCheck } from '../mtg.mjs'
const env = { ASSETS: { fetch: async (r) => { const p = new URL(r.url).pathname; try { return new Response(fs.readFileSync(new URL('../public' + p, import.meta.url))) } catch { return new Response('', { status: 404 }) } } } }
let n = 0; const t = async (name, f) => { await f(); n++; console.log('ok', name) }
await t('hypergeometric 4-of in 7 of 60 = 39.95%', () => assert.equal(hyperAtLeast(60, 4, 7, 1).toFixed(4), '0.3995'))
await t('multivariate equals product rule bound', () => { const a = multiAtLeast(60, [{ copies: 4, min: 1 }], 7); assert.equal(a.toFixed(6), hyperAtLeast(60, 4, 7, 1).toFixed(6)) })
await t('on the play sees 9 by T3, draw 10', () => { assert.equal(drawOdds({ cards: [{ copies: 4 }], turn: 3 }).by_turn[2].cards_seen, 9); assert.equal(drawOdds({ cards: [{ copies: 4 }], turn: 3, on_play: false }).by_turn[2].cards_seen, 10) })
await t('commander draws turn 1', () => assert.equal(drawOdds({ format: 'commander', cards: [{ copies: 1 }], turn: 1 }).by_turn[0].cards_seen, 8))
await t('arena/moxfield/mtgo parsing', () => { const d = parseDeck('Deck\n4 Lightning Bolt (2X2) 117\n2x Goblin Guide *F*\n20 Mountain\n\nSideboard\n2 Smash to Smithereens\nSB: 1 Pyroblast'); assert.deepEqual(d.counts, { main: 26, side: 3, commander: 0 }) })
await t('goldfish deterministic for a seed', () => { const j = { decklist: '24 Mountain\n36 Lightning Bolt', iterations: 2000, seed: 42 }; assert.deepEqual(goldfish(j), goldfish(j)) })
await t('goldfish rejects decks with no lands', () => assert.throws(() => goldfish({ decklist: '60 Lightning Bolt' })))
await t('land count: 17 lands of 40 -> monotone', () => { const r = landCount({ format: 'limited', lands: 17 }); assert.ok(r.your_lands.drops[0].p_hit > r.your_lands.drops[3].p_hit) })
await t('deck check modern burn legal', async () => { const r = await deckCheck({ format: 'modern', decklist: '4 Lightning Bolt\n4 Goblin Guide\n4 Monastery Swiftspear\n4 Lava Spike\n4 Rift Bolt\n4 Skewer the Critics\n4 Light Up the Stage\n4 Eidolon of the Great Revel\n4 Searing Blaze\n4 Skullcrack\n20 Mountain' }, env); assert.equal(r.legal, true, JSON.stringify(r.problems)) })
await t('deck check commander catches ban + identity + size', async () => { const r = await deckCheck({ format: 'commander', decklist: "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n1 Lightning Bolt\n1 Mana Crypt\n95 Forest" }, env); assert.equal(r.legal, false); assert.ok(r.problems.some((p) => /Mana Crypt is banned/.test(p))); assert.ok(r.problems.some((p) => /Lightning Bolt is outside/.test(p))); assert.ok(r.problems.some((p) => /99 cards/.test(p))) })
await t('deck check: Relentless Rats any number, 5 Bolts flagged', async () => { const r = await deckCheck({ format: 'modern', decklist: '20 Relentless Rats\n5 Lightning Bolt\n35 Swamp' }, env); assert.ok(r.problems.some((p) => /Lightning Bolt: 5 copies/.test(p))); assert.ok(!r.problems.some((p) => /Relentless/.test(p))) })
await t('deck check: DFC front face name resolves', async () => { const r = await deckCheck({ format: 'pioneer', decklist: '4 Fable of the Mirror-Breaker\n56 Mountain' }, env); assert.equal(r.legal, true, JSON.stringify(r.problems)) })
await t('deck check: vintage restricted', async () => { const r = await deckCheck({ format: 'vintage', decklist: '2 Sol Ring\n58 Island' }, env); assert.ok(r.problems.some((p) => /restricted/.test(p))) })
console.log('all', n, 'passed')
