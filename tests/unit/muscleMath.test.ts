import { describe, expect, it } from 'vitest';
import { fusiformV1, fusiformV2, polylineLength, type P3 } from '../../apps/web/src/muscles/muscleMath';
import { validateManifest, type AnatomyManifest } from '../../packages/anatomy-schema/src/index';
import manifest from '../../apps/web/public/data/arm_manifest.json';

const ELBOW: P3 = [0.3, 0, 0];

/** 繞肘關節、以 axis(-Y) 旋轉 deg 度（右手定則），模擬 PoseController 的肘屈曲 */
function flexAboutElbow(p: P3, deg: number): P3 {
  const t = (-deg * Math.PI) / 180; // axis = -Y 等同繞 +Y 轉 -deg
  const x = p[0] - ELBOW[0];
  const z = p[2] - ELBOW[2];
  return [ELBOW[0] + x * Math.cos(t) + z * Math.sin(t), p[1], ELBOW[2] - x * Math.sin(t) + z * Math.cos(t)];
}

function musclePathAt(id: string, deg: number): P3[] {
  const m = (manifest as unknown as AnatomyManifest).muscles.find((x) => x.id === id)!;
  return [...m.origin, ...m.via_points, ...m.insertion].map((a) =>
    a.bone === 'forearm_l' ? flexAboutElbow(a.position, deg) : (a.position as P3),
  );
}

describe('anatomy manifest', () => {
  it('passes schema validation', () => {
    expect(validateManifest(manifest as unknown as AnatomyManifest)).toEqual([]);
  });
});

describe('polylineLength', () => {
  it('sums segment lengths', () => {
    expect(polylineLength([[0, 0, 0], [3, 4, 0], [3, 4, 12]])).toBeCloseTo(17);
  });
});

describe('elbow flexion kinematics', () => {
  it('biceps shortens and triceps lengthens monotonically 0→130°', () => {
    let prevBi = Infinity;
    let prevTri = -Infinity;
    for (const deg of [0, 45, 90, 130]) {
      const bi = polylineLength(musclePathAt('biceps_brachii_left', deg));
      const tri = polylineLength(musclePathAt('triceps_brachii_left', deg));
      expect(bi).toBeLessThan(prevBi);
      expect(tri).toBeGreaterThan(prevTri);
      prevBi = bi;
      prevTri = tri;
    }
  });
});

describe('fusiform_v1 profile', () => {
  it('rest length, no activation → neutral', () => {
    const o = fusiformV1({ length: 1, restLength: 1, activation: 0 });
    expect(o.contraction).toBe(0);
    expect(o.stretch).toBe(0);
    expect(o.bulge).toBe(0);
  });
  it('activation is independent of pose: same length, more activation → more bulge', () => {
    const a = fusiformV1({ length: 0.85, restLength: 1, activation: 0.1 });
    const b = fusiformV1({ length: 0.85, restLength: 1, activation: 0.9 });
    expect(b.bulge).toBeGreaterThan(a.bulge);
    expect(b.contraction).toBe(a.contraction);
  });
  it('shortening increases bulge, lengthening drives stretch', () => {
    expect(fusiformV1({ length: 0.75, restLength: 1, activation: 0 }).bulge).toBeGreaterThan(0.4);
    expect(fusiformV1({ length: 1.15, restLength: 1, activation: 0 }).stretchWeight).toBeGreaterThan(0.5);
  });
  it('M2.6: activation never drives longitudinal shortening', () => {
    for (const length of [0.7, 0.85, 1, 1.1, 1.3]) {
      const base = fusiformV2({ length, restLength: 1, activation: 0 });
      for (const activation of [0.25, 0.5, 1]) {
        const o = fusiformV2({ length, restLength: 1, activation });
        expect(o.shortenWeight).toBe(base.shortenWeight);
        expect(o.contraction).toBe(base.contraction);
      }
    }
  });
  it('M2.6: isometric (rest length) + full activation → bulge but zero shortening', () => {
    const o = fusiformV2({ length: 1, restLength: 1, activation: 1 });
    expect(o.shortenWeight).toBe(0);
    expect(o.bulgeWeight).toBeGreaterThan(0.3);
  });
  it('M2.6: shortenWeight follows geometric shortening', () => {
    expect(fusiformV2({ length: 0.85, restLength: 1, activation: 0 }).shortenWeight).toBeCloseTo(0.5);
    expect(fusiformV2({ length: 1.1, restLength: 1, activation: 0 }).shortenWeight).toBe(0);
  });
  it('fusiform_v1 is an alias of v2', () => {
    expect(fusiformV1).toBe(fusiformV2);
  });
  it('all outputs stay in 0..1', () => {
    for (const length of [0.1, 0.5, 1, 1.5, 3]) {
      for (const activation of [-1, 0, 0.5, 1, 2]) {
        const o = fusiformV2({ length, restLength: 1, activation });
        for (const v of Object.values(o)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
