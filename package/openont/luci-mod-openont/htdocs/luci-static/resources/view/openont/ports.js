'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callPortStatus = rpc.declare({ object: 'openont', method: 'port_status', expect: { '': {} } });
var callPortSet = rpc.declare({ object: 'openont', method: 'port_set', params: [ 'role', 'ports', 'proto' ] });
var callPortDelPort = rpc.declare({ object: 'openont', method: 'port_del_port', params: [ 'role', 'netdev' ] });
var callPortDel = rpc.declare({ object: 'openont', method: 'port_del', params: [ 'role' ] });

function badge(link) {
	return E('span', { class: link === 'up' ? 'o-badge o-badge-ok' : 'o-badge o-badge-bad' }, [
		link === 'up' ? _('Connected') : _('Disconnected')
	]);
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return callPortStatus();
	},

	render: function (data) {
		this._data = data || {};
		var root = E('div', { class: 'o-page' });
		root.appendChild(E('div', { class: 'o-card-title', style: 'margin-bottom:12px' }, [
			E('h3', { style: 'margin:0' }, [ _('Port Binding') ]),
			E('span', { style: 'color:#888;font-size:12px' }, [ _('Same operations as openont-port on the console') ])
		]));

		var st = (data && data.stats) || {};
		root.appendChild(E('div', { class: 'o-stat-bar' }, [
			E('span', {}, [ _('Total NICs'), ': ', E('b', {}, [ String(st.total || 0) ]) ]),
			E('span', {}, [ _('Free'), ': ', E('b', {}, [ String(st.free || 0) ]) ]),
			E('span', {}, [ 'LAN: ', E('b', {}, [ String(st.lan || 0) ]) ]),
			E('span', {}, [ 'WAN: ', E('b', {}, [ String(st.wan || 0) ]) ])
		]));

		var table = E('table', { class: 'o-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ _('Physical NIC') ]), E('th', {}, [ _('Role') ]),
				E('th', {}, [ _('Link') ]), E('th', {}, [ _('Speed') ]),
				E('th', {}, [ 'MAC' ]), E('th', {}, [ _('State') ])
			]) ])
		]);
		var tb = E('tbody', {});
		(data.physical || []).forEach(function (p) {
			tb.appendChild(E('tr', { class: p.free ? '' : 'o-row-bound' }, [
				E('td', {}, [ p.netdev ]),
				E('td', {}, [ p.role || '—' ]),
				E('td', {}, [ badge(p.link) ]),
				E('td', {}, [ (p.speed ? p.speed + 'Mbps' : '—') + (p.duplex ? '/' + p.duplex : '') ]),
				E('td', {}, [ p.mac || '—' ]),
				E('td', {}, [
					p.free
						? E('span', { class: 'o-badge' }, [ _('Free') ])
						: E('span', { class: 'o-badge o-badge-info' }, [ _('Bound') ])
				])
			]));
		});
		table.appendChild(tb);
		root.appendChild(E('div', { class: 'o-card' }, [
			E('div', { class: 'o-card-title' }, [ _('Physical NIC status') ]),
			table
		]));

		var rolesBox = E('div', { class: 'o-card', style: 'margin-top:12px' }, [
			E('div', { class: 'o-card-title' }, [ _('Logical interfaces (lanN / wanN)') ])
		]);
		var roles = data.roles || [];
		if (!roles.length) {
			rolesBox.appendChild(E('p', { class: 'o-muted' }, [
				_('No bindings yet. Use the form below or: openont-port set lan1 eth0')
			]));
		} else {
			roles.forEach(function (r) {
				var ports = (r.ports || []).map(function (p) {
					return E('span', { class: 'o-chip' }, [
						p.name || p, ' ', badge(p.link || 'down'), ' ',
						E('a', {
							href: '#',
							click: function (ev) {
								ev.preventDefault();
								if (!confirm(_('Remove %s from %s?').format(p.name || p, r.name))) return;
								callPortDelPort(r.name, p.name || p).then(function () { location.reload(); });
							}
						}, [ _('Remove') ])
					]);
				});
				rolesBox.appendChild(E('div', { class: 'o-role-card' }, [
					E('div', {}, [
						E('strong', {}, [ r.name ]), ' · ', r.proto || '?', ' · ', r.device || '',
						E('a', {
							href: '#', style: 'margin-left:12px;color:#fe6f73',
							click: function (ev) {
								ev.preventDefault();
								if (!confirm(_('Unbind %s?').format(r.name))) return;
								callPortDel(r.name).then(function () { location.reload(); });
							}
						}, [ _('Unbind') ])
					]),
					E('div', { class: 'o-chip-row' }, ports)
				]));
			});
		}
		root.appendChild(rolesBox);

		var freeNets = (data.physical || []).filter(function (p) { return p.free; }).map(function (p) { return p.netdev; });
		var roleIn = E('input', { class: 'o-input', placeholder: 'lan1 / wan1', value: 'lan1' });
		var portSel = E('select', { class: 'o-input o-select-multi', multiple: 'multiple', size: Math.min(6, Math.max(3, freeNets.length || 3)) });
		freeNets.forEach(function (n) {
			portSel.appendChild(E('option', { value: n }, [ n ]));
		});
		var protoIn = E('select', { class: 'o-input' }, [
			E('option', { value: 'dhcp' }, [ 'dhcp (WAN)' ]),
			E('option', { value: 'pppoe' }, [ 'pppoe (WAN)' ]),
			E('option', { value: 'static' }, [ 'static' ])
		]);
		var err = E('div', { class: 'o-alert', style: 'display:none' });

		root.appendChild(E('div', { class: 'o-card', style: 'margin-top:12px' }, [
			E('div', { class: 'o-card-title' }, [ _('Bind / set (openont-port set)') ]),
			err,
			E('div', { class: 'o-form-row' }, [ E('label', {}, [ _('Role') ]), roleIn ]),
			E('div', { class: 'o-form-row' }, [ E('label', {}, [ _('NICs (multi-select for LAN)') ]), portSel ]),
			E('div', { class: 'o-form-row' }, [ E('label', {}, [ _('WAN protocol') ]), protoIn ]),
			E('div', { class: 'o-form-actions' }, [
				E('button', {
					class: 'o-btn o-btn-primary',
					click: function () {
						var role = roleIn.value.trim();
						var selected = Array.prototype.filter.call(portSel.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
						if (!role || !selected.length) {
							err.style.display = '';
							err.textContent = _('Please set a role and select at least one NIC');
							return;
						}
						var ports = selected.join(' ');
						var proto = /^wan/i.test(role) ? protoIn.value : '';
						callPortSet(role, ports, proto).then(function (res) {
							if (res && res.ok === false) {
								err.style.display = '';
								err.textContent = res.error || _('Failed');
							} else {
								location.reload();
							}
						}).catch(function (e) {
							err.style.display = '';
							err.textContent = String(e);
						});
					}
				}, [ _('Apply binding') ])
			]),
			E('p', { class: 'o-muted' }, [
				'CLI: openont-port set lan1 eth0 eth1 · openont-port add lan1 eth2 · openont-port del-port lan1 eth1 · openont-port del lan1'
			])
		]));

		return root;
	}
});
