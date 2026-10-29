/*
 * ocean.js — magic-hour ocean behind the #banner cover.
 *
 * Preferred path: web-ocean (Maksymilian Dendura, MIT, https://github.com/noniv/web-ocean), a
 * WebGPU FFT ocean with a physical sky, forked in assets/ocean/ with the site's water colours
 * and a palette grade. It is embedded as a non-interactive iframe.
 * Fallback: the WebGL1 raymarched ocean below, for browsers without WebGPU.
 */
(function () {
	var banner = document.getElementById('banner');
	if (!banner) return;

	// ---------------------------------------------------------------- web-ocean (WebGPU)
	var SCENE = {
		ui: 0,
		cam: '0,2.6,0,0,-5.5',  // x,y,z,yawDeg,pitchDeg: fixed cover camera
		float: 0,               // never let passing crests lift the camera
		windSpeed: 3.2,
		windDir: 118,
		fetchKm: 50,
		swellHs: 1.2,
		swellLength: 240,
		swellDir: 90,
		choppy: 1.05,
		turbidity: 1.2,
		foam: 0.32,
		sunElev: 2.8,
		sunAzim: 12.5,
		haze: 4.2,
		clouds: 0,
		veil: 0,
		warmth: -0.2,
		grade: 0.36,
		exposure: 1,
		bloom: 0.04,
		vignette: 0.36,
		sky0: '242966',
		sky1: 'c46883',
		sky2: 'ffb54d',
		sky3: 'ffe27a',
		waterCol: '1a3c42',
		waterK: 5,
		sssCol: '7d447e',
		sssK: 1
	};






	// ?tune=1 on the page: show web-ocean's settings panel inside the banner (card and nav
	// stay in place) and make the iframe clickable so the sliders work.
	var TUNE = /[?&]tune=1/.test(location.search);

	function startWebGPU(onFail) {
		var dpr = window.devicePixelRatio || 1;
		// FFT ocean is GPU-heavy: render at about 60% of device resolution and let CSS scale it
		var scale = 0.6;
		var params = Object.assign({}, SCENE, {
			w: Math.max(640, Math.round(banner.clientWidth * dpr * scale)),
			h: Math.max(360, Math.round(banner.clientHeight * dpr * scale))
		});
		if (TUNE) Object.assign(params, { ui: 0, panel: 1, panelTop: 72, look: 0 });
		var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');

		var frame = document.createElement('iframe');
		frame.className = 'ocean-frame';
		frame.setAttribute('aria-hidden', 'true');
		frame.setAttribute('tabindex', '-1');
		frame.setAttribute('title', 'ocean');
		frame.src = 'assets/ocean/ocean.html?' + q;
		if (TUNE) frame.style.pointerEvents = 'auto';
		banner.insertBefore(frame, banner.firstChild);
		banner.classList.add('has-ocean');

		var failed = false;
		function fail() {
			if (failed) return; failed = true;
			frame.remove();
			onFail();
		}
		window.addEventListener('message', function (e) {
			if (e.source === frame.contentWindow && e.data === 'ocean:fail') fail();
		});

		function post(msg) { try { frame.contentWindow.postMessage(msg, '*'); } catch (e) {} }
		var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		var visible = true;
		function sync() { post((reduced || !visible || document.hidden) ? 'ocean:pause' : 'ocean:resume'); }
		if ('IntersectionObserver' in window) {
			new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; sync(); }, { threshold: 0 }).observe(banner);
		}
		document.addEventListener('visibilitychange', sync);
		frame.addEventListener('load', function () { setTimeout(sync, reduced ? 2500 : 0); });
	}

	if (navigator.gpu && navigator.gpu.requestAdapter) {
		navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function (adapter) {
			if (adapter) startWebGPU(startWebGL); else startWebGL();
		}, startWebGL);
	} else {
		startWebGL();
	}

	// ---------------------------------------------------------------- WebGL1 fallback
	function startWebGL() {

	var canvas = document.createElement('canvas');
	canvas.className = 'ocean-canvas';
	canvas.setAttribute('aria-hidden', 'true');
	banner.insertBefore(canvas, banner.firstChild);

	var gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' })
		|| canvas.getContext('experimental-webgl');
	if (!gl) { canvas.remove(); return; }

	var VERT = [
		'attribute vec2 a_pos;',
		'void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }'
	].join('\n');

	var FRAG = [
		'precision highp float;',
		'uniform vec2 u_res;',
		'uniform float u_time;',
		'uniform float u_camz;',

		'const float SEA_LEVEL = 0.0;',   // the octave waves are >= 0, so the surface never dips below this
		'const float SEA_HEIGHT = 0.42;',
		'const float SEA_CHOPPY = 2.6;',
		'const float SEA_SPEED = 0.55;',
		'const float SEA_FREQ = 0.16;',
		'const mat2 OCT = mat2(1.6, 1.2, -1.2, 1.6);',

		// magic-hour palette
		'const vec3 SUN_DIR_RAW = vec3(0.35, 0.0741, 1.0);',  // 4 deg above the horizon
		'const vec3 SUN_COL   = vec3(1.000, 0.812, 0.459);',
		'const vec3 SKY_TOP   = vec3(0.141, 0.161, 0.400);',
		'const vec3 SKY_MID   = vec3(0.722, 0.380, 0.475);',
		'const vec3 SKY_HOR   = vec3(1.000, 0.718, 0.322);',
		'const vec3 SEA_BASE  = vec3(0.051, 0.102, 0.188);',
		'const vec3 SEA_WATER = vec3(0.235, 0.443, 0.486);',

		'float hash(vec2 p){ float h = dot(p, vec2(127.1, 311.7)); return fract(sin(h) * 43758.5453123); }',
		'float noise(vec2 p){',
		'  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);',
		'  return -1.0 + 2.0*mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x),',
		'                        mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y);',
		'}',

		'float diffuse(vec3 n, vec3 l, float p){ return pow(dot(n,l)*0.4+0.6, p); }',
		'float specular(vec3 n, vec3 l, vec3 e, float s){',
		'  float nrm = (s + 8.0) / (3.1415 * 8.0);',
		'  return pow(max(dot(reflect(e,n), l), 0.0), s) * nrm;',
		'}',

		'vec3 getSky(vec3 d, vec3 sun){',
		'  float h = max(d.y, 0.0);',
		'  vec3 col = mix(SKY_HOR, SKY_MID, smoothstep(0.0, 0.10, h));',
		'  col = mix(col, SKY_TOP, smoothstep(0.07, 0.34, h));',
		'  float s = max(dot(d, sun), 0.0);',
		'  col += SUN_COL * pow(s, 10.0) * 0.28;',                 // wide warm glow
		'  col += vec3(1.0, 0.88, 0.7) * pow(s, 2500.0) * 1.0;',  // sun disc
		'  return col;',
		'}',

		'float seaOctave(vec2 uv, float choppy){',
		'  uv += noise(uv);',
		'  vec2 wv = 1.0 - abs(sin(uv));',
		'  vec2 swv = abs(cos(uv));',
		'  wv = mix(wv, swv, wv);',
		'  return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);',
		'}',

		// waves flatten with distance; high frequencies vanish first (a cheap stand-in for
		// web-ocean's mip-filtered slope spectrum)
		'float distFade(float dz){ return exp(-dz * dz * 0.00008); }',

		'float map(vec3 p){',
		'  float dz = max(p.z - u_camz, 0.0);',
		'  float freq = SEA_FREQ, amp = SEA_HEIGHT * distFade(dz), choppy = SEA_CHOPPY;',
		'  vec2 uv = p.xz; uv.x *= 0.75;',
		'  float t = 1.0 + u_time * SEA_SPEED;',
		'  float d, h = 0.0;',
		'  for (int i = 0; i < 3; i++) {',
		'    d  = seaOctave((uv + t) * freq, choppy);',
		'    d += seaOctave((uv - t) * freq, choppy);',
		'    h += d * amp * exp(-dz * freq * 0.07);',
		'    uv *= OCT; freq *= 1.9; amp *= 0.22;',
		'    choppy = mix(choppy, 1.0, 0.2);',
		'  }',
		'  return p.y - SEA_LEVEL - h;',
		'}',

		'float mapDetailed(vec3 p){',
		'  float dz = max(p.z - u_camz, 0.0);',
		'  float freq = SEA_FREQ, amp = SEA_HEIGHT * distFade(dz), choppy = SEA_CHOPPY;',
		'  vec2 uv = p.xz; uv.x *= 0.75;',
		'  float t = 1.0 + u_time * SEA_SPEED;',
		'  float d, h = 0.0;',
		'  for (int i = 0; i < 4; i++) {',
		'    d  = seaOctave((uv + t) * freq, choppy);',
		'    d += seaOctave((uv - t) * freq, choppy);',
		'    h += d * amp * exp(-dz * freq * 0.07);',
		'    uv *= OCT; freq *= 1.9; amp *= 0.22;',
		'    choppy = mix(choppy, 1.0, 0.2);',
		'  }',
		'  return p.y - SEA_LEVEL - h;',
		'}',

		'vec3 getNormal(vec3 p, float eps){',
		'  vec3 n;',
		'  n.y = mapDetailed(p);',
		'  n.x = mapDetailed(vec3(p.x+eps, p.y, p.z)) - n.y;',
		'  n.z = mapDetailed(vec3(p.x, p.y, p.z+eps)) - n.y;',
		'  n.y = eps;',
		'  return normalize(n);',
		'}',

		// Bracketed secant search (regula falsi) with the Illinois modification, which halves the
		// retained endpoint's value when the same side is kept twice so it cannot stall on one side.
		'const int NUM_STEPS = 24;',
		'float heightMapTracing(vec3 ori, vec3 dir, out vec3 p){',
		'  float tm = 0.0;',
		// the surface never dips below y = 0, so the ray hits before crossing that plane
		'  float tx = (dir.y < -1e-4) ? min(-ori.y / dir.y, 1000.0) : 1000.0;',
		'  float hx = map(ori + dir * tx);',
		'  if (hx > 0.0) { p = ori + dir * tx; return tx; }',
		'  float hm = map(ori + dir * tm);',
		'  float tmid = 0.0, side = 0.0;',
		'  for (int i = 0; i < NUM_STEPS; i++) {',
		'    tmid = mix(tm, tx, hm / (hm - hx));',
		'    p = ori + dir * tmid;',
		'    float hmid = map(p);',
		'    if (hmid < 0.0) { tx = tmid; hx = hmid; if (side < 0.0) hm *= 0.5; side = -1.0; }',
		'    else            { tm = tmid; hm = hmid; if (side > 0.0) hx *= 0.5; side = 1.0; }',
		'  }',
		'  return tmid;',
		'}',

		'vec3 getSeaColor(vec3 p, vec3 n, vec3 l, vec3 eye, vec3 dist){',
		'  float fresnel = clamp(1.0 - dot(n, -eye), 0.0, 1.0);',
		'  fresnel = pow(fresnel, 3.0) * 0.45 + 0.06;',
		'  vec3 reflected = getSky(reflect(eye, n), l);',
		'  vec3 refracted = SEA_BASE + diffuse(n, l, 80.0) * SEA_WATER * 0.20;',
		'  vec3 color = mix(refracted, reflected, fresnel);',
		'  float atten = max(1.0 - dot(dist, dist) * 0.001, 0.0);',
		'  color += SEA_WATER * (p.y - SEA_LEVEL - SEA_HEIGHT) * 0.22 * atten;',  // light through wave crests
		// Sun glitter. Unresolved small facets act like roughness that grows with distance
		// (the LEAN-mapping idea): sharp sparkles near the camera, a broad sheen far away.
		'  float rough = clamp(max(dist.z, 0.0) / 300.0, 0.0, 1.0);',
		'  float shin = mix(140.0, 7.0, rough);',
		'  color += SUN_COL * specular(n, l, eye, shin) * mix(0.70, 0.18, rough);',
		'  return color;',
		'}',

		'void main(){',
		'  vec2 uv = gl_FragCoord.xy / u_res.xy;',
		'  uv = uv * 2.0 - 1.0;',
		'  uv.x *= u_res.x / u_res.y;',
		'  float time = u_time * 0.3;',

		'  vec3 sun = normalize(SUN_DIR_RAW);',
		'  vec3 ori = vec3(0.0, SEA_LEVEL + 3.3, time * 1.6);',
		'  float pitch = -0.055 + sin(time * 0.6) * 0.004;',
		'  float cp = cos(pitch), sp = sin(pitch);',
		'  vec3 dir = normalize(vec3(uv.x, uv.y * 0.85, -2.1));',
		'  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);',
		'  dir.z = -dir.z;', // look toward +z, where the sun is

		// beyond ~150 units the waves have faded out: intersect the mean plane analytically
		'  vec3 p;',
		'  float tPlane = (dir.y < -1e-4) ? (SEA_LEVEL - ori.y) / dir.y : 1000.0;',
		'  if (dir.y >= 0.0) { p = ori + dir * 1000.0; }',
		'  else if (tPlane > 320.0) { p = ori + dir * min(tPlane, 1000.0); }',
		'  else { heightMapTracing(ori, dir, p); }',
		'  vec3 dist = p - ori;',
		'  vec3 n = getNormal(p, dot(dist, dist) * (0.7 / u_res.x) + 0.01);',

		'  vec3 sky = getSky(dir, sun);',
		'  vec3 sea = getSeaColor(p, n, sun, dir, dist);',

		// aerial perspective: distant water picks up the horizon colour but stays a little
		// darker than the sky, so the horizon reads as a crisp line
		'  float dz = max(dist.z, 0.0);',
		'  float haze = exp(-dz * dz * 0.00002);',
		'  vec3 horizonCol = getSky(normalize(vec3(dir.x, 0.004, dir.z)), sun);',
		'  sea = mix(horizonCol * 0.86, sea, 0.3 + 0.7 * haze);',

		'  float hz = clamp(-dir.y / 0.003, 0.0, 1.0); float horizon = hz * hz * (3.0 - 2.0 * hz);',
		'  vec3 color = mix(sky, sea, horizon);',

		// subtle vignette, filmic-ish curve
		'  vec2 q = gl_FragCoord.xy / u_res.xy;',
		'  color *= 0.75 + 0.25 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.25);',
		'  color = pow(clamp(color, 0.0, 1.0), vec3(0.78));',
		'  gl_FragColor = vec4(color, 1.0);',
		'}'
	].join('\n');

	function compile(type, src) {
		var s = gl.createShader(type);
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
			console.error('[ocean] shader error:', gl.getShaderInfoLog(s));
			return null;
		}
		return s;
	}

	var vs = compile(gl.VERTEX_SHADER, VERT);
	var fs = compile(gl.FRAGMENT_SHADER, FRAG);
	if (!vs || !fs) { canvas.remove(); return; }

	var prog = gl.createProgram();
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		console.error('[ocean] link error:', gl.getProgramInfoLog(prog));
		canvas.remove(); return;
	}
	gl.useProgram(prog);

	var buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	var aPos = gl.getAttribLocation(prog, 'a_pos');
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

	var uRes = gl.getUniformLocation(prog, 'u_res');
	var uTime = gl.getUniformLocation(prog, 'u_time');
	var uCamz = gl.getUniformLocation(prog, 'u_camz');

	// Render at reduced resolution: the raymarch is per-pixel and the sea is soft anyway.
	var SCALE = Math.min(0.6, 1.0 / Math.max(1, window.devicePixelRatio || 1) * 0.8);
	function resize() {
		var w = Math.max(1, Math.floor(banner.clientWidth * SCALE));
		var h = Math.max(1, Math.floor(banner.clientHeight * SCALE));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w; canvas.height = h;
			gl.viewport(0, 0, w, h);
		}
	}

	var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var visible = true;
	var start = performance.now();
	var raf = 0;

	function frame(now) {
		raf = 0;
		resize();
		gl.uniform2f(uRes, canvas.width, canvas.height);
		var t = (now - start) / 1000 + 12.0;
		gl.uniform1f(uTime, t);
		gl.uniform1f(uCamz, t * 0.3 * 1.6);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(frame);
	}
	function kick() { if (!raf) raf = requestAnimationFrame(frame); }

	if ('IntersectionObserver' in window) {
		new IntersectionObserver(function (entries) {
			visible = entries[0].isIntersecting;
			if (visible) kick();
		}, { threshold: 0 }).observe(banner);
	}
	document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
	window.addEventListener('resize', function () { if (reduced) kick(); });

	banner.classList.add('has-ocean');
	kick();
	}
})();
