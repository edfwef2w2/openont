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
		var err = E('div', { class: 'alert-message', style: 'display:none' });
		var tbody = E('tbody', {});

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
				tbody.appendChild(E('tr', { class: 'tr' }, [
					E('td', { class: 'td cbi-empty', colspan: 8 }, [
						_('No PPPoE interface found. Configure a WAN with PPPoE under Network → Port Binding first.')
					])
				]));
				return;
			}
			list.forEach(function (it) {
				tbody.appendChild(E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ it.name ]),
					E('td', { class: 'td' }, [ stateLabel(it) ]),
					E('td', { class: 'td' }, [ it.ipv4 || '—' ]),
					E('td', { class: 'td' }, [ it.device || '—' ]),
					E('td', { class: 'td' }, [ it.l3_device || '—' ]),
					E('td', { class: 'td' }, [ it.up ? fmtUptime(it.uptime) : '—' ]),
					E('td', { class: 'td' }, [ it.username || '—' ]),
					E('td', { class: 'td' }, [
						E('button', {
							class: 'cbi-button cbi-button-action',
							disabled: it.up && !it.pending ? 'disabled' : null,
							click: function () { act(callDial, it.name); }
						}, [ _('Dial') ]),
						' ',
						E('button', {
							class: 'cbi-button',
							disabled: !it.up && !it.pending ? 'disabled' : null,
							click: function () { act(callHangup, it.name); }
						}, [ _('Hang up') ]),
						' ',
						E('button', {
							class: 'cbi-button',
							click: function () { act(callRedial, it.name); }
						}, [ _('Redial') ])
					])
				]));
			});
		}

		var map = E('div', { class: 'cbi-map' }, [
			E('h2', { name: 'content' }, [ _('PPPoE Dial') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Dial, hang up or redial PPPoE WAN interfaces.')
			]),
			err,
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, [ _('Interfaces') ]),
				E('div', { class: 'cbi-section-actions' }, [
					E('button', {
						class: 'cbi-button',
						click: function () { callStatus('').then(fill); }
					}, [ _('Refresh') ])
				]),
				E('div', { class: 'cbi-section-node' }, [
					E('table', { class: 'table cbi-section-table' }, [
						E('thead', {}, [ E('tr', { class: 'tr table-titles' }, [
							E('th', { class: 'th' }, [ _('Interface') ]),
							E('th', { class: 'th' }, [ _('State') ]),
							E('th', { class: 'th' }, [ 'IPv4' ]),
							E('th', { class: 'th' }, [ _('Device') ]),
							E('th', { class: 'th' }, [ _('L3 device') ]),
							E('th', { class: 'th' }, [ _('Uptime') ]),
							E('th', { class: 'th' }, [ _('Username') ]),
							E('th', { class: 'th' }, [ _('Actions') ])
						]) ]),
						tbody
					])
				])
			])
		]);

		fill(data || {});
		poll.add(function () {
			return callStatus('').then(fill);
		}, 4);

		return map;
	}
});
