# MTG Sim

[![mtg-sim MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/GeminiGeorge22/mtg-sim/badges/score.svg)](https://glama.ai/mcp/servers/GeminiGeorge22/mtg-sim)
[![mtg-sim MCP connector](https://glama.ai/mcp/connectors/io.github.GeminiGeorge22/mtg-sim/badges/score.svg)](https://glama.ai/mcp/connectors/io.github.GeminiGeorge22/mtg-sim)

MTG Sim is a **Magic: The Gathering simulator** (a Magic sim / goldfish simulator) you add to Claude, ChatGPT, Cursor, or VS Code. Paste a decklist and ask: is this legal in Commander or Modern? What's the mana curve? How often do I mulligan? What are my odds of Bolt plus two lands by turn 2? Goldfish this list and tell me when I miss my third land.

Operated by **FMF Tools**.

- Live site: https://mtg-sim.fmf-x402.workers.dev/
- MCP endpoint (Streamable HTTP): https://mtg-sim.fmf-x402.workers.dev/mcp
- Install page: https://mtg-sim.fmf-x402.workers.dev/install
- Tools and prices: https://mtg-sim.fmf-x402.workers.dev/docs

No account is required. `tools/list`, deck check, and opening-hand odds are free. Paid sims are charged per successful call through MPP (USDC on Tempo). Bad input is refused and is not charged.

## Install

MCP server URL: `https://mtg-sim.fmf-x402.workers.dev/mcp`

### Claude Desktop

Settings → Connectors → Add custom connector → URL: `https://mtg-sim.fmf-x402.workers.dev/mcp`

Or add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mtg-sim": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mtg-sim.fmf-x402.workers.dev/mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http mtg-sim https://mtg-sim.fmf-x402.workers.dev/mcp
```

### Cursor

One-click: [Add MTG Sim in Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=mtg-sim&config=eyJ1cmwiOiJodHRwczovL210Zy1zaW0uZm1mLXg0MDIud29ya2Vycy5kZXYvbWNwIn0=)

Or put this in `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "mtg-sim": {
      "url": "https://mtg-sim.fmf-x402.workers.dev/mcp"
    }
  }
}
```

### VS Code (Copilot agent mode)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "mtg-sim": {
      "type": "http",
      "url": "https://mtg-sim.fmf-x402.workers.dev/mcp"
    }
  }
}
```

Or:

```bash
code --add-mcp '{"name":"mtg-sim","type":"http","url":"https://mtg-sim.fmf-x402.workers.dev/mcp"}'
```

### ChatGPT

Settings → Apps & Connectors → Advanced settings → turn on Developer mode → Create connector.

- Name: MTG Sim
- MCP server URL: `https://mtg-sim.fmf-x402.workers.dev/mcp`
- Authentication: none

## Then ask

- "Is this Commander deck legal?" (paste the list)
- "What are my odds of Lightning Bolt plus 2 lands by turn 2 on the draw?"
- "Goldfish this deck and tell me how often I mulligan and hit 4 lands by turn 4."
- "How many lands and red sources should this deck run?"

## Tools

| Tool | Price | What it does |
| --- | --- | --- |
| `mtg_deck_check` | Free | Format legality (22 formats), Commander/EDH color identity and size, mana curve |
| `mtg_opening_hand_odds` | Free | Opening-hand odds for a pasted list |
| `mtg_draw_odds` | $0.001 / call | Exact draw sim: odds to have your cards by turn N |
| `mtg_land_count` | $0.001 / call | Land-count and color-source calculator |
| `mtg_goldfish` | $0.003 / call | Goldfish simulator and London mulligan sim (up to 20,000 games, seeded) |

Answers are exact hypergeometric odds or seeded Monte Carlo. They are not guesses.

## Fan Content Policy

MTG Sim is unofficial Fan Content permitted under the [Wizards of the Coast Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data from [Scryfall](https://scryfall.com/docs/api) (free, never paywalled). Paid tools sell only our own computation (probability and simulation on what you send) and return no card data.

## Develop

```bash
node test/unit.mjs
```

The unit tests cover hypergeometric math, decklist parsing, goldfish determinism, land-count monotonicity, and deck checks against known lists (Modern Burn legal, Commander bans and color identity, Relentless Rats any-number, DFC front faces, Vintage restricted). They read the local Scryfall-derived shards in `public/data/mtg/`.

`scripts/build_mtg_data.py` rebuilds those shards from Scryfall bulk data. The live worker is a Cloudflare Worker (`wrangler.toml`). Payment signing keys are Wrangler secrets (`MPP_SECRET_KEY`) and must never be committed.

## License

MIT. Dependencies used to run or test payments (`mppx`, `viem`) are MIT.
