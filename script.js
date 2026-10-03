/*
 * Coloron
 * A ball bounces over a row of scrolling bars. Tap a bar to paint it
 * (red -> yellow -> purple -> red ...). Every time the ball lands, the bar
 * under it must have the same color as the ball.
 *
 * Self-contained rewrite of the original jQuery + GSAP version: same rules,
 * timings and speed-up table, drawn on a high-DPI canvas that fills the screen.
 */
(function () {
	'use strict';

	// ---------------------------------------------------------------------
	// Storage (keys prefixed with the game slug)
	// ---------------------------------------------------------------------
	var KEY_BEST = 'coloron:best';

	function load(key, fallback) {
		try {
			var v = localStorage.getItem(key);
			return v === null ? fallback : v;
		} catch (e) { return fallback; }
	}
	function save(key, value) {
		try { localStorage.setItem(key, String(value)); } catch (e) { /* storage unavailable */ }
	}

	// ---------------------------------------------------------------------
	// Constants (design units: the original game was built for 1200x800)
	// ---------------------------------------------------------------------
	var COLORS = ['#FF4571', '#FFD145', '#8260F6']; // red, yellow, purple
	var NAMES = ['red', 'yellow', 'purple'];
	var INACTIVE = '#4C4660';
	var PITCH = 180;          // distance between two bars
	var STICK_W = 90;         // bar width
	var STICK_H = 362;        // visible bar height
	var BALL = 53;            // ball diameter
	var BOUNCE = 250;         // bounce height
	var T = 1.6;              // one bounce (and one bar) at normal speed, seconds
	var SPEED = PITCH / T;    // bar scrolling speed, units per second
	var LEAD = 4;             // bounces before the first bar reaches the ball

	// ---------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------
	function rand(a, b) { return a + Math.random() * (b - a); }
	function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
	function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
	function easeInCubic(t) { return t * t * t; }
	function easeOutCubic(t) { var u = 1 - t; return 1 - u * u * u; }
	function hexToRgb(h) {
		var n = parseInt(h.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	function mix(c1, c2, t) {
		var a = hexToRgb(c1), b = hexToRgb(c2);
		return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
	}
	function roundRect(c, x, y, w, h, r) {
		r = Math.min(r, w / 2, h / 2);
		c.beginPath();
		c.moveTo(x + r, y);
		c.lineTo(x + w - r, y);
		c.arcTo(x + w, y, x + w, y + r, r);
		c.lineTo(x + w, y + h - r);
		c.arcTo(x + w, y + h, x + w - r, y + h, r);
		c.lineTo(x + r, y + h);
		c.arcTo(x, y + h, x, y + h - r, r);
		c.lineTo(x, y + r);
		c.arcTo(x, y, x + r, y, r);
		c.closePath();
	}

	// ---------------------------------------------------------------------
	// DOM
	// ---------------------------------------------------------------------
	var canvas = document.getElementById('game');
	var ctx = canvas.getContext('2d');
	var body = document.body;
	var hud = document.getElementById('hud');
	var scoreEl = document.getElementById('score');
	var hudBest = document.getElementById('hudBest');
	var pauseBtn = document.getElementById('pauseBtn');
	var learn = document.getElementById('learn');
	var startGame = document.getElementById('startGame');
	var menuBox = document.getElementById('menuBox');
	var menuBest = document.getElementById('menuBest');
	var playBtn = document.getElementById('playBtn');
	var demoBall = document.getElementById('demoBall');
	var stopGame = document.getElementById('stopGame');
	var finalScore = document.getElementById('finalScore');
	var resultEl = document.getElementById('result');
	var finalBest = document.getElementById('finalBest');
	var retryBtn = document.getElementById('retryBtn');
	var menuBtn = document.getElementById('menuBtn');
	var pauseScreen = document.getElementById('pauseScreen');
	var resumeBtn = document.getElementById('resumeBtn');

	// ---------------------------------------------------------------------
	// Layout
	// ---------------------------------------------------------------------
	var W = 1, H = 1, DPR = 1;   // CSS pixels
	var S = 1;                   // design unit -> CSS pixel
	var WD = 1200, HD = 800;     // screen size in design units
	var BX = 585;                // ball center x (design units)
	var REF = 800;               // "sea level": bottom of the visible bars
	var noisePattern = null;

	function resize() {
		W = Math.max(1, window.innerWidth);
		H = Math.max(1, window.innerHeight);
		DPR = Math.min(window.devicePixelRatio || 1, 3);
		canvas.width = Math.round(W * DPR);
		canvas.height = Math.round(H * DPR);

		// Landscape keeps the original scale (height = 800 units); portrait zooms
		// out so that a few bars ahead of the ball are always visible.
		S = W >= H ? Math.min(H / 800, W / 900) : Math.min(H / 800, W / 840);
		WD = W / S;
		HD = H / S;
		BX = clamp(WD * 0.36, 230, 585);
		REF = HD - Math.max(0, (HD - 900) * 0.5);
		body.style.setProperty('--s', S.toFixed(3));

		// menu and dialogs: fixed design size scaled to fit
		var portrait = W < H * 0.9;
		menuBox.classList.toggle('portrait', portrait);
		var mw = portrait ? 640 : 1000, mh = portrait ? 720 : 640;
		var ms = Math.min((W - 16) / mw, (H - 16) / mh, 1.25);
		menuBox.style.setProperty('--menu-scale', ms.toFixed(3));
		var bs = Math.min((W - 24) / 440, (H - 24) / 470, 1.2);
		body.style.setProperty('--box-scale', bs.toFixed(3));

		makeNoise();
		initGlows();
		if (paused || state !== STATE_PLAY) draw();
	}

	function makeNoise() {
		if (noisePattern) return;
		var n = document.createElement('canvas');
		n.width = n.height = 128;
		var c = n.getContext('2d');
		var img = c.createImageData(128, 128);
		for (var i = 0; i < img.data.length; i += 4) {
			var v = Math.random() < 0.5 ? 0 : 255;
			img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
			img.data[i + 3] = Math.floor(Math.random() * 16);
		}
		c.putImageData(img, 0, 0);
		noisePattern = ctx.createPattern(n, 'repeat');
	}

	// ---------------------------------------------------------------------
	// Scenery
	// ---------------------------------------------------------------------
	var glows = [];
	function initGlows() {
		if (glows.length) return;
		for (var i = 0; i < 20; i++) {
			glows.push({
				x: Math.random(), y: Math.random() * 0.5,
				size: Math.floor(rand(4, 12)),
				radius: rand(20, 40),
				period: 15 + Math.floor(rand(0, 8)),
				phase: rand(0, Math.PI * 2)
			});
		}
	}

	// Smooth periodic ridge used for mountains and clouds
	function ridge(x, period, parts) {
		var v = 0;
		for (var i = 0; i < parts.length; i++) {
			var p = parts[i];
			v += p[0] * Math.sin((x / period) * Math.PI * 2 * p[1] + p[2]);
		}
		return v;
	}

	var MOUNT1 = [[22, 1, 0.3], [14, 2, 1.7], [8, 5, 0.4]];
	var MOUNT2 = [[30, 1, 2.1], [12, 3, 0.2], [6, 7, 1.1]];

	function drawMountain(off, period, bottom, height, parts, color) {
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(0, bottom);
		for (var x = 0; x <= WD + 20; x += 20) {
			var y = bottom - height * 0.62 - ridge(x + off, period, parts);
			ctx.lineTo(x, y);
		}
		ctx.lineTo(WD + 20, bottom);
		ctx.closePath();
		ctx.fill();
	}

	function drawWave(off, top, color, amp, length) {
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(0, HD + 10);
		var start = -((off % length) + length) % length;
		ctx.lineTo(start - length, top);
		for (var x = start - length; x <= WD + length; x += length) {
			ctx.quadraticCurveTo(x + length / 4, top - amp, x + length / 2, top);
			ctx.quadraticCurveTo(x + length * 3 / 4, top + amp, x + length, top);
		}
		ctx.lineTo(WD + length, HD + 10);
		ctx.closePath();
		ctx.fill();
	}

	function drawClouds(off) {
		var period = 1001;
		var shift = -((off % period) + period) % period;
		ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
		for (var base = shift - period; base < WD + period; base += period) {
			var puffs = [[120, 150, 34], [165, 135, 44], [215, 150, 30], [520, 110, 26], [555, 98, 34], [595, 112, 24], [820, 175, 22], [850, 165, 28], [884, 176, 20]];
			for (var i = 0; i < puffs.length; i++) {
				ctx.beginPath();
				ctx.arc(base + puffs[i][0], puffs[i][1], puffs[i][2], 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	var sceneTime = 0; // scenery animation clock (seconds)

	function drawBackground() {
		var t = sceneTime;
		ctx.fillStyle = '#28DAD4';
		ctx.fillRect(0, 0, WD, HD);

		// glow and sun (top left)
		var g = ctx.createRadialGradient(50, 50, 0, 50, 50, 520);
		g.addColorStop(0, 'rgba(81, 237, 200, 0.45)');
		g.addColorStop(0.75, 'rgba(81, 237, 200, 0.34)');
		g.addColorStop(1, 'rgba(81, 237, 200, 0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 620, 620);

		// small glows turning slowly
		for (var i = 0; i < glows.length; i++) {
			var p = glows[i];
			var a = p.phase + (t / p.period) * Math.PI * 2;
			ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
			ctx.beginPath();
			ctx.arc(p.x * WD + Math.cos(a) * p.radius, p.y * REF + Math.sin(a) * p.radius, p.size / 2, 0, Math.PI * 2);
			ctx.fill();
		}

		drawClouds(170 + t * (1001 / 45));
		drawMountain(t * (1782 / 150), 1782, REF - 290 + 40, 150, MOUNT2, 'rgba(32, 178, 186, 0.22)');
		drawMountain(t * (1760 / 120), 1760, REF - 280 + 40, 120, MOUNT1, 'rgba(32, 170, 182, 0.26)');
		drawWave(t * (108 / 2.4), REF - 120 - 140, 'rgba(30, 165, 182, 0.18)', 7, 108);
		drawWave(t * (108 / 2.2), REF - 90 - 120, 'rgba(30, 165, 182, 0.2)', 8, 108);
		drawWave(t * (108 / 2.0), REF - 30 - 130, 'rgba(30, 160, 180, 0.22)', 8, 108);
		drawWave(t * (108 / 1.9), REF - 120, 'rgba(30, 156, 178, 0.26)', 9, 108);

		// sun
		var sun = ctx.createRadialGradient(50, 50, 0, 50, 50, 230);
		sun.addColorStop(0, 'rgba(255, 227, 69, 1)');
		sun.addColorStop(0.12, 'rgba(255, 227, 69, 0.95)');
		sun.addColorStop(0.3, 'rgba(255, 227, 69, 0.25)');
		sun.addColorStop(0.55, 'rgba(103, 244, 210, 0.28)');
		sun.addColorStop(1, 'rgba(103, 244, 210, 0)');
		ctx.fillStyle = sun;
		ctx.fillRect(0, 0, 300, 300);
	}

	function drawForeground() {
		// front wave covering the bottom of the bars, then deep water below
		drawWave(sceneTime * (108 / 1.7), REF - 22, '#22A9B8', 7, 108);
	}

	// ---------------------------------------------------------------------
	// Bar decorations (taken from the original stylesheet, 90 px wide bar)
	// ---------------------------------------------------------------------
	// bubbles: [left, top, size, ring]
	var BUBBLES = [[59, 21, 15], [16, 36, 27], [49, 63, 21], [37, 98, 15], [20, 116, 13, 1], [63, 128, 6], [52, 150, 27], [18, 154, 19], [13, 189, 10], [52, 199, 13, 1], [29, 220, 21], [48, 263, 21], [16, 275, 13, 1], [34, 296, 15]];
	// triangles: ['c', left, top, size, ringWidth] or ['t', left, top, halfWidth, height, rotationDeg, hollow]
	var TRIANGLES = [['c', 55, 22, 10, 0], ['t', 15, 27, 8, 14, 0, 1], ['t', 43, 60, 12, 19, 0, 1], ['c', 17, 61, 14, 3], ['t', 25, 101, 5, 8, 180], ['t', 60, 103, 4, 6, -90], ['t', 17, 126, 12.5, 19, 180], ['t', 50, 149, 10.5, 16, 0], ['t', 21, 177, 5.5, 8, 0], ['c', 60, 177, 10, 0], ['t', 33, 213, 9, 13, 180], ['c', 65, 233, 14, 2], ['c', 22, 250, 10, 0], ['t', 45, 270, 8, 14, 180, 1]];
	// blocks: [left, top, w, h, kind] kind: 0 filled, 1 outline, 2 circle, 3 ring
	var BLOCKS = [[30, 16, 31, 16, 1], [15, 50, 42, 14, 0], [64, 73, 9, 18, 0], [26, 84, 14, 9, 0], [45, 109, 15, 15, 2], [19, 135, 27, 9, 0], [60, 144, 12, 12, 3], [24, 164, 14, 27, 0], [64, 188, 8, 8, 0], [11, 219, 22, 12, 1], [50, 226, 22, 22, 2], [26, 248, 9, 18, 0], [50, 278, 8, 8, 2], [18, 297, 22, 12, 1]];
	var SHADE = 'rgba(0, 0, 0, 0.12)';

	function drawDecor(st, x, top, now) {
		var age = now - st.paintedAt;
		var i, s, p;
		ctx.fillStyle = SHADE;
		ctx.strokeStyle = SHADE;
		if (st.effect === 0) {
			for (i = 0; i < BUBBLES.length; i++) {
				var b = BUBBLES[i];
				s = clamp((age - i * 0.03) / 0.3, 0, 1);
				if (s <= 0) continue;
				s = 0.1 + 0.9 * easeOutQuad(s);
				p = age - 0.3 - i * 0.03;
				var dy = 0;
				if (p > 0) {
					var ph = (p % 1) / 0.5;
					var tri = ph < 1 ? ph : 2 - ph;
					dy = -60 * easeOutQuad(tri);
				}
				var r = b[2] / 2;
				ctx.beginPath();
				if (b[3]) {
					ctx.lineWidth = 4;
					ctx.arc(x + b[0] + r, top + b[1] + r + dy, (r - 2) * s, 0, Math.PI * 2);
					ctx.stroke();
				} else {
					ctx.arc(x + b[0] + r, top + b[1] + r + dy, r * s, 0, Math.PI * 2);
					ctx.fill();
				}
			}
		} else if (st.effect === 1) {
			for (i = 0; i < TRIANGLES.length; i++) {
				var tr = TRIANGLES[i];
				s = clamp((age - i * 0.03) / 0.3, 0, 1);
				if (s <= 0) continue;
				s = 0.1 + 0.9 * easeOutQuad(s);
				p = age - 0.3 - 0.42 - i * 0.1;
				var sx = 1, sy = 1;
				if (p > 0) {
					var cyc = p % 1.6;
					var ang = cyc < 1.5 ? easeOutQuad(cyc / 1.5) * Math.PI * 2 : 0;
					if (i % 2 === 0) sx = Math.cos(ang); else sy = Math.cos(ang);
				}
				var cx, cy;
				ctx.save();
				if (tr[0] === 'c') {
					var rr = tr[3] / 2;
					cx = x + tr[1] + rr; cy = top + tr[2] + rr;
					ctx.translate(cx, cy);
					ctx.scale(s * sx, s * sy);
					ctx.beginPath();
					if (tr[4]) {
						ctx.lineWidth = tr[4];
						ctx.arc(0, 0, rr - tr[4] / 2, 0, Math.PI * 2);
						ctx.stroke();
					} else {
						ctx.arc(0, 0, rr, 0, Math.PI * 2);
						ctx.fill();
					}
				} else {
					var hw = tr[3], th = tr[4];
					cx = x + tr[1] + hw; cy = top + tr[2] + th / 2;
					ctx.translate(cx, cy);
					ctx.rotate(tr[5] * Math.PI / 180);
					ctx.scale(s * sx, s * sy);
					ctx.beginPath();
					ctx.moveTo(0, -th / 2);
					ctx.lineTo(hw, th / 2);
					ctx.lineTo(-hw, th / 2);
					ctx.closePath();
					ctx.fill();
					if (tr[6]) {
						// hollow centre in the color of the bar
						ctx.fillStyle = mix(st.color, '#ffffff', 0.08);
						ctx.beginPath();
						ctx.moveTo(0, 0);
						ctx.lineTo(hw * 0.42, th * 0.36);
						ctx.lineTo(-hw * 0.42, th * 0.36);
						ctx.closePath();
						ctx.fill();
						ctx.fillStyle = SHADE;
					}
				}
				ctx.restore();
			}
		} else {
			for (i = 0; i < BLOCKS.length; i++) {
				var bl = BLOCKS[i];
				s = clamp((age - i * 0.03) / 0.3, 0, 1);
				if (s <= 0) continue;
				s = 0.1 + 0.9 * easeOutQuad(s);
				var bx = x + bl[0], by = top + bl[1], bw = bl[2], bh = bl[3];
				p = age - 0.3 - 0.42 - i * 0.1;
				var off = 0;
				var dir = i % 2 === 0 ? 1 : -1;
				if (p > 0) {
					var c2 = p % 1.6;
					off = c2 < 1 ? easeOutQuad(c2) * 2 * bw * dir : 0;
				}
				ctx.save();
				ctx.translate(bx + bw / 2, by + bh / 2);
				ctx.scale(s, s);
				ctx.beginPath();
				ctx.rect(-bw / 2, -bh / 2, bw, bh);
				ctx.clip();
				for (var k = 0; k < 2; k++) {
					var ox = off - k * 2 * bw * dir;
					if (bl[4] === 2 || bl[4] === 3) {
						ctx.beginPath();
						var cr = Math.min(bw, bh) / 2;
						if (bl[4] === 3) {
							ctx.lineWidth = 3;
							ctx.arc(ox, 0, cr - 1.5, 0, Math.PI * 2);
							ctx.stroke();
						} else {
							ctx.arc(ox, 0, cr, 0, Math.PI * 2);
							ctx.fill();
						}
					} else {
						roundRect(ctx, ox - bw / 2 + (bl[4] ? 1.5 : 0), -bh / 2 + (bl[4] ? 1.5 : 0), bw - (bl[4] ? 3 : 0), bh - (bl[4] ? 3 : 0), 6);
						if (bl[4] === 1) { ctx.lineWidth = 3; ctx.stroke(); } else ctx.fill();
					}
				}
				ctx.restore();
			}
		}
	}

	// ---------------------------------------------------------------------
	// Game state
	// ---------------------------------------------------------------------
	var STATE_MENU = 0, STATE_PLAY = 1, STATE_CRASH = 2, STATE_OVER = 3;
	var state = STATE_MENU;
	var paused = false;
	var score = 0;
	var best = parseInt(load(KEY_BEST, '0'), 10) || 0;
	var g = 0;               // game clock (seconds of game time, already sped up)
	var realTime = 0;        // seconds since the run started (real time)
	var timeScale = 1;
	var sticks = {};         // index -> { colorIndex, color, prevColor, changedAt, effect, paintedAt }
	var firstStick = 0;
	var ballColor = COLORS[0], ballPrev = COLORS[0], ballChangedAt = -10;
	var prevBallIndex = 0;
	var lastLanding = 0;
	var lastEffect = -1;
	var crashTimer = 0;
	var crashStick = -1;
	var overShownAt = 0;

	// bar k center, relative to the ball, at game time g
	function stickCenter(k) { return (LEAD + k) * PITCH - SPEED * g; }

	function getStick(k) {
		var st = sticks[k];
		if (!st) {
			st = sticks[k] = { colorIndex: -1, color: INACTIVE, prevColor: INACTIVE, changedAt: -10, effect: -1, paintedAt: 0,
				// the bars on screen at the start rise from the water one after another
				bornAt: realTime < 0.05 ? 0.1 + (k - firstStick) * 0.08 : -10 };
		}
		return st;
	}

	function speedUp(s) {
		if (s > 30) return 1.8;
		if (s > 20) return 1.7;
		if (s > 15) return 1.5;
		if (s > 12) return 1.4;
		if (s > 10) return 1.3;
		if (s > 8) return 1.2;
		if (s > 5) return 1.1;
		return 1;
	}

	function showGrade(s) {
		if (s > 30) return 'Chuck Norris?';
		if (s > 25) return "You're the man";
		if (s > 20) return 'Impressive';
		if (s > 15) return 'Great!';
		if (s > 13) return 'Nice!';
		if (s > 10) return 'Good job!';
		if (s > 5) return 'Really?';
		return 'Poor...';
	}

	function updateBestTexts() {
		hudBest.textContent = best > 0 ? 'Best ' + best : '';
		menuBest.textContent = best > 0 ? 'Best score: ' + best : '';
	}

	function setScore(v, bump) {
		score = v;
		scoreEl.textContent = score;
		if (bump) {
			scoreEl.classList.remove('bump');
			void scoreEl.offsetWidth;
			scoreEl.classList.add('bump');
		}
	}

	function start() {
		state = STATE_PLAY;
		paused = false;
		g = T / 2;          // the ball starts at the top of its bounce
		realTime = 0;
		timeScale = 1;
		sticks = {};
		firstStick = 0;
		ballColor = ballPrev = COLORS[0];
		prevBallIndex = 0;
		ballChangedAt = -10;
		lastLanding = Math.floor(g / T);
		crashStick = -1;
		setScore(0, false);
		startGame.classList.add('hidden');
		stopGame.classList.add('hidden');
		pauseScreen.classList.add('hidden');
		hud.classList.remove('hidden');
		learn.classList.remove('show');
		void learn.offsetWidth;
		learn.classList.add('show');
		last = performance.now();
	}

	function showMenu() {
		state = STATE_MENU;
		paused = false;
		sticks = {};
		stopGame.classList.add('hidden');
		pauseScreen.classList.add('hidden');
		hud.classList.add('hidden');
		learn.classList.remove('show');
		updateBestTexts();
		// restart the intro animations
		startGame.classList.add('hidden');
		void startGame.offsetWidth;
		startGame.classList.remove('hidden');
	}

	function crash(k) {
		state = STATE_CRASH;
		crashTimer = 0.7;
		crashStick = k;
		learn.classList.remove('show');
	}

	function showResult() {
		state = STATE_OVER;
		var record = score > best;
		if (record) {
			best = score;
			save(KEY_BEST, best);
		}
		updateBestTexts();
		finalScore.textContent = score + '!';
		resultEl.textContent = showGrade(score);
		finalBest.textContent = record && score > 0 ? 'New best score!' : 'Best score: ' + best;
		finalBest.classList.toggle('record', record && score > 0);
		hud.classList.add('hidden');
		stopGame.classList.remove('hidden');
		overShownAt = performance.now();
	}

	function setPaused(p) {
		if (state !== STATE_PLAY) return;
		paused = p;
		pauseScreen.classList.toggle('hidden', !p);
		learn.style.animationPlayState = p ? 'paused' : '';
		if (!p) last = performance.now();
		else draw();
	}

	// Ball landing: check the bar under the ball, then pick the next color
	function land(n) {
		var k = n - LEAD;
		if (k >= 0) {
			var st = getStick(k);
			if (st.colorIndex >= 0 && st.color === ballColor) {
				setScore(score + 1, true);
			} else {
				crash(k);
				return;
			}
		}
		timeScale = speedUp(score);
		// new color, never the same twice in a row
		var idx = prevBallIndex;
		while (idx === prevBallIndex) idx = Math.floor(Math.random() * 3);
		prevBallIndex = idx;
		ballPrev = ballColor;
		ballColor = COLORS[idx];
		ballChangedAt = realTime;
	}

	function paintStick(k) {
		var st = getStick(k);
		st.prevColor = st.color;
		st.colorIndex = (st.colorIndex + 1) % 3;
		st.color = COLORS[st.colorIndex];
		st.changedAt = realTime;
		if (st.effect < 0) {
			var e = lastEffect;
			while (e === lastEffect) e = Math.floor(Math.random() * 3);
			lastEffect = e;
			st.effect = e;
			st.paintedAt = realTime;
		}
	}

	// ---------------------------------------------------------------------
	// Loop
	// ---------------------------------------------------------------------
	var last = performance.now();

	function update(dt) {
		sceneTime += dt;
		if (state === STATE_PLAY) {
			realTime += dt;
			var prevG = g;
			g += dt * timeScale;
			var n = Math.floor(g / T);
			while (lastLanding < n && state === STATE_PLAY) {
				lastLanding++;
				land(lastLanding);
				if (state !== STATE_PLAY) {
					g = lastLanding * T; // freeze exactly at the impact
				}
			}
			if (prevG === g) return;
			// forget bars that left the screen on the left
			while (stickCenter(firstStick) < -BX - PITCH * 2) {
				delete sticks[firstStick];
				firstStick++;
			}
		} else if (state === STATE_CRASH) {
			realTime += dt;
			crashTimer -= dt;
			if (crashTimer <= 0) showResult();
		}
	}

	function ballY() {
		// returns { y: bottom of the ball, sy: vertical squash }
		var restY = REF - STICK_H;
		var ph = (g % T) / T; // 0 = landing, 0.5 = top
		if (state === STATE_CRASH) return { y: restY, sy: 0.7 };
		if (ph < 0.5) {
			var u = ph / 0.5;
			return { y: restY - BOUNCE * easeOutCubic(u), sy: 0.7 + 0.4 * easeOutCubic(u) };
		}
		var d = (ph - 0.5) / 0.5;
		return { y: restY - BOUNCE + BOUNCE * easeInCubic(d), sy: 1.1 - 0.4 * easeInCubic(d) };
	}

	function draw() {
		ctx.setTransform(DPR * S, 0, 0, DPR * S, 0, 0);
		ctx.globalAlpha = 1;
		drawBackground();

		if (state === STATE_PLAY || state === STATE_CRASH || (state === STATE_OVER && false)) {
			drawSticks();
			drawBall();
		}

		drawForeground();

		// grain like the original noise texture (in screen pixels)
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		if (noisePattern) {
			ctx.fillStyle = noisePattern;
			ctx.fillRect(0, 0, W, H);
		}
	}

	function drawSticks() {
		var top = REF - STICK_H;
		var kMin = firstStick;
		var kMax = Math.ceil((g * SPEED + (WD - BX) + STICK_W) / PITCH) - LEAD;
		for (var k = kMin; k <= kMax; k++) {
			var cx = BX + stickCenter(k);
			var x = cx - STICK_W / 2;
			if (x > WD || x + STICK_W < 0) continue;
			var st = getStick(k);
			// bars rise from the water the first time they are shown
			var rise = clamp((realTime - st.bornAt) / 0.9, 0, 1);
			var lift = rise >= 1 ? 0 : (1 - easeOutBack(rise)) * STICK_H;
			var t = clamp((realTime - st.changedAt) / 0.4, 0, 1);
			var col = t >= 1 ? st.color : mix(st.prevColor, st.color, t);
			var y = top + lift;
			var shake = 0;
			if (k === crashStick) shake = Math.sin(realTime * 60) * 4 * clamp(crashTimer / 0.7, 0, 1);
			ctx.save();
			ctx.translate(shake, 0);
			roundRect(ctx, x, y, STICK_W, HD - y + 20, 14);
			ctx.fillStyle = col;
			ctx.fill();
			if (st.effect >= 0) {
				ctx.clip();
				st.color && drawDecor(st, x, y, realTime);
			}
			ctx.restore();
			if (k === crashStick) {
				ctx.save();
				ctx.globalAlpha = 0.5 * clamp(crashTimer / 0.7, 0, 1);
				ctx.fillStyle = '#ffffff';
				roundRect(ctx, x + shake, y, STICK_W, HD - y + 20, 14);
				ctx.fill();
				ctx.restore();
			}
		}
	}

	function easeOutBack(t) {
		var c1 = 1.4, c3 = c1 + 1;
		return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
	}

	function drawBall() {
		var b = ballY();
		var appear = clamp(realTime / 0.6, 0, 1);
		var sc = appear >= 1 ? 1 : easeOutBack(appear);
		var t = clamp((realTime - ballChangedAt) / 0.5, 0, 1);
		var col = t >= 1 ? ballColor : mix(ballPrev, ballColor, t);
		var r = BALL / 2;
		ctx.save();
		ctx.translate(BX, b.y);
		ctx.scale(sc, sc * b.sy);
		// shadow-free flat ball with a soft shine, like the original sprite
		ctx.fillStyle = col;
		ctx.beginPath();
		ctx.arc(0, -r, r, 0, Math.PI * 2);
		ctx.fill();
		var shade = ctx.createRadialGradient(-r * 0.35, -r * 1.35, r * 0.2, 0, -r, r);
		shade.addColorStop(0, 'rgba(255,255,255,0.28)');
		shade.addColorStop(0.55, 'rgba(255,255,255,0)');
		shade.addColorStop(1, 'rgba(0,0,0,0.16)');
		ctx.fillStyle = shade;
		ctx.fill();
		ctx.restore();
	}

	function frame(now) {
		requestAnimationFrame(frame);
		var dt = Math.min((now - last) / 1000, 1 / 20);
		last = now;
		if (paused) return;
		update(dt);
		draw();
	}

	// ---------------------------------------------------------------------
	// Input
	// ---------------------------------------------------------------------
	canvas.addEventListener('pointerdown', function (e) {
		e.preventDefault();
		if (state !== STATE_PLAY || paused) return;
		var xd = e.clientX / S - BX;
		// every bar owns its whole column (bar + half the gap on each side)
		var k = Math.round((xd + SPEED * g) / PITCH) - LEAD;
		if (k < firstStick) return;
		if (Math.abs(stickCenter(k) - xd) > PITCH / 2) return;
		paintStick(k);
	});

	function bindButton(el, fn) {
		el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
		el.addEventListener('click', function (e) { e.preventDefault(); fn(); el.blur(); });
	}

	bindButton(playBtn, start);
	bindButton(retryBtn, function () { if (performance.now() - overShownAt > 300) start(); });
	bindButton(menuBtn, showMenu);
	bindButton(resumeBtn, function () { setPaused(false); });
	bindButton(pauseBtn, function () { setPaused(!paused); });

	// demo bars of the "how to play" panel
	Array.prototype.forEach.call(document.querySelectorAll('.section-2 .bar'), function (bar) {
		bar.addEventListener('pointerdown', function (e) {
			e.preventDefault();
			var i = (parseInt(bar.getAttribute('data-index'), 10) + 1) % 3;
			bar.setAttribute('data-index', i);
			bar.classList.remove('red', 'yellow', 'purple');
			bar.classList.add(NAMES[i]);
		});
	});

	// demo ball changes color at every bounce
	var demoIndex = 0;
	demoBall.addEventListener('animationiteration', function () {
		var i = demoIndex;
		while (i === demoIndex) i = Math.floor(Math.random() * 3);
		demoIndex = i;
		demoBall.classList.remove('red', 'yellow', 'purple');
		demoBall.classList.add(NAMES[i]);
	});

	window.addEventListener('keydown', function (e) {
		var k = e.key;
		if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
			if (e.target && e.target.tagName === 'BUTTON') return; // let the focused button handle it
			e.preventDefault();
			if (e.repeat) return;
			if (state === STATE_MENU) start();
			else if (state === STATE_OVER && performance.now() - overShownAt > 500) start();
			else if (state === STATE_PLAY && paused) setPaused(false);
		} else if (k === 'p' || k === 'P' || k === 'Escape') {
			if (state === STATE_PLAY) setPaused(!paused);
		}
	});

	document.addEventListener('visibilitychange', function () {
		if (document.hidden) setPaused(true);
	});
	window.addEventListener('blur', function () { setPaused(true); });
	document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
	window.addEventListener('resize', resize);
	window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });

	// ---------------------------------------------------------------------
	// Boot
	// ---------------------------------------------------------------------
	resize();
	updateBestTexts();
	requestAnimationFrame(frame);

	// Small read-only hook used for automated testing (no effect on the game)
	window.__coloron = {
		get state() { return ['menu', 'play', 'crash', 'over'][state]; },
		get score() { return score; },
		get ballColor() { return ballColor; },
		// next bar the ball will land on and the time (game seconds) until then
		get next() {
			var n = Math.floor(g / T) + 1;
			return { k: n - LEAD, inGame: n * T - g, color: sticks[n - LEAD] ? sticks[n - LEAD].color : null };
		},
		stickScreenX: function (k) { return (BX + stickCenter(k)) * S; },
		get layout() { return { S: S, BX: BX, REF: REF, W: W, H: H }; }
	};
})();
