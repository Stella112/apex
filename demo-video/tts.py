"""Generate one voiceover clip per scene with Microsoft neural voices (edge-tts), then report durations."""
import asyncio, json, subprocess, sys
import edge_tts

VOICE = sys.argv[1] if len(sys.argv) > 1 else "en-US-AndrewMultilingualNeural"
RATE = sys.argv[2] if len(sys.argv) > 2 else "-3%"
scenes = json.load(open("script.json", encoding="utf-8"))


async def one(s):
    out = f"audio/{s['id']}.mp3"
    await edge_tts.Communicate(s["text"], VOICE, rate=RATE).save(out)
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).decode().strip())
    return s["id"], len(s["text"].split()), d


async def main():
    res = await asyncio.gather(*[one(s) for s in scenes])
    total = 0.0
    for i, w, d in res:
        total += d
        print(f"{i}: {w:3d} words  {d:5.1f}s")
    print(f"TOTAL {total:.1f}s  (+gaps ~{0.45 * len(res):.1f}s)  voice={VOICE} rate={RATE}")
    json.dump({i: d for i, _, d in res}, open("audio/durations.json", "w"))


asyncio.run(main())
