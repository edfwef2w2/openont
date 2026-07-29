'use strict';
'require view';
'require rpc';
'require poll';

var callStatus = rpc.declare({ object: 'openont', method: 'pppoe_status', params: [ 'iface' ], expect: { '': {} } });
var callDial = rpc.declare({ object: 'openont', method: 'pppoe_dial', params: [ 'iface' ] });
var callHangup = rpc.declare({ object: 'openont', method: 'pppoe_hangup', params: [ 'iface' ] });
var callRedial = rpc.declare({ object: 'openont', method: 'pppoe_redial', params: [ 'iface' ] });

function stateLabel(it) {
	if (it.pending) return _('Connecting');
	if (it.up) return _('Connected');
	return _('Disconnected');
}

function stateClass(it) {
	if (it.pending) return 'o-badge o-badge-info';
	if (it.up) return 'o-badge o-badge-ok';
	return 'o-badge o-badge-bad';
}

function fmtUptime(sec) {
	sec = parseInt(sec, 10) || 0;
	var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
	if (h > 0) return h + 'h ' + m + 'm';
	if (m > 0) return m + 'm ' + s + 's';
	return s + 's';
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return callStatus('');
	},

	render: function (data) {
		var self = this;
		var root = E('div', { class: 'o-page' });
		var err = E('div', { class: 'o-alert', style: 'display:none' });
		var tbody = E('tbody', { id: 'o-pppoe-tbody' });

		function showErr(msg) {
			if (!msg) {
				err.style.display = 'none';
				return;
			}
			err.style.display = '';
			err.textContent = msg;
		}

		function act(fn, iface) {
			fn(iface).then(function (res) {
				if (res && res.ok === false)
					showErr(res.error || _('Failed'));
				else
					showErr('');
				return callStatus('').then(fill);
			}).catch(function (e) {
				showErr(String(e));
			});
		}

		function fill(d) {
			var list = (d && d.interfaces) || [];
			tbody.innerHTML = '';
			if (!list.length) {
				tbody.appendChild(E('tr', {}, [
					E('td', { colspan: 8, class: 'o-muted' }, [
						_('No PPPoE interface found. Bind a WAN with PPPoE first: openont-port set wan1 eth0 pppoe')
					])
				]));
				return;
			}
			list.forEach(function (it) {
				tbody.appendChild(E('tr', {}, [
					E('td', {}, [ it.name ]),
					E('td', {}, [ E('span', { class: stateClass(it) }, [ stateLabel(it) ]) ]),
					E('td', {}, [ it.ipv4 || '—' ]),
					E('td', {}, [ it.device || '—' ]),
					E('td', {}, [ it.l3_device || '—' ]),
					E('td', {}, [ it.up ? fmtUptime(it.uptime) : '—' ]),
					E('td', {}, [ it.username || '—' ]),
					E('td', { class: 'o-ops' }, [
						E('button', {
							class: 'o-btn o-btn-primary',
							disabled: it.up && !it.pending ? 'disabled' : null,
							click: function () { act(callDial, it.name); }
						}, [ _('Dial') ]),
						' ',
						E('button', {
							class: 'o-btn',
							disabled: !it.up && !it.pending ? 'disabled' : null,
							click: function () { act(callHangup, it.name); }
						}, [ _('Hang up') ]),
						' ',
						E('button', {
							class: 'o-btn',
							click: function () { act(callRedial, it.name); }
						}, [ _('Redial') ])
					])
				]));
			});
		}

		root.appendChild(E('div', { class: 'o-toolbar' }, [
			E('h3', { style: 'margin:0;flex:1' }, [ _('PPPoE Dial') ]),
			E('button', {
				class: 'o-btn',
				click: function () {
					callStatus('').then(fill);
				}
			}, [ _('Refresh') ])
		]));
		root.appendChild(err);
		root.appendChild(E('div', { class: 'o-card' }, [
			E('table', { class: 'o-table' }, [
				E('thead', {}, [ E('tr', {}, [
					E('th', {}, [ _('Interface') ]),
					E('th', {}, [ _('State') ]),
					E('th', {}, [ 'IPv4' ]),
					E('th', {}, [ _('Device') ]),
					E('th', {}, [ _('L3 device') ]),
					E('th', {}, [ _('Uptime') ]),
					E('th', {}, [ _('Username') ]),
					E('th', {}, [ _('Actions') ])
				]) ]),
				tbody
			])
		]));
		root.appendChild(E('p', { class: 'o-muted' }, [
			'CLI: openont-pppoe status | dial <iface> | hangup <iface> | redial <iface>'
		]));

		fill(data || {});

		poll.add(function () {
			return callStatus('').then(fill);
		}, 4);

		return root;
	}
});
