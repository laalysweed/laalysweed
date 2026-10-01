// Generates the scenic SVG backgrounds in public/img (run: node scripts/gen-scenes.mjs).
// Deterministic (seeded) so re-running produces identical files.
import { writeFileSync, mkdirSync } from 'node:fs';

const W = 1920;
const H = 1080;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const r = (a, b) => a + rnd() * (b - a);

/** Midpoint-displacement ridge line → closed path down to the bottom edge. */
function ridge(baseY, rough, amp, bottom = H, peaks = []) {
  let pts = [
    [0, baseY + r(-amp, amp)],
    [W, baseY + r(-amp, amp)],
  ];
  let a = amp;
  for (let it = 0; it < 8; it++) {
    const next = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      next.push([x1, y1], [(x1 + x2) / 2, (y1 + y2) / 2 + r(-a, a)]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    a *= rough;
  }
  for (const p of peaks) {
    for (const pt of pts) {
      const d = Math.abs(pt[0] - p.x);
      if (d < p.w) pt[1] -= p.h * Math.pow(1 - d / p.w, 1.6);
    }
  }
  return { pts, d: `M0 ${bottom} ` + pts.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ` L${W} ${bottom} Z` };
}

/** Snow caps: follow the ridge but only above a threshold. */
function snow(pts, threshold, depth) {
  const segs = [];
  let cur = [];
  for (const [x, y] of pts) {
    if (y < threshold) cur.push([x, y]);
    else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  return segs
    .filter((s) => s.length > 3)
    .map((s) => {
      const top = s.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
      const bottom = [...s].reverse().map(([x, y]) => `L${(x + r(-6, 6)).toFixed(1)} ${(y + depth * r(0.35, 1.2)).toFixed(1)}`).join(' ');
      return `M${s[0][0].toFixed(1)} ${s[0][1].toFixed(1)} ${top} ${bottom} Z`;
    })
    .join(' ');
}

function pines(count, yMin, yMax, hMin, hMax) {
  const trees = [];
  for (let i = 0; i < count; i++) {
    const x = r(-20, W + 20);
    const y = r(yMin, yMax);
    const h = r(hMin, hMax) * (0.6 + (y - yMin) / (yMax - yMin + 1) * 0.6);
    const w = h * r(0.28, 0.36);
    let d = `M${x.toFixed(1)} ${(y - h).toFixed(1)}`;
    const tiers = 5;
    for (let t = 1; t <= tiers; t++) {
      const ty = y - h + (h * t) / tiers;
      const tw = (w * t) / tiers;
      d += ` L${(x + tw).toFixed(1)} ${ty.toFixed(1)} L${(x + tw * 0.45).toFixed(1)} ${ty.toFixed(1)}`;
    }
    for (let t = tiers; t >= 1; t--) {
      const ty = y - h + (h * t) / tiers;
      const tw = (w * t) / tiers;
      d += ` L${(x - tw * 0.45).toFixed(1)} ${ty.toFixed(1)} L${(x - tw).toFixed(1)} ${ty.toFixed(1)}`;
    }
    trees.push({ y, d: d + ' Z' });
  }
  return trees.sort((a, b) => a.y - b.y).map((t) => t.d).join(' ');
}

const svg = (defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>\n`;

mkdirSync('public/img', { recursive: true });

// ---------- Mountains & forest (terminal default) ----------
seed = 11;
{
  const far = ridge(470, 0.55, 90, H, [{ x: 1650, w: 380, h: 170 }, { x: 420, w: 300, h: 110 }]);
  const mid = ridge(560, 0.52, 70, H, [{ x: 520, w: 520, h: 260 }, { x: 1180, w: 360, h: 150 }]);
  const valley = 'M0 700 C 400 660, 900 690, 1300 670 S 1800 690, 1920 680 L1920 760 L0 760 Z';
  const hills = ridge(700, 0.5, 30, H);
  const hills2 = ridge(820, 0.5, 40, H);
  writeFileSync(
    'public/img/scene-mountains.svg',
    svg(
      `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f3350"/><stop offset=".45" stop-color="#6b86a3"/><stop offset=".7" stop-color="#b9c8d6"/></linearGradient>
       <linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8599b1"/><stop offset="1" stop-color="#5d7089"/></linearGradient>
       <linearGradient id="mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4b5f77"/><stop offset="1" stop-color="#2d3b4c"/></linearGradient>
       <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9db4c6"/><stop offset="1" stop-color="#5e7a8e"/></linearGradient>
       <radialGradient id="haze" cx=".5" cy=".62" r=".6"><stop offset="0" stop-color="#e8eef5" stop-opacity=".45"/><stop offset="1" stop-color="#e8eef5" stop-opacity="0"/></radialGradient>
       <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>`,
      `<rect width="${W}" height="${H}" fill="url(#sky)"/>
       <g filter="url(#soft)" opacity=".55"><ellipse cx="360" cy="160" rx="420" ry="70" fill="#dfe7ef"/><ellipse cx="1400" cy="110" rx="520" ry="60" fill="#c9d5e2"/><ellipse cx="900" cy="260" rx="380" ry="40" fill="#e8eef5"/></g>
       <path d="${far.d}" fill="url(#far)"/><path d="${snow(far.pts, 440, 60)}" fill="#e3eaf1" opacity=".85"/>
       <rect width="${W}" height="${H}" fill="url(#haze)"/>
       <path d="${mid.d}" fill="url(#mid)"/><path d="${snow(mid.pts, 470, 90)}" fill="#eef3f8" opacity=".95"/>
       <path d="${valley}" fill="url(#lake)"/>
       <path d="${hills.d}" fill="#3a4a3a"/><path d="${pines(260, 690, 780, 30, 70)}" fill="#26352b"/>
       <path d="${hills2.d}" fill="#1f2c22"/><path d="${pines(170, 780, 1080, 90, 260)}" fill="#17231b"/>`,
    ),
  );
}

// ---------- Sunrise (landing hero) ----------
seed = 23;
{
  const sea = ridge(760, 0.5, 18, H);
  writeFileSync(
    'public/img/scene-sunrise.svg',
    svg(
      `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07162b"/><stop offset=".35" stop-color="#15345a"/><stop offset=".58" stop-color="#3f5f86"/><stop offset=".74" stop-color="#b9855a"/><stop offset=".86" stop-color="#f0a24b"/><stop offset="1" stop-color="#3a2a22"/></linearGradient>
       <radialGradient id="sun" cx=".33" cy=".8" r=".45"><stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/><stop offset=".25" stop-color="#f7a24a" stop-opacity=".55"/><stop offset="1" stop-color="#f7a24a" stop-opacity="0"/></radialGradient>
       <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>`,
      `<rect width="${W}" height="${H}" fill="url(#sky)"/>
       <rect width="${W}" height="${H}" fill="url(#sun)"/>
       <g filter="url(#blur)" opacity=".7">
         <ellipse cx="300" cy="640" rx="420" ry="40" fill="#f2b36b"/><ellipse cx="1000" cy="700" rx="520" ry="34" fill="#e39a5a"/>
         <ellipse cx="1500" cy="620" rx="380" ry="30" fill="#9d7a78"/><ellipse cx="700" cy="560" rx="300" ry="22" fill="#8b90a8"/>
       </g>
       <path d="${sea.d}" fill="#1c1b22" opacity=".92"/>
       <path d="M0 ${H} L0 900 C 500 860, 1100 940, 1920 880 L1920 ${H} Z" fill="#0f1116"/>`,
    ),
  );
}

// ---------- Aurora ----------
seed = 41;
{
  const m = ridge(720, 0.55, 90, H, [{ x: 1300, w: 420, h: 200 }]);
  writeFileSync(
    'public/img/scene-aurora.svg',
    svg(
      `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#030712"/><stop offset=".6" stop-color="#0b1b2e"/><stop offset="1" stop-color="#12304a"/></linearGradient>
       <linearGradient id="au" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2dd4bf" stop-opacity="0"/><stop offset=".5" stop-color="#2dd4bf" stop-opacity=".55"/><stop offset="1" stop-color="#22c55e" stop-opacity="0"/></linearGradient>
       <filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28"/></filter>`,
      `<rect width="${W}" height="${H}" fill="url(#sky)"/>
       ${Array.from({ length: 160 }, () => `<circle cx="${r(0, W).toFixed(0)}" cy="${r(0, 620).toFixed(0)}" r="${r(0.6, 1.8).toFixed(1)}" fill="#fff" opacity="${r(0.25, 0.9).toFixed(2)}"/>`).join('')}
       <g filter="url(#b)"><path d="M-100 380 C 300 200, 700 520, 1100 300 S 1700 180, 2050 360 L2050 520 C 1700 360, 1300 520, 1000 460 S 300 420, -100 560 Z" fill="url(#au)"/>
       <path d="M200 250 C 600 120, 900 360, 1300 200 S 1800 120, 2000 220 L2000 300 C 1600 240, 1300 380, 900 320 S 500 240, 200 340 Z" fill="#38bdf8" opacity=".25"/></g>
       <path d="${m.d}" fill="#0b1522"/><path d="${snow(m.pts, 640, 50)}" fill="#9fb6c9" opacity=".35"/>
       <path d="${pines(220, 900, 1080, 60, 180)}" fill="#050b13"/>`,
    ),
  );
}
console.log('scenes written to public/img');
