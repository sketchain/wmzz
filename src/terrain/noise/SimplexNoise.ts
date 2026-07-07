/**
 * Seeded 2D simplex noise (Gustavson's reference algorithm, hand-ported).
 * Deterministic across runs and platforms — terrain generation must produce
 * identical worlds for identical seeds, so Math.random is banned here.
 */
export class SimplexNoise2D {
  private readonly perm = new Uint8Array(512);
  private readonly permMod12 = new Uint8Array(512);

  private static readonly GRAD = new Float64Array([
    1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1,
  ]);

  private static readonly F2 = 0.5 * (Math.sqrt(3) - 1);
  private static readonly G2 = (3 - Math.sqrt(3)) / 6;

  constructor(seed: number) {
    // Fisher-Yates over 0..255 driven by a mulberry32 stream.
    let state = seed >>> 0;
    const rand = (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const source = new Uint8Array(256);
    for (let i = 0; i < 256; i++) source[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = source[i];
      source[i] = source[j];
      source[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = source[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** Noise value in [-1, 1]. */
  noise(xin: number, yin: number): number {
    const { F2, G2, GRAD } = SimplexNoise2D;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = this.permMod12[ii + this.perm[jj]] * 2;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD[gi0] * x0 + GRAD[gi0 + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]] * 2;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD[gi1] * x1 + GRAD[gi1 + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]] * 2;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD[gi2] * x2 + GRAD[gi2 + 1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** Fractional Brownian motion, output roughly in [-1, 1]. */
  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amplitude * this.noise(x * frequency, y * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal in [0, 1] — sharp mountain crests. */
  ridged(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amplitude * (1 - Math.abs(this.noise(x * frequency, y * frequency)));
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }
}
