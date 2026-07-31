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

		var root = E('div', { class: 'o-overview' });

		/* Row 1: profile / rates / connections */
		var row1 = E('div', { class: 'o-row' });

		var profileCls = 'o-card o-profile' + (ov.wan_connected ? '' : ' offline');
		var stateText = ov.wan_connected ? _('Connected') : _('Disconnected');
		row1.appendChild(E('div', { class: 'o-col o-col-3' }, [
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
		row1.appendChild(E('div', { class: 'o-col o-col-3' }, [
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

		row1.appendChild(E('div', { class: 'o-col o-col-6' }, [
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

		root.appendChild(row1);

		/* Row 2: interface status */
		var row2 = E('div', { class: 'o-row' });
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
		row2.appendChild(E('div', { class: 'o-col o-col-12' }, [ ifCard ]));
		root.appendChild(row2);
		this._renderIfaces(ov.interfaces || []);

		/* Row 3: pie + rate charts */
		var row3 = E('div', { class: 'o-row' });

		var pieSelect = E('select', { class: 'o-select', id: 'o-pie-window' }, [
			E('option', { value: '30', selected: 'selected' }, [ _('Last 30 minutes') ]),
			E('option', { value: '60' }, [ _('Last 1 hour') ]),
			E('option', { value: '1440' }, [ _('Last 1 day') ])
		]);
		pieSelect.addEventListener('change', function () {
			self._pieWindow = parseInt(pieSelect.value, 10) || 30;
			self._refreshHistory();
		});

		var pieBox = E('div', { class: 'o-chart-box', id: 'o-pie-box', style: 'position:relative' }, [
			E('canvas', { id: 'o-pie-canvas', width: 320, height: 260 }),
			E('div', {
				id: 'o-pie-tip',
				class: 'o-chart-tip',
				style: 'display:none;position:absolute;z-index:5;pointer-events:none;' +
					'background:rgba(0,0,0,.78);color:#fff;padding:6px 10px;border-radius:4px;' +
					'font-size:12px;white-space:nowrap'
			})
		]);

		row3.appendChild(E('div', { class: 'o-col o-col-4' }, [
			E('div', { class: 'o-card' }, [
				E('div', { class: 'o-card-title', 'data-icon': 'pie' }, [
					E('span', { id: 'o-pie-title' }, [ _('App traffic (last 30 minutes)') ]),
					pieSelect
				]),
				pieBox
			])
		]));

		var upWrap = E('div', { class: 'o-chart-box sm', style: 'position:relative' }, [
			E('canvas', { id: 'o-rate-up-canvas', width: 640, height: 140 }),
			E('div', {
				id: 'o-rate-tip-up',
				class: 'o-chart-tip',
				style: 'display:none;position:absolute;z-index:5;pointer-events:none;' +
					'background:rgba(0,0,0,.78);color:#fff;padding:6px 10px;border-radius:4px;' +
					'font-size:12px;white-space:nowrap'
			})
		]);
		var downWrap = E('div', { class: 'o-chart-box sm', style: 'margin-top:8px;position:relative' }, [
			E('canvas', { id: 'o-rate-down-canvas', width: 640, height: 120 }),
			E('div', {
				id: 'o-rate-tip-down',
				class: 'o-chart-tip',
				style: 'display:none;position:absolute;z-index:5;pointer-events:none;' +
					'background:rgba(0,0,0,.78);color:#fff;padding:6px 10px;border-radius:4px;' +
					'font-size:12px;white-space:nowrap'
			})
		]);

		row3.appendChild(E('div', { class: 'o-col o-col-8' }, [
			E('div', { class: 'o-card' }, [
				E('div', { class: 'o-card-title', 'data-icon': 'chart' }, [
					E('span', {}, [ _('Upload / download rate (last 5 minutes)') ])
				]),
				upWrap,
				downWrap
			])
		]));
		root.appendChild(row3);

		/* seed from history */
		this._applyHistory(hist);
		this._drawPie(hist.apps || {});
		this._setPieTitle(hist);

		this._bindPieHover();
		this._bindRateHover();

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
			self._drawPie((h && h.apps) || {});
			self._setPieTitle(h || {});
		});
	},

	_applyHistory: function (hist) {
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
		if (!canvas) return;
		var ctx = canvas.getContext('2d');
		var w = canvas.width, h = canvas.height;
		ctx.clearRect(0, 0, w, h);
		this._pieSlices = [];

		var parts = [];
		APP_KEYS.forEach(function (k) {
			var v = Number((apps && apps[k]) || 0);
			if (v > 0)
				parts.push({ key: k, label: appLabel(k), value: v, color: APP_COLORS[k] || '#999' });
		});

		var total = parts.reduce(function (s, p) { return s + p.value; }, 0);
		if (total <= 0) {
			ctx.fillStyle = '#999';
			ctx.font = '13px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(_('No data yet (sampling)'), w / 2, h / 2);
			return;
		}

		var cx = w * 0.36, cy = h / 2, r = Math.min(w, h) * 0.30;
		var a0 = -Math.PI / 2;
		var self = this;
		parts.forEach(function (p) {
			var a1 = a0 + (p.value / total) * Math.PI * 2;
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.arc(cx, cy, r, a0, a1);
			ctx.closePath();
			ctx.fillStyle = p.color;
			ctx.fill();
			self._pieSlices.push({
				a0: a0, a1: a1, cx: cx, cy: cy, r: r,
				label: p.label, value: p.value, color: p.color
			});
			a0 = a1;
		});

		/* legend */
		var lx = w * 0.64, ly = 18;
		ctx.textAlign = 'left';
		ctx.font = '11px sans-serif';
		parts.forEach(function (p, i) {
			var y = ly + i * 22;
			if (y > h - 8) return;
			ctx.fillStyle = p.color;
			ctx.fillRect(lx, y - 8, 10, 10);
			ctx.fillStyle = '#444';
			var pct = ((p.value / total) * 100).toFixed(1);
			ctx.fillText(p.label + ' ' + pct + '%', lx + 14, y + 1);
		});
	},

	_bindPieHover: function () {
		var self = this;
		var canvas = document.getElementById('o-pie-canvas');
		var tip = document.getElementById('o-pie-tip');
		var box = document.getElementById('o-pie-box');
		if (!canvas || !tip || !box) return;

		function hit(ev) {
			var rect = canvas.getBoundingClientRect();
			var scaleX = canvas.width / rect.width;
			var scaleY = canvas.height / rect.height;
			var x = (ev.clientX - rect.left) * scaleX;
			var y = (ev.clientY - rect.top) * scaleY;
			var slices = self._pieSlices || [];
			for (var i = 0; i < slices.length; i++) {
				var s = slices[i];
				var dx = x - s.cx, dy = y - s.cy;
				if (Math.sqrt(dx * dx + dy * dy) > s.r) continue;
				/* canvas arc angles match atan2 (0 east, CCW) */
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
			tip.style.display = 'block';
			var boxRect = box.getBoundingClientRect();
			tip.style.left = (ev.clientX - boxRect.left + 12) + 'px';
			tip.style.top = (ev.clientY - boxRect.top + 12) + 'px';
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
			var padL = 48, padR = 10;
			var plotW = canvas.width - padL - padR;
			var scaleX = canvas.width / rect.width;
			var x = (ev.clientX - rect.left) * scaleX;
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
		var upC = document.getElementById('o-rate-up-canvas');
		var downC = document.getElementById('o-rate-down-canvas');
		if (!tipUp || !tipDown || !pt) return;

		var time = fmtClock(pt.t);
		tipUp.textContent = time + '  ' + _('Upload') + '：' + fmtRate(pt.tx);
		tipDown.textContent = time + '  ' + _('Download') + '：' + fmtRate(pt.rx);
		tipUp.style.display = 'block';
		tipDown.style.display = 'block';

		/* place tips near cursor X on each chart */
		function place(tip, canvas) {
			var wrap = canvas.parentNode;
			if (!wrap) return;
			var rect = canvas.getBoundingClientRect();
			var wrapRect = wrap.getBoundingClientRect();
			var x = ev.clientX - wrapRect.left + 10;
			var y = 8;
			if (x + 120 > wrapRect.width) x = wrapRect.width - 130;
			if (x < 4) x = 4;
			tip.style.left = x + 'px';
			tip.style.top = y + 'px';
		}
		place(tipUp, upC);
		place(tipDown, downC);
	},

	_hideRateTips: function () {
		var tipUp = document.getElementById('o-rate-tip-up');
		var tipDown = document.getElementById('o-rate-tip-down');
		if (tipUp) tipUp.style.display = 'none';
		if (tipDown) tipDown.style.display = 'none';
	},

	_drawRateCharts: function () {
		this._drawLine('o-rate-up-canvas', this._rateWindow, 'tx', '#e6a23c', _('Upload'));
		this._drawLine('o-rate-down-canvas', this._rateWindow, 'rx', '#0088cc', _('Download'));
	},

	_drawLine: function (id, pts, key, color, label) {
		var canvas = document.getElementById(id);
		if (!canvas) return;
		var ctx = canvas.getContext('2d');
		var w = canvas.width, h = canvas.height;
		ctx.clearRect(0, 0, w, h);

		var padL = 48, padR = 10, padT = 16, padB = 22;
		var plotW = w - padL - padR, plotH = h - padT - padB;

		ctx.strokeStyle = '#e5e8ec';
		ctx.fillStyle = '#999';
		ctx.font = '11px sans-serif';
		ctx.textAlign = 'right';

		var maxV = 1;
		(pts || []).forEach(function (p) {
			if (p[key] > maxV) maxV = p[key];
		});
		maxV = maxV * 1.2;

		for (var g = 0; g < 4; g++) {
			var y = padT + (plotH * g / 3);
			ctx.beginPath();
			ctx.moveTo(padL, y);
			ctx.lineTo(w - padR, y);
			ctx.stroke();
			var val = maxV * (1 - g / 3);
			ctx.fillText(fmtRate(val), padL - 4, y + 3);
		}

		if (!pts || pts.length < 2) {
			ctx.fillStyle = '#aaa';
			ctx.textAlign = 'center';
			ctx.fillText(_('Sampling…'), w / 2, h / 2);
			return;
		}

		var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
		if (t1 <= t0) t1 = t0 + 1;

		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		ctx.beginPath();
		pts.forEach(function (p, i) {
			var x = padL + ((p.t - t0) / (t1 - t0)) * plotW;
			var yy = padT + plotH - (p[key] / maxV) * plotH;
			if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
		});
		ctx.stroke();

		/* hover vertical line + point */
		var hi = this._hoverIdx;
		if (hi >= 0 && hi < pts.length) {
			var hx = padL + ((pts[hi].t - t0) / (t1 - t0)) * plotW;
			var hy = padT + plotH - (pts[hi][key] / maxV) * plotH;
			ctx.strokeStyle = 'rgba(0,0,0,0.25)';
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 3]);
			ctx.beginPath();
			ctx.moveTo(hx, padT);
			ctx.lineTo(hx, padT + plotH);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.fillStyle = color;
		ctx.textAlign = 'left';
		ctx.fillText(label, padL + 4, padT + 10);
	}
});
