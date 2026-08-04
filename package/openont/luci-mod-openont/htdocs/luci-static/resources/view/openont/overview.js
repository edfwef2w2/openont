'use strict';
'require view';
'require rpc';
'require poll';
'require openont.chart-common as cc';
'require openont.chart-pie as chartPie';
'require openont.chart-rate as chartRate';
'require openont.chart-hover as chartHover';
'require openont.dash-layout as dashLayout';

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

function fmtUptime(sec) {
	sec = parseInt(sec, 10) || 0;
	var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
	if (d > 0)
		return _('%d day(s) %d hour(s) %d min').format(d, h, m);
	return _('%d hour(s) %d min').format(h, m);
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

		var tx = cc.rateParts(ov.tx_bps);
		var rx = cc.rateParts(ov.rx_bps);
		dash.appendChild(E('div', { class: 'o-col', 'data-span': '0.5' }, [
			E('div', { class: 'o-card' }, [
				E('div', { class: 'o-card-title', 'data-icon': 'rate' }, [ _('Rate status') ]),
				E('div', { class: 'o-rate-line up' }, [
					E('span', { class: 'val', id: 'o-tx-val' }, [ tx.v ]),
					E('span', { class: 'unit', id: 'o-tx-unit' }, [ tx.u ]),
					E('span', { class: 'o-rate-side-lbl' }, [ _('Upload') ])
				]),
				E('div', { class: 'o-rate-line down' }, [
					E('span', { class: 'val', id: 'o-rx-val' }, [ rx.v ]),
					E('span', { class: 'unit', id: 'o-rx-unit' }, [ rx.u ]),
					E('span', { class: 'o-rate-side-lbl' }, [ _('Download') ])
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

		dash.appendChild(E('div', { class: 'o-col o-charts-strip', 'data-span': '1' }, [
			E('div', { class: 'o-charts-pair' }, [
				E('div', { class: 'o-charts-tile o-charts-pie' }, [ pieCard ]),
				E('div', { class: 'o-charts-tile o-charts-rate' }, [ rateCard ])
			])
		]));

		root.appendChild(dash);
		this._renderIfaces(ov.interfaces || []);
		this._applyHistory(hist);
		this._setPieTitle(hist);

		chartHover.bind(this, root);
		dashLayout.bindChartResize(this);
		this._scheduleChartPaint();

		document.addEventListener('openont-layout-mode', function () {
			self._scheduleChartPaint();
		});
		document.addEventListener('openont-theme-change', function () {
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
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				self._paintCharts();
			});
		});
	},

	_paintCharts: function () {
		this._paintingCharts = true;
		try {
			dashLayout.updateDashUnit(this._overviewRoot || document.querySelector('.o-overview'));
			dashLayout.layoutChartBoxes(this._overviewRoot || document.querySelector('.o-overview'));
			chartPie.drawPie(this, this._lastApps || {});
			chartRate.drawRateCharts(this);
			chartHover.resync(this);
		} finally {
			this._paintingCharts = false;
		}
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
		if (el)
			el.className = 'o-card o-profile' + (ov.wan_connected ? '' : ' offline');
		el = document.getElementById('o-wan-state');
		if (el) el.textContent = ov.wan_connected ? _('Connected') : _('Disconnected');
		el = document.getElementById('o-uptime');
		if (el) el.textContent = _('Uptime') + ': ' + fmtUptime(ov.uptime_sec);

		var tx = cc.rateParts(ov.tx_bps), rx = cc.rateParts(ov.rx_bps);
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
		chartRate.drawRateCharts(this);
		chartHover.resync(this);
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
			chartPie.drawPie(self, self._lastApps);
			self._setPieTitle(h || {});
			chartHover.resync(self);
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
				chartRate.drawRateCharts(this);
			}
		}
	}
});
