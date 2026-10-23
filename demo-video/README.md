# Apex demo video (source)

The 3-minute demo is built from **real footage of the running dashboard** plus motion graphics. Nothing on screen is mocked:
the screenshots come from the live dashboard on Strike mainnet data, and the numbers in the charts come from the live API.

| Piece | How |
|---|---|
| Narration | `script.json` → `tts.py` (Microsoft neural voice via `edge-tts`, one clip per scene) |
| Footage | `capture.mjs` / `cap2.mjs` drive the real dashboard with `puppeteer-core` (clean state, live prices) and save 2x screenshots |
| Real data in charts | `src_gapstats.json` (`GET /api/gapstats`) and `src_nvda.json` (NVDA's 97 close→open gaps from Strike's 1h mark history, via `nvda.mjs`) |
| Animation | Remotion (React) in `src/`: camera moves, highlights, cursor, captions, scene timing from the audio lengths |

Rebuild (from this folder, with the dashboard running on port 8790 and Chrome installed):

```bash
npm install
python tts.py
node capture.mjs
npx remotion render src/index.ts Demo out/apex-demo.mp4 --codec h264 --crf 17
```

This folder is tooling only. It is not part of the pnpm workspace and is not used by the Apex product. The illustration in the first scene is labeled as an illustration.
