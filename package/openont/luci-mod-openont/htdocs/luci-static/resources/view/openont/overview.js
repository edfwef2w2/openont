'use strict';
'require view';
'require rpc';
'require poll';

var callOverview = rpc.declare({
	object: 'openont',
	method: 'overview',
	expect: { '': {} }
});

var callHistory = rpc.declare({
	object: 'openont',
	method: 'history',
	params: [ 'window' ],
	expect: { '': {} }
});

var APP_KEYS = [
	'http', 'video', 'game', 'download', 'file',
	'im', 'common', 'other_app', 'speedtest', 'unknown'
];

var APP_COLORS = {
	http: '#0088cc',
	video: '#e74c3c',
	game: '#9b59b6',
	download: '#27ae60',
	file: '#16a085',
	im: '#3498db',
	common: '#95a5a6',
	other_app: '#f39c12',
	speedtest: '#e67e22',
	unknown: '#7f8c8d'
};

function appLabel(key) {
	var map = {
		http: _('HTTP'),
		video: _('Streaming video'),
		game: _('Online games'),
		download: _('Downloads'),
		file: _('File transfer'),
		im: _('Messaging'),
		common: _('Common protocols'),
		other_app: _('Other apps'),
		speedtest: _('Speed test'),
		unknown: _('Unknown apps')
	};
	return map[key] || key;
}

function fmtRate(bps) {
	if (bps == null || isNaN(bps)) return '0 B/s';
	var u = [ 'B/s', 'KB/s', 'MB/s', 'GB/s' ];
	var i = 0, v = Number(bps);
	while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
	return (v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(2)) + ' ' + u[i];
}

function fmtBytes(n) {
	if (n == null || isNaN(n) || n <= 0) return '0 B';
	var u = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
	var i = 0, v = Number(n);
	while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
	return (v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(2)) + ' ' + u[i];
}

function rateParts(bps) {
	if (bps == null || isNaN(bps)) return { v: '0', u: 'B/s' };
	var u = [ 'B/s', 'KB/s', 'MB/s', 'GB/s' ];
	var i = 0, v = Number(bps);
	while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
	return { v: (v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(2)), u: u[i] };
}

function fmtUptime(sec) {
	sec = parseInt(sec, 10) || 0;
	var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
	if (d > 0)
		return _('%d day(s) %d hour(s) %d min').format(d, h, m);
	return _('%d hour(s) %d min').format(h, m);
}

function fmtClock(ts) {
	var d = new Date((ts || 0) * 1000);
	if (isNaN(d.getTime())) return '--:--:--';
	function z(n) { return n < 10 ? '0' + n : String(n); }
	return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
}

/* Theme CSS variables (fallbacks keep charts readable without theme) */
function themeColor(name, fallback) {
	try {
		var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return v || fallback;
	} catch (e) {
		return fallback;
	}
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

/**
 * Match canvas bitmap to CSS box size and devicePixelRatio.
 * Drawing uses CSS pixels after setTransform — avoids blurry upscale.
 */
function fitCanvas(canvas) {
	if (!canvas) return null;
	var dpr = window.devicePixelRatio || 1;
	var rect = canvas.getBoundingClientRect();
	var cssW = Math.max(1, Math.round(rect.width));
	var cssH = Math.max(1, Math.round(rect.height));
	/* Fallback when not yet laid out (parent still 0×0) */
	if (cssW <= 1 && canvas.clientWidth)
		cssW = canvas.clientWidth;
	if (cssH <= 1 && canvas.clientHeight)
		cssH = canvas.clientHeight;
	if (cssW <= 1)
		cssW = parseInt(canvas.getAttribute('width'), 10) || 320;
	if (cssH <= 1)
		cssH = parseInt(canvas.getAttribute('height'), 10) || 200;

	var bw = Math.max(1, Math.round(cssW * dpr));
	var bh = Math.max(1, Math.round(cssH * dpr));
	if (canvas.width !== bw || canvas.height !== bh) {
		canvas.width = bw;
		canvas.height = bh;
	}
	var ctx = canvas.getContext('2d');
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, cssW, cssH);
	return { ctx: ctx, w: cssW, h: cssH, dpr: dpr };
}

/**
 * Rate chart paddings. Left pad is driven by measured Y-axis label widths
 * so values like "12.45 MB/s" never clip past the canvas edge.
 * Optional ctx + tickLabels: when provided, padL = max(measureText) + gap.
 */
function ratePads(w, ctx, tickLabels) {
	var padR = 12, padT = 16, padB = 22;
	var padL;
	var gap = 8;
	var minL = 44;
	var maxL = Math.min(100, Math.max(minL, Math.round(w * 0.32)));

	if (ctx && tickLabels && tickLabels.length) {
		ctx.save();
		ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
		var maxW = 0;
		for (var i = 0; i < tickLabels.length; i++) {
			var mw = ctx.measureText(String(tickLabels[i])).width;
			if (mw > maxW) maxW = mw;
		}
		ctx.restore();
		padL = Math.ceil(maxW) + gap;
	} else {
		padL = clamp(Math.round(w * 0.12), minL, 72);
	}
	padL = clamp(padL, minL, maxL);
	/* Keep a usable plot area on very narrow charts */
	if (padL + padR + 40 > w)
		padL = Math.max(minL, w - padR - 40);
	return { L: padL, R: padR, T: padT, B: padB };
}

/** Build 4 Y-axis tick labels for maxV (same as _drawLine grid). */
function rateAxisTicks(maxV) {
	var labels = [];
	for (var g = 0; g < 4; g++)
		labels.push(fmtRate(maxV * (1 - g / 3)));
	return labels;
}

function directChartBoxes(card) {
	var out = [];
	if (!card) return out;
	for (var i = 0; i < card.children.length; i++) {
		var el = card.children[i];
		if (el.classList && el.classList.contains('o-chart-box'))
			out.push(el);
	}
	return out;
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return Promise.all([
			callOverview(),
			callHistory(30)
		]);
	},

	render: function (data) {
		var ov = data[0] || {};
		var hist = data[1] || {};
		var self = this;
		this._rateWindow = [];
		this._pieWindow = 30;
		this._hoverIdx = -1;
		this._pieSlices = [];
		this._lastApps = (hist && hist.apps) || {};

		var root = E('div', { class: 'o-overview' });
		this._overviewRoot = root;

		/*
		 * Scheme B: one flex bin (.o-row.o-dash). Each tile has data-span;
		 * CSS wraps when cumulative span exceeds 1.0 (or full-width in narrow).
		 *   0.5+0.5 → connection + rate
		 *   1       → physical connections
		 *   1       → interface status
		 *   0.3+0.7 → app traffic + upload/download (fixed 3:7)
		 */
		var dash = E('div', { class: 'o-row o-dash' });

		var profileCls = 'o-card o-profile' + (ov.wan_connected ? '' : ' offline');
		var stateText = ov.wan_connected ? _('Connected') : _('Disconnected');
		dash.appendChild(E('div', { class: 'o-col', 'data-span': '0.5' }, [
			E('div', { class: profileCls, id: 'o-profile' }, [
				E('p', { class: 'name' }, [ ov.hostname || 'OpenONT' ]),
				E('p', { class: 'state' }, [
					E('span', { id: 'o-wan-state' }, [ stateText ]), ' ',
					E('small', {}, [ _('WAN') ])
				]),
				E('p', { class: 'uptime', id: 'o-uptime' }, [
					_('Uptime') + ': ' + fmtUptime(ov.uptime_sec)
				])
			])
		]));

		var tx = rateParts(ov.tx_bps);
		var rx = rateParts(ov.rx_bps);
		dash.appendChild(E('div', { class: 'o-col', 'data-span': '0.5' }, [
			E('div', { class: 'o-card' }, [
				E('div', { class: 'o-card-title', 'data-icon': 'rate' }, [ _('Rate status') ]),
				E('div', { class: 'o-rate-line up' }, [
					E('span', { class: 'val', id: 'o-tx-val' }, [ tx.v ]),
					E('span', { class: 'unit', id: 'o-tx-unit' }, [ tx.u ]),
					E('span', { style: 'margin-left:8px;color:#888;font-size:12px' }, [ _('Upload') ])
				]),
				E('div', { class: 'o-rate-line down' }, [
					E('span', { class: 'val', id: 'o-rx-val' }, [ rx.v ]),
					E('span', { class: 'unit', id: 'o-rx-unit' }, [ rx.u ]),
					E('span', { style: 'margin-left:8px;color:#888;font-size:12px' }, [ _('Download') ])
				])
			])
		]));

		dash.appendChild(E('div', { class: 'o-col', 'data-span': '1' }, [
			E('div', { class: 'o-card' }, [
				E('div', { class: 'o-card-title', 'data-icon': 'hosts' }, [ _('Physical connections') ]),
				E('div', { class: 'o-stat-grid' }, [
					E('div', {}, [
						E('div', { class: 'num', id: 'o-hosts' }, [ String(ov.hosts || 0) ]),
						E('div', { class: 'lbl' }, [ _('Hosts') ])
					]),
					E('div', {}, [
						E('div', { class: 'num', id: 'o-conns' }, [ String(ov.connections || 0) ]),
						E('div', { class: 'lbl' }, [ _('Connections') ])
					]),
					E('div', {}, [
						E('div', { class: 'num', id: 'o-wired' }, [ String(ov.wired || 0) ]),
						E('div', { class: 'lbl' }, [ _('Wired') ])
					])
				])
			])
		]));

		var ifCard = E('div', { class: 'o-card' }, [
			E('div', { class: 'o-card-title', 'data-icon': 'iface' }, [ _('Interface status') ]),
			E('div', { class: 'o-if-summary' }, [
				E('div', { class: 'item' }, [
					E('div', { class: 'num', id: 'o-wan-n' }, [ String(ov.wan_enabled || 0) ]),
					E('div', { class: 'lbl' }, [ _('WAN enabled') ])
				]),
				E('div', { class: 'item' }, [
					E('div', { class: 'num', id: 'o-lan-n' }, [ String(ov.lan_enabled || 0) ]),
					E('div', { class: 'lbl' }, [ _('LAN enabled') ])
				]),
				E('div', { class: 'item' }, [
					E('div', { class: 'num', id: 'o-dhcp-rem' }, [ String(ov.dhcp_remaining || 0) ]),
					E('div', { class: 'lbl' }, [ _('DHCP pool free') ])
				])
			]),
			E('ul', { class: 'o-if-list', id: 'o-if-list' })
		]);
		dash.appendChild(E('div', { class: 'o-col', 'data-span': '1' }, [ ifCard ]));

		var pieSelect = E('select', { class: 'o-select', id: 'o-pie-window' }, [
			E('option', { value: '30', selected: 'selected' }, [ _('Last 30 minutes') ]),
			E('option', { value: '60' }, [ _('Last 1 hour') ]),
			E('option', { value: '1440' }, [ _('Last 1 day') ])
		]);
		pieSelect.addEventListener('change', function () {
			self._pieWindow = parseInt(pieSelect.value, 10) || 30;
			self._refreshHistory();
		});

		var pieBox = E('div', { class: 'o-chart-box', id: 'o-pie-box' }, [
			E('canvas', { id: 'o-pie-canvas', width: 320, height: 260 }),
			E('div', { id: 'o-pie-tip', class: 'o-chart-tip' })
		]);

		var pieCard = E('div', { class: 'o-card' }, [
			E('div', { class: 'o-card-title', 'data-icon': 'pie' }, [
				E('span', { id: 'o-pie-title' }, [ _('App traffic (last 30 minutes)') ]),
				pieSelect
			]),
			pieBox
		]);

		var upWrap = E('div', { class: 'o-chart-box sm' }, [
			E('canvas', { id: 'o-rate-up-canvas', width: 640, height: 140 }),
			E('div', { id: 'o-rate-tip-up', class: 'o-chart-tip' })
		]);
		var downWrap = E('div', { class: 'o-chart-box sm' }, [
			E('canvas', { id: 'o-rate-down-canvas', width: 640, height: 120 }),
			E('div', { id: 'o-rate-tip-down', class: 'o-chart-tip' })
		]);

		var rateCard = E('div', { class: 'o-card' }, [
			E('div', { class: 'o-card-title', 'data-icon': 'chart' }, [
				E('span', {}, [ _('Upload / download rate (last 5 minutes)') ])
			]),
			upWrap,
			downWrap
		]);

		/*
		 * Chart strip: always one full-width dash cell so pie + rate stay on the
		 * same row (fixed 3:7 via .o-charts-pair). Wide-mode pack capacity must
		 * not split 0.3/0.7 onto separate lines.
		 */
		dash.appendChild(E('div', { class: 'o-col o-charts-strip', 'data-span': '1' }, [
			E('div', { class: 'o-charts-pair' }, [
				E('div', { class: 'o-charts-tile o-charts-pie' }, [ pieCard ]),
				E('div', { class: 'o-charts-tile o-charts-rate' }, [ rateCard ])
			])
		]));

		root.appendChild(dash);
		this._renderIfaces(ov.interfaces || []);

		/* seed from history — final crisp paint after layout (see _scheduleChartPaint) */
		this._applyHistory(hist);
		this._setPieTitle(hist);

		this._bindPieHover();
		this._bindRateHover();
		this._bindChartResize();
		this._scheduleChartPaint();

		/* Re-layout when theme shell toggles narrow/normal/wide (shared thirds rule) */
		document.addEventListener('openont-layout-mode', function () {
			self._scheduleChartPaint();
		});

		poll.add(L.bind(function () {
			return callOverview().then(function (o) {
				self._updateOverview(o || {});
			});
		}, this), 5);

		poll.add(L.bind(function () {
			return self._refreshHistory();
		}, this), 15);

		return root;
	},

	_scheduleChartPaint: function () {
		var self = this;
		/* Double rAF: wait until LuCI inserts the view and flex row has widths */
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				self._paintCharts();
			});
		});
	},

	/**
	 * Detect layout mode from browser window vs physical screen, then size unit U.
	 *
	 * Mode (window.innerWidth / screen width):
	 *   wide2x : ratio > 2/3   → packCapacity=2 (row can hold 3 cards: 0.5+0.5+1)
	 *   normal : ratio > 1/3   → packCapacity=1 (row holds 0.5+0.5, then full rows)
	 *   narrow : ratio ≤ 1/3   → 1 card / row (ignore data-span)
	 */
	_updateDashUnit: function () {
		var root = this._overviewRoot || document.querySelector('.o-overview');
		if (!root) return null;

		var BASE = 1100;
		var screenW = 1920;
		try {
			if (window.screen) {
				screenW = window.screen.availWidth || window.screen.width || screenW;
			}
		} catch (e) { /* ignore */ }
		if (!screenW || screenW < 1)
			screenW = 1920;

		var winW = window.innerWidth || document.documentElement.clientWidth || screenW;
		if (winW < 1)
			winW = screenW;
		var ratio = winW / screenW;

		/*
		 * Prefer shell mode from theme (header FOUC / script.js applyLayoutShell)
		 * so sidebar top-bar and dashboard narrow stay on the same threshold.
		 * Fallback: same thirds rule — >2/3 wide2x · >1/3 normal · ≤1/3 narrow.
		 */
		var mode = document.documentElement.getAttribute('data-layout-mode');
		if (mode !== 'narrow' && mode !== 'normal' && mode !== 'wide2x') {
			if (typeof window.openontDetectLayoutMode === 'function')
				mode = window.openontDetectLayoutMode();
			else if (ratio > 2 / 3)
				mode = 'wide2x';
			else if (ratio > 1 / 3)
				mode = 'normal';
			else
				mode = 'narrow';
		}

		/* Content shell width drives actual max-width pixel budget */
		var avail = 0;
		var main = document.getElementById('maincontent');
		if (main && main.clientWidth > 0)
			avail = main.clientWidth;
		else if (root.parentElement && root.parentElement.clientWidth > 0)
			avail = root.parentElement.clientWidth;
		else
			avail = winW;

		if (main) {
			try {
				var mcs = getComputedStyle(main);
				var pl = parseFloat(mcs.paddingLeft) || 0;
				var pr = parseFloat(mcs.paddingRight) || 0;
				if (pl + pr > 0 && avail > pl + pr)
					avail = avail - pl - pr;
			} catch (e2) { /* ignore */ }
		}
		if (avail < 1)
			avail = winW;

		var U;
		if (mode === 'narrow')
			U = Math.max(1, avail);
		else if (mode === 'wide2x')
			U = Math.min(avail, BASE * 2);
		else
			U = Math.min(avail, BASE);

		/* packCapacity: max sum of data-span on one visual row (wide allows 3 cards) */
		var packCapacity = mode === 'wide2x' ? 2 : 1;

		root.style.maxWidth = U + 'px';
		root.style.setProperty('--o-dash-unit', U + 'px');
		root.style.setProperty('--o-pack-capacity', String(packCapacity));
		root.classList.toggle('is-narrow', mode === 'narrow');
		root.classList.toggle('is-wide2x', mode === 'wide2x');
		root.setAttribute('data-dash-mode', mode);
		root.setAttribute('data-pack-capacity', String(packCapacity));
		root.setAttribute('data-win-ratio', (Math.round(ratio * 1000) / 1000).toFixed(3));

		this._applySpanLayout(root, mode, packCapacity);

		return {
			U: U,
			avail: avail,
			mode: mode,
			packCapacity: packCapacity,
			winW: winW,
			screenW: screenW,
			ratio: ratio
		};
	},

	/**
	 * Apply per-column flex widths from data-span + pack capacity.
	 * Unit tiles (0.5 / 1): width% = (span / packCapacity) * 100
	 *   capacity 1 → 0.5=50%, 1=100%
	 *   capacity 2 → 0.5=25%, 1=50%  (0.5+0.5+1 → 3 cards / row)
	 * Chart strip is data-span=1 (full row); inner .o-charts-pair keeps 3:7.
	 */
	_applySpanLayout: function (root, mode, packCapacity) {
		if (!root) return;
		var cols = root.querySelectorAll('.o-dash > .o-col[data-span]');
		var i, col, span, pct, grow, isStrip;

		if (mode === 'narrow') {
			for (i = 0; i < cols.length; i++) {
				cols[i].style.flex = '0 0 100%';
				cols[i].style.width = '100%';
				cols[i].style.maxWidth = '100%';
				cols[i].style.minWidth = '0';
			}
			return;
		}

		var cap = packCapacity > 0 ? packCapacity : 1;
		for (i = 0; i < cols.length; i++) {
			col = cols[i];
			span = parseFloat(col.getAttribute('data-span'));
			if (!(span > 0))
				span = 1;
			/* Chart strip always occupies a full dash row (100%), never half in wide */
			isStrip = col.classList.contains('o-charts-strip');
			if (isStrip) {
				pct = 100;
				grow = 0;
			} else {
				pct = (span / cap) * 100;
				grow = span >= 1 ? 1 : 0;
			}
			col.style.flex = (grow ? '1' : '0') + ' 0 ' + pct + '%';
			col.style.width = pct + '%';
			col.style.maxWidth = grow ? '100%' : (pct + '%');
			col.style.minWidth = '0';
		}
	},

	_paintCharts: function () {
		this._paintingCharts = true;
		try {
			this._updateDashUnit();
			this._layoutChartBoxes();
			this._drawPie(this._lastApps || {});
			this._drawRateCharts();
		} finally {
			this._paintingCharts = false;
		}
	},

	/**
	 * Size every .o-chart-box from measured column width so pie + dual rate
	 * share one visual body height when they sit in the same .o-row.
	 * No layout branching on breakpoints — only arithmetic on real pixels.
	 */
	_layoutChartBoxes: function () {
		var root = this._overviewRoot || document.querySelector('.o-overview');
		if (!root) return;

		var MIN_PIE = 200, MAX_PIE = 340;
		var MIN_SM = 100, MAX_SM = 180;
		var GAP = 8;

		function setH(el, px) {
			var next = px + 'px';
			if (el.style.height !== next)
				el.style.height = next;
		}

		/* Prefer chart pair strip: equalize pie + dual-rate in one pass */
		var pair = root.querySelector('.o-charts-pair');
		var groups = [];
		var cards;

		if (pair) {
			cards = pair.querySelectorAll('.o-card');
		} else {
			cards = root.querySelectorAll('.o-dash .o-card');
		}

		for (var c = 0; c < cards.length; c++) {
			var card = cards[c];
			var boxes = directChartBoxes(card);
			if (!boxes.length) continue;
			var cs = getComputedStyle(card);
			var pl = parseFloat(cs.paddingLeft) || 0;
			var pr = parseFloat(cs.paddingRight) || 0;
			var contentW = Math.max(1, card.clientWidth - pl - pr);
			if (boxes[0].clientWidth > 1)
				contentW = boxes[0].clientWidth;
			groups.push({ boxes: boxes, n: boxes.length, contentW: contentW });
		}

		if (!groups.length) return;

		/*
		 * Target body height:
		 *   single box (pie):  clamp(w * 0.90)
		 *   dual .sm (rates):  2 * clamp(w * 0.24) + gap
		 * Take the max so pie + rate cards match when side-by-side.
		 */
		var targetBody = 0;
		for (var g = 0; g < groups.length; g++) {
			var item = groups[g];
			var body;
			if (item.n === 1) {
				body = clamp(Math.round(item.contentW * 0.90), MIN_PIE, MAX_PIE);
			} else {
				var each = clamp(Math.round(item.contentW * 0.24), MIN_SM, MAX_SM);
				body = each * item.n + GAP * (item.n - 1);
			}
			if (body > targetBody) targetBody = body;
		}

		for (var g2 = 0; g2 < groups.length; g2++) {
			var grp = groups[g2];
			if (grp.n === 1) {
				setH(grp.boxes[0], targetBody);
			} else {
				var hEach = Math.max(
					MIN_SM,
					Math.floor((targetBody - GAP * (grp.n - 1)) / grp.n)
				);
				for (var b = 0; b < grp.n; b++)
					setH(grp.boxes[b], hEach);
			}
		}
	},

	_bindChartResize: function () {
		var self = this;

		function schedule() {
			if (self._paintingCharts) return;
			if (self._resizeTimer)
				clearTimeout(self._resizeTimer);
			self._resizeTimer = setTimeout(function () {
				self._paintCharts();
			}, 80);
		}

		if (this._onChartResize)
			window.removeEventListener('resize', this._onChartResize);
		this._onChartResize = schedule;
		window.addEventListener('resize', this._onChartResize);

		/* Observe after DOM insert (first paint rAF); root may not be mounted yet */
		requestAnimationFrame(function () {
			var root = self._overviewRoot || document.querySelector('.o-overview');
			if (typeof ResizeObserver === 'undefined' || !root) return;
			if (self._chartRO)
				self._chartRO.disconnect();
			self._chartRO = new ResizeObserver(schedule);
			self._chartRO.observe(root);
		});
	},

	_renderIfaces: function (list) {
		var ul = document.getElementById('o-if-list');
		if (!ul) return;
		ul.innerHTML = '';
		if (!list.length) {
			ul.appendChild(E('li', {}, [
				E('div', { class: 'name' }, [ _('No binding') ]),
				E('div', { class: 'meta' }, [ _('Bind interfaces under Network → Port Binding') ])
			]));
			return;
		}
		list.forEach(function (ifc) {
			var up = ifc.up || ifc.link === 'up';
			var li = E('li', { class: up ? 'up' : 'down' }, [
				E('div', { class: 'name' }, [ ifc.name || '?' ]),
				E('div', { class: 'meta' }, [
					(ifc.ports || ifc.device || '') + ' · ' + (up ? _('Connected') : _('Disconnected'))
				]),
				E('div', { class: 'o-popover' }, [
					E('dl', {}, [ E('dt', {}, [ _('Role') ]), E('dd', {}, [ ifc.name || '' ]) ]),
					E('dl', {}, [ E('dt', {}, [ _('Device') ]), E('dd', {}, [ ifc.device || '—' ]) ]),
					E('dl', {}, [ E('dt', {}, [ _('Bound eth') ]), E('dd', {}, [ ifc.ports || ifc.device || '—' ]) ]),
					E('dl', {}, [ E('dt', {}, [ _('Link') ]), E('dd', {}, [
						E('span', { class: up ? 'colorG' : 'colorR' }, [ up ? _('Connected') : _('Disconnected') ])
					]) ]),
					E('dl', {}, [ E('dt', {}, [ _('Protocol') ]), E('dd', {}, [ ifc.proto || '—' ]) ]),
					E('dl', {}, [ E('dt', {}, [ 'IP' ]), E('dd', {}, [ ifc.ip || '—' ]) ])
				])
			]);
			ul.appendChild(li);
		});
	},

	_updateOverview: function (ov) {
		var el;
		el = document.getElementById('o-profile');
		if (el) {
			el.className = 'o-card o-profile' + (ov.wan_connected ? '' : ' offline');
		}
		el = document.getElementById('o-wan-state');
		if (el) el.textContent = ov.wan_connected ? _('Connected') : _('Disconnected');
		el = document.getElementById('o-uptime');
		if (el) el.textContent = _('Uptime') + ': ' + fmtUptime(ov.uptime_sec);

		var tx = rateParts(ov.tx_bps), rx = rateParts(ov.rx_bps);
		el = document.getElementById('o-tx-val'); if (el) el.textContent = tx.v;
		el = document.getElementById('o-tx-unit'); if (el) el.textContent = tx.u;
		el = document.getElementById('o-rx-val'); if (el) el.textContent = rx.v;
		el = document.getElementById('o-rx-unit'); if (el) el.textContent = rx.u;

		el = document.getElementById('o-hosts'); if (el) el.textContent = String(ov.hosts || 0);
		el = document.getElementById('o-conns'); if (el) el.textContent = String(ov.connections || 0);
		el = document.getElementById('o-wired'); if (el) el.textContent = String(ov.wired || 0);
		el = document.getElementById('o-wan-n'); if (el) el.textContent = String(ov.wan_enabled || 0);
		el = document.getElementById('o-lan-n'); if (el) el.textContent = String(ov.lan_enabled || 0);
		el = document.getElementById('o-dhcp-rem'); if (el) el.textContent = String(ov.dhcp_remaining || 0);

		this._renderIfaces(ov.interfaces || []);
		this._pushRate(ov.tx_bps || 0, ov.rx_bps || 0);
		this._drawRateCharts();
	},

	_pushRate: function (tx, rx) {
		var now = Date.now() / 1000;
		this._rateWindow.push({ t: now, tx: tx, rx: rx });
		var cutoff = now - 300;
		this._rateWindow = this._rateWindow.filter(function (p) { return p.t >= cutoff; });
	},

	_setPieTitle: function (hist) {
		var titleEl = document.getElementById('o-pie-title');
		if (!titleEl) return;
		var selected = this._pieWindow || 30;
		var eff = (hist && hist.effective_window != null) ? parseInt(hist.effective_window, 10) : selected;
		if (!eff || eff <= 0) {
			titleEl.textContent = _('App traffic (sampling…)');
			return;
		}
		if (eff < selected) {
			titleEl.textContent = _('App traffic (last %d minutes)').format(eff);
			return;
		}
		var titles = {
			30: _('App traffic (last 30 minutes)'),
			60: _('App traffic (last 1 hour)'),
			1440: _('App traffic (last 1 day)')
		};
		titleEl.textContent = titles[selected] || titles[30];
	},

	_refreshHistory: function () {
		var self = this;
		var w = this._pieWindow || 30;
		return callHistory(w).then(function (h) {
			self._applyHistory(h || {});
			self._lastApps = (h && h.apps) || {};
			self._drawPie(self._lastApps);
			self._setPieTitle(h || {});
		});
	},

	_applyHistory: function (hist) {
		if (hist && hist.apps)
			this._lastApps = hist.apps;
		if (hist && hist.points && hist.points.length) {
			var cutoff = Date.now() / 1000 - 300;
			var pts = hist.points.filter(function (p) { return p.t >= cutoff; });
			if (pts.length) {
				this._rateWindow = pts.map(function (p) {
					return { t: p.t, tx: p.tx_bps || 0, rx: p.rx_bps || 0 };
				});
				this._drawRateCharts();
			}
		}
	},

	_drawPie: function (apps) {
		var canvas = document.getElementById('o-pie-canvas');
		var fit = fitCanvas(canvas);
		if (!fit) return;
		var ctx = fit.ctx, w = fit.w, h = fit.h;
		this._pieSlices = [];
		this._lastApps = apps || {};

		var muted = themeColor('--bw-gray-500', '#6b7f93');
		var text = themeColor('--bw-gray-900', '#1a2433');

		var parts = [];
		APP_KEYS.forEach(function (k) {
			var v = Number((apps && apps[k]) || 0);
			if (v > 0)
				parts.push({ key: k, label: appLabel(k), value: v, color: APP_COLORS[k] || '#999' });
		});

		var total = parts.reduce(function (s, p) { return s + p.value; }, 0);
		if (total <= 0) {
			ctx.fillStyle = muted;
			ctx.font = '13px system-ui, -apple-system, "Segoe UI", sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(_('No data yet (sampling)'), w / 2, h / 2);
			return;
		}

		/* Donut: side-by-side legend when wide enough, else stack legend below */
		var sideLegend = w >= 260;
		var cx = sideLegend ? w * 0.34 : w * 0.5;
		var cy = sideLegend ? h / 2 : h * 0.42;
		var r = Math.min(sideLegend ? w * 0.34 : w * 0.42, sideLegend ? h * 0.42 : h * 0.32) * 0.92;
		var rInner = r * 0.58;
		var a0 = -Math.PI / 2;
		var self = this;

		parts.forEach(function (p) {
			var a1 = a0 + (p.value / total) * Math.PI * 2;
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(a0) * rInner, cy + Math.sin(a0) * rInner);
			ctx.arc(cx, cy, r, a0, a1);
			ctx.arc(cx, cy, rInner, a1, a0, true);
			ctx.closePath();
			ctx.fillStyle = p.color;
			ctx.fill();
			self._pieSlices.push({
				a0: a0, a1: a1, cx: cx, cy: cy, r: r, rInner: rInner,
				label: p.label, value: p.value, color: p.color
			});
			a0 = a1;
		});

		/* center total label */
		ctx.fillStyle = text;
		ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(fmtBytes(total), cx, cy - 7);
		ctx.fillStyle = muted;
		ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
		ctx.fillText(_('Total'), cx, cy + 10);

		/* legend: right of donut when wide, else multi-column under donut */
		var lx, ly, rowH = 20, maxW;
		if (sideLegend) {
			lx = w * 0.62;
			ly = Math.max(16, (h - parts.length * rowH) / 2);
			maxW = w - lx - 16;
		} else {
			lx = 12;
			ly = cy + r + 18;
			maxW = w - 28;
		}
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
		parts.forEach(function (p, i) {
			var y = ly + i * rowH;
			if (y > h - 6) return;
			var rr = 3;
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.moveTo(lx + rr, y - 5);
			ctx.arcTo(lx + 10, y - 5, lx + 10, y + 5, rr);
			ctx.arcTo(lx + 10, y + 5, lx, y + 5, rr);
			ctx.arcTo(lx, y + 5, lx, y - 5, rr);
			ctx.arcTo(lx, y - 5, lx + 10, y - 5, rr);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = text;
			var pct = ((p.value / total) * 100).toFixed(1);
			var label = p.label + '  ' + pct + '%';
			if (ctx.measureText(label).width > maxW) {
				while (label.length > 4 && ctx.measureText(label + '…').width > maxW)
					label = label.slice(0, -1);
				label += '…';
			}
			ctx.fillText(label, lx + 16, y);
		});
	},

	/**
	 * Place tooltip with position:fixed and clamp to viewport edges
	 * so text is never clipped by .o-chart-box { overflow:hidden }.
	 */
	_placeChartTip: function (tip, clientX, clientY) {
		if (!tip) return;
		var pad = 8;
		var gap = 12;
		tip.style.display = 'block';
		tip.style.position = 'fixed';
		/* Measure after show (wrap/max-width applied) */
		var tw = tip.offsetWidth || 120;
		var th = tip.offsetHeight || 32;
		var vw = window.innerWidth || document.documentElement.clientWidth || 800;
		var vh = window.innerHeight || document.documentElement.clientHeight || 600;
		var left = clientX + gap;
		var top = clientY + gap;
		if (left + tw > vw - pad)
			left = clientX - tw - gap;
		if (top + th > vh - pad)
			top = clientY - th - gap;
		if (left < pad)
			left = pad;
		if (top < pad)
			top = pad;
		tip.style.left = Math.round(left) + 'px';
		tip.style.top = Math.round(top) + 'px';
	},

	_bindPieHover: function () {
		var self = this;
		var canvas = document.getElementById('o-pie-canvas');
		var tip = document.getElementById('o-pie-tip');
		if (!canvas || !tip) return;

		function hit(ev) {
			var rect = canvas.getBoundingClientRect();
			/* CSS-pixel coords (matches fitCanvas setTransform) */
			var x = ev.clientX - rect.left;
			var y = ev.clientY - rect.top;
			var slices = self._pieSlices || [];
			for (var i = 0; i < slices.length; i++) {
				var s = slices[i];
				var dx = x - s.cx, dy = y - s.cy;
				var dist = Math.sqrt(dx * dx + dy * dy);
				if (dist > s.r || dist < (s.rInner || 0)) continue;
				var ang = Math.atan2(dy, dx);
				var a0 = s.a0, a1 = s.a1;
				while (ang < a0) ang += Math.PI * 2;
				if (ang <= a1) return s;
			}
			return null;
		}

		canvas.addEventListener('mousemove', function (ev) {
			var s = hit(ev);
			if (!s) {
				tip.style.display = 'none';
				return;
			}
			tip.textContent = s.label + '：' + fmtBytes(s.value);
			self._placeChartTip(tip, ev.clientX, ev.clientY);
		});
		canvas.addEventListener('mouseleave', function () {
			tip.style.display = 'none';
		});
	},

	_bindRateHover: function () {
		var self = this;
		var up = document.getElementById('o-rate-up-canvas');
		var down = document.getElementById('o-rate-down-canvas');
		if (!up || !down) return;

		function onMove(ev, canvas) {
			var pts = self._rateWindow || [];
			if (pts.length < 1) return;
			var rect = canvas.getBoundingClientRect();
			/* Match draw: padL from measured axis labels when possible */
			var maxV = 1;
			var key = canvas.id.indexOf('up') >= 0 ? 'tx' : 'rx';
			pts.forEach(function (p) { if (p[key] > maxV) maxV = p[key]; });
			maxV = maxV * 1.15;
			var ctx = canvas.getContext('2d');
			var pads = ratePads(rect.width, ctx, rateAxisTicks(maxV));
			var padL = pads.L, padR = pads.R;
			var plotW = Math.max(1, rect.width - padL - padR);
			var x = ev.clientX - rect.left;
			var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
			if (t1 <= t0) t1 = t0 + 1;
			var ratio = (x - padL) / plotW;
			if (ratio < 0) ratio = 0;
			if (ratio > 1) ratio = 1;
			var t = t0 + ratio * (t1 - t0);
			var best = 0, bestD = Infinity;
			for (var i = 0; i < pts.length; i++) {
				var d = Math.abs(pts[i].t - t);
				if (d < bestD) { bestD = d; best = i; }
			}
			self._hoverIdx = best;
			self._drawRateCharts();
			self._showRateTips(ev, canvas, pts[best]);
		}

		function onLeave() {
			self._hoverIdx = -1;
			self._drawRateCharts();
			self._hideRateTips();
		}

		up.addEventListener('mousemove', function (ev) { onMove(ev, up); });
		down.addEventListener('mousemove', function (ev) { onMove(ev, down); });
		up.addEventListener('mouseleave', onLeave);
		down.addEventListener('mouseleave', onLeave);
	},

	_showRateTips: function (ev, sourceCanvas, pt) {
		var tipUp = document.getElementById('o-rate-tip-up');
		var tipDown = document.getElementById('o-rate-tip-down');
		if (!tipUp || !tipDown || !pt) return;

		var time = fmtClock(pt.t);
		tipUp.textContent = time + '  ' + _('Upload') + '：' + fmtRate(pt.tx);
		tipDown.textContent = time + '  ' + _('Download') + '：' + fmtRate(pt.rx);
		/* Stack slightly so dual tips do not fully overlap */
		this._placeChartTip(tipUp, ev.clientX, ev.clientY);
		this._placeChartTip(tipDown, ev.clientX, ev.clientY + 28);
	},

	_hideRateTips: function () {
		var tipUp = document.getElementById('o-rate-tip-up');
		var tipDown = document.getElementById('o-rate-tip-down');
		if (tipUp) tipUp.style.display = 'none';
		if (tipDown) tipDown.style.display = 'none';
	},

	_drawRateCharts: function () {
		var upColor = themeColor('--bw-warn', '#d97706');
		var downColor = themeColor('--bw-blue-500', '#1a7fd4');
		this._drawLine('o-rate-up-canvas', this._rateWindow, 'tx', upColor, _('Upload'));
		this._drawLine('o-rate-down-canvas', this._rateWindow, 'rx', downColor, _('Download'));
	},

	_drawLine: function (id, pts, key, color, label) {
		var canvas = document.getElementById(id);
		var fit = fitCanvas(canvas);
		if (!fit) return;
		var ctx = fit.ctx, w = fit.w, h = fit.h;

		var maxV = 1;
		(pts || []).forEach(function (p) {
			if (p[key] > maxV) maxV = p[key];
		});
		maxV = maxV * 1.15;

		/* Measure tick labels first → padL fits longest "12.45 MB/s" */
		var ticks = rateAxisTicks(maxV);
		var pads = ratePads(w, ctx, ticks);
		var padL = pads.L, padR = pads.R, padT = pads.T, padB = pads.B;
		var plotW = w - padL - padR, plotH = h - padT - padB;
		var grid = themeColor('--bw-gray-200', '#dce6f0');
		var muted = themeColor('--bw-gray-500', '#6b7f93');
		var hoverLine = themeColor('--bw-gray-700', '#3a4a5c');

		ctx.strokeStyle = grid;
		ctx.lineWidth = 1;
		ctx.fillStyle = muted;
		ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';

		for (var g = 0; g < 4; g++) {
			var y = padT + (plotH * g / 3);
			ctx.beginPath();
			ctx.moveTo(padL, y);
			ctx.lineTo(w - padR, y);
			ctx.stroke();
			/* right-align at padL - 4; full label stays inside [0, padL) */
			ctx.fillText(ticks[g], padL - 4, y);
		}

		if (!pts || pts.length < 2) {
			ctx.fillStyle = muted;
			ctx.textAlign = 'center';
			ctx.fillText(_('Sampling…'), w / 2, h / 2);
			return;
		}

		var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
		if (t1 <= t0) t1 = t0 + 1;

		function ptXY(p) {
			return {
				x: padL + ((p.t - t0) / (t1 - t0)) * plotW,
				y: padT + plotH - (p[key] / maxV) * plotH
			};
		}

		/* area fill under line */
		ctx.beginPath();
		pts.forEach(function (p, i) {
			var xy = ptXY(p);
			if (i === 0) ctx.moveTo(xy.x, xy.y); else ctx.lineTo(xy.x, xy.y);
		});
		var last = ptXY(pts[pts.length - 1]);
		var first = ptXY(pts[0]);
		ctx.lineTo(last.x, padT + plotH);
		ctx.lineTo(first.x, padT + plotH);
		ctx.closePath();
		ctx.save();
		ctx.globalAlpha = 0.14;
		ctx.fillStyle = color;
		ctx.fill();
		ctx.restore();

		/* stroke */
		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.beginPath();
		pts.forEach(function (p, i) {
			var xy = ptXY(p);
			if (i === 0) ctx.moveTo(xy.x, xy.y); else ctx.lineTo(xy.x, xy.y);
		});
		ctx.stroke();

		/* hover vertical line + point */
		var hi = this._hoverIdx;
		if (hi >= 0 && hi < pts.length) {
			var hxy = ptXY(pts[hi]);
			ctx.strokeStyle = hoverLine;
			ctx.globalAlpha = 0.35;
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 3]);
			ctx.beginPath();
			ctx.moveTo(hxy.x, padT);
			ctx.lineTo(hxy.x, padT + plotH);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.globalAlpha = 1;
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(hxy.x, hxy.y, 4, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = themeColor('--bw-white', '#fff');
			ctx.lineWidth = 1.5;
			ctx.stroke();
		}

		ctx.fillStyle = color;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
		ctx.fillText(label, padL + 4, padT + 12);
	}
});
