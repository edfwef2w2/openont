'use strict';
'require view';
'require rpc';

var callPortStatus = rpc.declare({ object: 'openont', method: 'port_status', expect: { '': {} } });
var callPortSet = rpc.declare({ object: 'openont', method: 'port_set', params: [ 'role', 'ports', 'proto' ] });
var callPortDelPort = rpc.declare({ object: 'openont', method: 'port_del_port', params: [ 'role', 'netdev' ] });
var callPortDel = rpc.declare({ object: 'openont', method: 'port_del', params: [ 'role' ] });

function linkText(link) {
	return link === 'up' ? _('Connected') : _('Disconnected');
}

function linkBadge(link) {
	var ok = link === 'up';
	return E('span', { class: 'o-badge ' + (ok ? 'o-badge-ok' : 'o-badge-bad') }, [
		linkText(link)
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
		data = data || {};
		var st = data.stats || {};
		var err = E('div', { class: 'o-alert', style: 'display:none' });

		var page = E('div', { class: 'o-page' });

		/* Page title */
		page.appendChild(E('div', { class: 'o-card-title', style: 'margin-bottom:12px' }, [
			E('h3', { style: 'margin:0' }, [ _('Port Binding') ]),
			E('span', {}, [ _('Matches console openont-port operations') ])
		]));

		/* Stat chips */
		page.appendChild(E('div', { class: 'o-stat-bar' }, [
			E('span', {}, [ _('Total NICs') + ': ', E('b', {}, [ String(st.total || 0) ]) ]),
			E('span', {}, [ _('Free') + ': ', E('b', {}, [ String(st.free || 0) ]) ]),
			E('span', {}, [ 'LAN: ', E('b', {}, [ String(st.lan || 0) ]) ]),
			E('span', {}, [ 'WAN: ', E('b', {}, [ String(st.wan || 0) ]) ])
		]));

		/* Physical adapters table */
		var physBody = E('tbody', {});
		(data.physical || []).forEach(function (p) {
			physBody.appendChild(E('tr', { class: p.free ? '' : 'o-row-bound' }, [
				E('td', {}, [ p.netdev ]),
				E('td', {}, [ p.role || '—' ]),
				E('td', {}, [ linkBadge(p.link) ]),
				E('td', {}, [
					(p.speed ? p.speed + 'Mbps' : '—') + (p.duplex ? '/' + p.duplex : '')
				]),
				E('td', {}, [ p.mac || '—' ]),
				E('td', {}, [
					E('span', { class: 'o-badge ' + (p.free ? 'o-badge-bad' : 'o-badge-info') }, [
						p.free ? _('Free') : _('Bound')
					])
				])
			]));
		});
		if (!(data.physical || []).length) {
			physBody.appendChild(E('tr', {}, [
				E('td', { class: 'cbi-empty', colspan: 6 }, [ _('No network adapters found.') ])
			]));
		}

		page.appendChild(E('div', { class: 'o-card' }, [
			E('div', { class: 'o-card-title' }, [ _('Physical adapter status') ]),
			E('table', { class: 'o-table' }, [
				E('thead', {}, [ E('tr', {}, [
					E('th', {}, [ _('Adapter') ]),
					E('th', {}, [ _('Role') ]),
					E('th', {}, [ _('Link') ]),
					E('th', {}, [ _('Speed') ]),
					E('th', {}, [ 'MAC' ]),
					E('th', {}, [ _('State') ])
				]) ]),
				physBody
			])
		]));

		/* Logical interfaces as role cards */
		var roleBox = E('div', { class: 'o-card', style: 'margin-top:12px' }, [
			E('div', { class: 'o-card-title' }, [ _('Logical interfaces (lanN / wanN)') ])
		]);

		var roles = data.roles || [];
		if (!roles.length) {
			roleBox.appendChild(E('p', { class: 'o-muted' }, [
				_('No bindings yet. Use the form below to create one.')
			]));
		} else {
			roles.forEach(function (r) {
				var chipRow = E('div', { class: 'o-chip-row' });
				(r.ports || []).forEach(function (p) {
					var name = p.name || p;
					chipRow.appendChild(E('span', { class: 'o-chip' }, [
						name, ' ',
						linkBadge(p.link || 'down'), ' ',
						E('a', {
							href: '#',
							click: function (ev) {
								ev.preventDefault();
								if (!confirm(_('Remove %s from %s?').format(name, r.name)))
									return;
								callPortDelPort(r.name, name).then(function () { location.reload(); });
							}
						}, [ _('Remove') ])
					]));
				});

				roleBox.appendChild(E('div', { class: 'o-role-card' }, [
					E('div', {}, [
						E('strong', {}, [ r.name ]),
						' · ',
						r.proto || '—',
						r.device ? (' · ' + r.device) : '',
						E('a', {
							href: '#',
							style: 'margin-left:12px;color:#fe6f73',
							click: function (ev) {
								ev.preventDefault();
								if (!confirm(_('Unbind %s?').format(r.name)))
									return;
								callPortDel(r.name).then(function () { location.reload(); });
							}
						}, [ _('Unbind') ])
					]),
					chipRow
				]));
			});
		}
		page.appendChild(roleBox);

		/* Bind form */
		var freeNets = (data.physical || []).filter(function (p) { return p.free; }).map(function (p) {
			return p.netdev;
		});
		var roleIn = E('input', {
			type: 'text',
			class: 'o-input',
			value: 'lan1',
			placeholder: 'lan1 / wan1'
		});
		var portSel = E('select', {
			class: 'o-input o-select-multi',
			multiple: 'multiple',
			size: Math.min(6, Math.max(3, freeNets.length || 3))
		});
		freeNets.forEach(function (n) {
			portSel.appendChild(E('option', { value: n }, [ n ]));
		});
		var protoIn = E('select', { class: 'o-input' }, [
			E('option', { value: 'dhcp' }, [ 'dhcp (WAN)' ]),
			E('option', { value: 'pppoe' }, [ 'pppoe (WAN)' ]),
			E('option', { value: 'static' }, [ 'static' ])
		]);

		page.appendChild(E('div', { class: 'o-card', style: 'margin-top:12px' }, [
			E('div', { class: 'o-card-title' }, [ _('Bind / set (openont-port set)') ]),
			err,
			E('div', { class: 'o-form-row' }, [
				E('label', {}, [ _('Role') ]),
				roleIn
			]),
			E('div', { class: 'o-form-row' }, [
				E('label', {}, [ _('Adapters (multi-select for LAN)') ]),
				portSel
			]),
			E('div', { class: 'o-form-row' }, [
				E('label', {}, [ _('WAN protocol') ]),
				protoIn
			]),
			E('div', { class: 'o-form-actions' }, [
				E('button', {
					class: 'o-btn o-btn-primary',
					click: function () {
						var role = roleIn.value.trim();
						var selected = Array.prototype.filter.call(portSel.options, function (o) {
							return o.selected;
						}).map(function (o) { return o.value; });
						if (!role || !selected.length) {
							err.style.display = '';
							err.textContent = _('Please set a role and select at least one adapter');
							return;
						}
						var proto = /^wan/i.test(role) ? protoIn.value : '';
						callPortSet(role, selected.join(' '), proto).then(function (res) {
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

		return page;
	}
});
