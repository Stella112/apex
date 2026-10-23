import dur from "../src_durations.json";
import script from "../script.json";

export const FPS = 30;
export const LEAD = 6; // frames before narration starts inside a scene
const TAIL = 6;

export const IDS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"] as const;
export type SceneId = (typeof IDS)[number];

export interface SceneInfo { id: SceneId; d: number; frames: number; start: number; text: string }

let at = 0;
export const SCENES: SceneInfo[] = IDS.map((id) => {
  const d = (dur as Record<string, number>)[id]!;
  const frames = Math.round(d * FPS) + LEAD + TAIL + (id === "s9" ? 60 : 0);
  const info = { id, d, frames, start: at, text: script.find((s) => s.id === id)!.text };
  at += frames;
  return info;
});
export const TOTAL_FRAMES = at;

/** Frame inside a scene for a moment `sec` seconds into the narration. */
export const T = (sec: number) => LEAD + Math.round(sec * FPS);
