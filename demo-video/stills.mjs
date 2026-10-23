// Bundle once, render selected frames to PNGs for review: node stills.mjs s4:14.5 s4:20 ...
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync, readFileSync } from "node:fs";

const FPS = 30, LEAD = 6;
const dur = JSON.parse(readFileSync("src_durations.json", "utf8"));
const ids = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];
const starts = {};
let at = 0;
for (const id of ids) { starts[id] = at; at += Math.round(dur[id] * FPS) + LEAD + 6 + (id === "s9" ? 60 : 0); }

const args = process.argv.slice(2);
mkdirSync("out/stills", { recursive: true });
const browserExecutable = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const serveUrl = await bundle({ entryPoint: "src/index.ts", onProgress: () => undefined });
const comp = await selectComposition({ serveUrl, id: "Demo", browserExecutable });
for (const a of args) {
  const [id, sec] = a.split(":");
  const frame = starts[id] + LEAD + Math.round(Number(sec) * FPS);
  const out = `out/stills/${id}_${sec}.png`;
  await renderStill({ composition: comp, serveUrl, output: out, frame, browserExecutable, scale: 0.5 });
  console.log("still", out, "frame", frame);
}
