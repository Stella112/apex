import React from "react";
import { Composition, Sequence } from "remotion";
import { S1, S2 } from "./scenes1";
import { S3, S4 } from "./scenes2";
import { S5, S6 } from "./scenes3";
import { S7, S8, S9 } from "./scenes4";
import { FPS, SCENES, TOTAL_FRAMES } from "./timeline";

const COMPONENTS = [S1, S2, S3, S4, S5, S6, S7, S8, S9];

const Demo: React.FC = () => (
  <>
    {SCENES.map((s, i) => {
      const Scene = COMPONENTS[i]!;
      return (
        <Sequence key={s.id} from={s.start} durationInFrames={s.frames}>
          <Scene />
        </Sequence>
      );
    })}
  </>
);

export const Root: React.FC = () => (
  <Composition id="Demo" component={Demo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
