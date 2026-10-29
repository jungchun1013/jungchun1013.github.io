/*
 * glass.js — physically-motivated "liquid glass" refraction for .glass-container cards.
 * The flat face of the slab refracts nothing (a parallel-sided plate shifts rays but does
 * not bend them), so the centre stays undistorted. Only the rounded rim, where the surface
 * normal tilts, bends the backdrop. We bake that into a displacement map that follows the
 * card's rounded-rect outline and feed it to an SVG feDisplacementMap via backdrop-filter.
 */
(function () {
	var RIM_FRACTION = 0.06;   // rim width as a fraction of the shorter side
	var RIM_MIN = 8, RIM_MAX = 16; // px
	var STRENGTH = 22;         // max displacement at the very edge, px
	var BLUR = 1.0;            // px backdrop blur: scattering inside the slab
	var FACE = 'saturate(1.3) brightness(1.04)'; // absorption/scattering look of the flat face

	var svgNS = 'http://www.w3.org/2000/svg';
	var svg = document.createElementNS(svgNS, 'svg');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
	var defs = document.createElementNS(svgNS, 'defs');
	svg.appendChild(defs);
	document.body.appendChild(svg);

	var uid = 0;

	// Lens profile across the rim: 0 at the inner boundary (zero slope, so the face joins the
	// rim without a crease) rising to 1 at the outer edge, following a circular section.
	function profile(depth, rim) {
		if (depth <= 0 || depth >= rim) return 0;
		var t = 1 - depth / rim;
		return 1 - Math.sqrt(1 - t * t);
	}

	function makeMap(W, H, r, rim) {
		var c = document.createElement('canvas');
		c.width = W; c.height = H;
		var ctx = c.getContext('2d');
		var img = ctx.createImageData(W, H);
		var d = img.data;
		var cx = W / 2, cy = H / 2, hx = W / 2 - r, hy = H / 2 - r;
		for (var y = 0; y < H; y++) {
			for (var x = 0; x < W; x++) {
				var px = x + 0.5 - cx, py = y + 0.5 - cy;
				var ax = Math.abs(px), ay = Math.abs(py);
				var qx = ax - hx, qy = ay - hy;
				var dx = 0, dy = 0;
				if (qx > 0 && qy > 0) {
					// corner: displacement along the arc normal, depth measured from the arc.
					var l = Math.sqrt(qx * qx + qy * qy) || 1;
					var mag = profile(r - l, rim);
					dx = qx / l * mag; dy = qy / l * mag;
				} else {
					// straight edges: one profile per axis. Because rim <= r, the per-axis
					// profiles are exactly zero where the corner region begins, so the two
					// formulations agree on their shared boundary and nothing creases.
					dx = profile(W / 2 - ax, rim);
					dy = profile(H / 2 - ay, rim);
				}
				if (px < 0) dx = -dx;
				if (py < 0) dy = -dy;
				var i = (y * W + x) * 4;
				d[i] = 128 + dx * 127;
				d[i + 1] = 128 + dy * 127;
				d[i + 2] = 128;
				d[i + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		return c.toDataURL('image/png');
	}

	function setup(container) {
		var layer = container.querySelector('.glass-filter');
		if (!layer) return;
		var id = 'lg-dist-' + (++uid);

		var filter = document.createElementNS(svgNS, 'filter');
		filter.setAttribute('id', id);
		filter.setAttribute('filterUnits', 'userSpaceOnUse');
		filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
		filter.setAttribute('color-interpolation-filters', 'sRGB');

		var feImage = document.createElementNS(svgNS, 'feImage');
		feImage.setAttribute('result', 'map');
		feImage.setAttribute('preserveAspectRatio', 'none');

		var feDisp = document.createElementNS(svgNS, 'feDisplacementMap');
		feDisp.setAttribute('in', 'SourceGraphic');
		feDisp.setAttribute('in2', 'map');
		feDisp.setAttribute('xChannelSelector', 'R');
		feDisp.setAttribute('yChannelSelector', 'G');
		// feDisplacementMap offsets by (C - 0.5) * scale. Negative: the rim samples inward, so the
		// edge magnifies the content just inside it (as a thick convex rim does) and never reads
		// outside the element's box, which would show through as a transparent notch.
		feDisp.setAttribute('scale', String(-STRENGTH * 2));

		filter.appendChild(feImage);
		filter.appendChild(feDisp);
		defs.appendChild(filter);

		var lastKey = '';
		function update() {
			var W = Math.round(container.clientWidth), H = Math.round(container.clientHeight);
			if (W < 4 || H < 4) return;
			var r = parseFloat(getComputedStyle(container).borderTopLeftRadius) || 0;
			r = Math.min(r, W / 2, H / 2);
			var rim = Math.max(RIM_MIN, Math.min(RIM_MAX, Math.min(W, H) * RIM_FRACTION));
			rim = Math.min(rim, r); // the rim never reaches past the corner radius (see makeMap)
			var key = W + 'x' + H + 'r' + r;
			if (key === lastKey) return;
			lastKey = key;

			['x', 'y'].forEach(function (a) { filter.setAttribute(a, '0'); feImage.setAttribute(a, '0'); });
			filter.setAttribute('width', String(W)); filter.setAttribute('height', String(H));
			feImage.setAttribute('width', String(W)); feImage.setAttribute('height', String(H));
			feImage.setAttribute('href', makeMap(W, H, r, rim));
			feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', feImage.getAttribute('href'));

			// Chrome hides sibling content when backdrop-filter references an SVG filter, so the
			// backdrop is blurred by backdrop-filter and the rim refraction is applied with `filter`
			// on top of that composited layer.
			layer.style.webkitBackdropFilter = 'blur(' + BLUR + 'px) ' + FACE;
			layer.style.backdropFilter = 'blur(' + BLUR + 'px) ' + FACE;
			layer.style.filter = 'url(#' + id + ')';
		}
		update();
		if ('ResizeObserver' in window) new ResizeObserver(update).observe(container);
		else window.addEventListener('resize', update);
	}

	Array.prototype.forEach.call(document.querySelectorAll('.glass-container'), setup);
})();
