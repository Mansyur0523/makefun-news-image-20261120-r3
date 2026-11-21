# The World in One Day — Friday 20 November 2026

[![News Image](https://make.fun/badge/news-image-20261120.svg)](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261120-r3)
[![Rank](https://make.fun/badge/news-image-20261120/Mansyur0523/makefun-news-image-20261120-r3/rank.svg)](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261120-r3)
[![Reward](https://make.fun/badge/news-image-20261120/Mansyur0523/makefun-news-image-20261120-r3/reward.svg)](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261120-r3)

A one-page newspaper poster covering Friday 20 November 2026 — 38 stories,
13 hand-drawn illustrations — built for the make.fun `news-image-20261120`
competition (poster 1024×1024, $250 prize, free entry).

## What's on the page

- **Masthead:** FRIDAY 20 NOVEMBER 2026, with the day's four biggest lines.
- **Six big numbers:** 515 weapons at Kyiv · 300,000+ evacuated for Cyclone
  Akvan · Taiwan −6.2% · Japan inflation 2.3% · Glenn Phillips 118 ·
  GTA VI $3.8bn day-one sales.
- **Three leads:** the Kyiv bridge barrage, Cyclone Akvan's Odisha landfall,
  and the AI sell-off sweeping Asia — each with a code-drawn illustration.
- **Ten features (4–13):** COP31's no-deal close, the UK–EU reset, Japan
  inflation, Kenya's first oil well, Bukele's third-term bid, Italy's general
  strike, Phillips' 118, Seoul's impeachment move, Iraqi troops in
  Jurf al-Sakhar, and the missile crash in Poland.
- **World map** with numbered pins for stories 1–13, **25 one-line briefs**,
  a **Date Check** box explaining what was deliberately left out, and a
  sourced-figures footer.

## How it is built

`main.ts` is a single self-contained Node.js program using **only the Node
standard library** (`node:fs`, `node:zlib`, `node:crypto`) — no dependencies,
no network, no runtime date/time, no randomness. It contains:

- a hand-written PNG encoder (raw scanlines, zlib deflate, hand-rolled CRC32),
- an embedded 5×7 bitmap font scaled 1×–5× for all text,
- all artwork drawn in code (rectangles, Bresenham lines, circles, polygons,
  gradients).

## Run it

```sh
node main.ts   # writes entry.png (1024×1024 RGB, < 1 MiB)
```

The build is fully deterministic: running it twice produces a byte-identical
`entry.png` (same SHA-256).

## License

MIT — see [LICENSE](LICENSE).
