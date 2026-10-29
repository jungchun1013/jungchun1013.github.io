// Bloom (dual-filter chain) and final composite with AgX tonemapping.
const FS_TRI = /* wgsl */ `
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
`;

export const BLOOM_DOWN = FS_TRI + /* wgsl */ `
struct P { texel: vec4f };   // xy = 1/src size, z = first pass (karis + threshold)
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> U: P;
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, samp, uv, 0.0).rgb; }
fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + luma(c) * 0.25); }
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let t = U.texel.xy;
  let uv = in.uv;
  let a = tap(uv + t * vec2f(-2.0, -2.0));
  let b = tap(uv + t * vec2f(0.0, -2.0));
  let c = tap(uv + t * vec2f(2.0, -2.0));
  let d = tap(uv + t * vec2f(-2.0, 0.0));
  let e = tap(uv);
  let f = tap(uv + t * vec2f(2.0, 0.0));
  let g = tap(uv + t * vec2f(-2.0, 2.0));
  let h = tap(uv + t * vec2f(0.0, 2.0));
  let i = tap(uv + t * vec2f(2.0, 2.0));
  let j = tap(uv + t * vec2f(-1.0, -1.0));
  let k = tap(uv + t * vec2f(1.0, -1.0));
  let l = tap(uv + t * vec2f(-1.0, 1.0));
  let m = tap(uv + t * vec2f(1.0, 1.0));
  var o: vec3f;
  if (U.texel.z > 0.5) {
    // Karis average on the first downsample to tame fireflies from sun glints
    let g0 = (a + b + d + e) * 0.25;
    let g1 = (b + c + e + f) * 0.25;
    let g2 = (d + e + g + h) * 0.25;
    let g3 = (e + f + h + i) * 0.25;
    let g4 = (j + k + l + m) * 0.25;
    let w0 = karis(g0) * 0.125; let w1 = karis(g1) * 0.125; let w2 = karis(g2) * 0.125;
    let w3 = karis(g3) * 0.125; let w4 = karis(g4) * 0.5;
    o = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  return vec4f(min(o, vec3f(6.0e4)), 1.0);
}
`;

export const BLOOM_UP = FS_TRI + /* wgsl */ `
struct P { texel: vec4f };   // xy = 1/src size, z = radius, w = weight
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> U: P;
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, samp, uv, 0.0).rgb; }
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let t = U.texel.xy * U.texel.z;
  let uv = in.uv;
  var o = tap(uv) * 4.0;
  o += (tap(uv + vec2f(-t.x, 0.0)) + tap(uv + vec2f(t.x, 0.0)) + tap(uv + vec2f(0.0, -t.y)) + tap(uv + vec2f(0.0, t.y))) * 2.0;
  o += tap(uv + vec2f(-t.x, -t.y)) + tap(uv + vec2f(t.x, -t.y)) + tap(uv + vec2f(-t.x, t.y)) + tap(uv + vec2f(t.x, t.y));
  return vec4f(o * (U.texel.w / 16.0), 1.0);
}
`;

export const COMPOSITE = FS_TRI + /* wgsl */ `
struct P { p: vec4f, q: vec4f, g0: vec4f, g1: vec4f, g2: vec4f, g3: vec4f, k: vec4f };  // k: grade knee, sky gradient strength, sky gradient horizon (uv.y), -  // p: exposure, bloom, frame, vignette; q: saturation, contrast, warmth, palette grade; g0..g3: grade stops (sky dark, mid, horizon, highlight)
@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> U: P;

fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(v: vec3f) -> vec3f {
  let m = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                  0.0784335999999992, 0.878468636469772, 0.0784336,
                  0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var x = m * max(v, vec3f(1e-10));
  x = clamp(log2(x), vec3f(minEv), vec3f(maxEv));
  x = (x - minEv) / (maxEv - minEv);
  return agxContrast(x);
}
fn agxEotf(v: vec3f) -> vec3f {
  let mi = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                   -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                   -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return mi * v;
}
fn agxLook(v: vec3f, sat: f32, power: f32) -> vec3f {
  let l = dot(v, vec3f(0.2126, 0.7152, 0.0722));
  let p = pow(max(v, vec3f(0.0)), vec3f(power));
  return l + sat * (p - l);
}
// Palette grade: a luminance-indexed tritone toward the site's magic-hour swatches
// (imperial-blue, rosewood, honey-bronze, jasmine), blended in by U.q.w after tone mapping.
fn grade(l: f32) -> vec3f {
  let knee = U.k.x;   // luminance where the mid colour hands over to the horizon colour
  var t = mix(U.g0.rgb, U.g1.rgb, smoothstep(0.0, knee * 0.6, l));
  t = mix(t, U.g2.rgb, smoothstep(knee * 0.6, knee, l));
  t = mix(t, U.g3.rgb, smoothstep(knee, 1.0, l));
  return t;
}
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

@fragment fn fs(in: VO) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(hdr));
  let pc = vec2i(in.pos.xy);
  var c = textureLoad(hdr, pc, 0).rgb;
  // the up-chain accumulates 8 blur levels
  let b = textureSampleLevel(bloom, samp, in.uv, 0.0).rgb * (1.0 / 8.0);
  c = mix(c, b, U.p.y);
  c *= U.p.x;
  // vignette, tinted toward the dark sky colour instead of black
  let d = (in.uv - 0.5) * vec2f(dims.x / dims.y, 1.0);
  let vig = clamp(U.p.w * dot(d, d), 0.0, 1.0);
  let vigTint = U.g0.rgb / max(max(U.g0.r, U.g0.g), max(U.g0.b, 1e-3));
  c *= mix(vec3f(1.0), vigTint * 0.35, vig);
  // sky gradient: blend the top of the frame toward the dark sky colour, fading out at the horizon
  let sg = U.k.y * smoothstep(U.k.z, 0.0, in.uv.y);
  c *= mix(vec3f(1.0), vigTint * 0.45, sg);
  c *= vec3f(1.0 + U.q.z, 1.0, 1.0 - U.q.z);
  // film/sensor-like highlight desaturation: very bright glints and the sun go towards white
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3f(lum), smoothstep(0.7, 6.0, lum) * 0.55);
  var o = agx(c);
  o = agxLook(o, U.q.x, U.q.y);
  o = agxEotf(o);
  let lo = dot(o, vec3f(0.2126, 0.7152, 0.0722));
  o = mix(o, grade(lo), U.q.w);
  // triangular dither against banding in the sky gradients
  let n = ign(in.pos.xy + U.p.z * 5.588238) + ign(in.pos.xy * 1.37 + 17.0 + U.p.z * 3.1) - 1.0;
  o += n / 255.0;
  return vec4f(clamp(o, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
