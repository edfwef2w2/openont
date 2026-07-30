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
		var err = E('div', { class: 'alert-message', style: 'display:none' });

		var map = E('div', { class: 'cbi-map' }, [
			E('h2', { name: 'content' }, [ _('Port Binding') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Bind physical network adapters to LAN or WAN interfaces.')
			]),
			err
		]);

		/* Summary */
		map.appendChild(E('div', { class: 'cbi-section' }, [
			E('h3', {}, [ _('Summary') ]),
			E('div', { class: 'cbi-section-node' }, [
				E('table', { class: 'table' }, [
					E('tr', {}, [
						E('td', {}, [ _('Total NICs') + ': ', E('strong', {}, [ String(st.total || 0) ]) ]),
						E('td', {}, [ _('Free') + ': ', E('strong', {}, [ String(st.free || 0) ]) ]),
						E('td', {}, [ 'LAN: ', E('strong', {}, [ String(st.lan || 0) ]) ]),
						E('td', {}, [ 'WAN: ', E('strong', {}, [ String(st.wan || 0) ]) ])
					])
				])
			])
		]));

		/* Physical NICs */
		var physBody = E('tbody', {});
		(data.physical || []).forEach(function (p) {
			physBody.appendChild(E('tr', { class: 'tr' }, [
				E('td', { class: 'td' }, [ p.netdev ]),
				E('td', { class: 'td' }, [ p.role || '—' ]),
				E('td', { class: 'td' }, [ linkText(p.link) ]),
				E('td', { class: 'td' }, [
					(p.speed ? p.speed + ' Mbps' : '—') + (p.duplex ? ' / ' + p.duplex : '')
				]),
				E('td', { class: 'td' }, [ p.mac || '—' ]),
				E('td', { class: 'td' }, [ p.free ? _('Free') : _('Bound') ])
			]));
		});
		if (!(data.physical || []).length) {
			physBody.appendChild(E('tr', { class: 'tr' }, [
				E('td', { class: 'td cbi-empty', colspan: 6 }, [ _('No network adapters found.') ])
			]));
		}
		map.appendChild(E('div', { class: 'cbi-section' }, [
			E('h3', {}, [ _('Physical adapters') ]),
			E('div', { class: 'cbi-section-node' }, [
				E('table', { class: 'table cbi-section-table' }, [
					E('thead', {}, [ E('tr', { class: 'tr table-titles' }, [
						E('th', { class: 'th' }, [ _('Adapter') ]),
						E('th', { class: 'th' }, [ _('Role') ]),
						E('th', { class: 'th' }, [ _('Link') ]),
						E('th', { class: 'th' }, [ _('Speed') ]),
						E('th', { class: 'th' }, [ 'MAC' ]),
						E('th', { class: 'th' }, [ _('State') ])
					]) ]),
					physBody
				])
			])
		]));

		/* Logical interfaces */
		var roleBody = E('tbody', {});
		var roles = data.roles || [];
		if (!roles.length) {
			roleBody.appendChild(E('tr', { class: 'tr' }, [
				E('td', { class: 'td cbi-empty', colspan: 4 }, [
					_('No bindings yet. Use the form below to create one.')
				])
			]));
		} else {
			roles.forEach(function (r) {
				var ports = (r.ports || []).map(function (p) {
					var name = p.name || p;
					return E('span', {}, [
						name, ' (', linkText(p.link || 'down'), ') ',
						E('a', {
							href: '#',
							click: function (ev) {
								ev.preventDefault();
								if (!confirm(_('Remove %s from %s?').format(name, r.name))) return;
								callPortDelPort(r.name, name).then(function () { location.reload(); });
							}
						}, [ _('Remove') ]),
						' '
					]);
				});
				roleBody.appendChild(E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ r.name ]),
					E('td', { class: 'td' }, [ r.proto || '—' ]),
					E('td', { class: 'td' }, ports.length ? ports : [ '—' ]),
					E('td', { class: 'td' }, [
						E('a', {
							href: '#',
							class: 'cbi-button cbi-button-remove',
							click: function (ev) {
								ev.preventDefault();
								if (!confirm(_('Unbind %s?').format(r.name))) return;
								callPortDel(r.name).then(function () { location.reload(); });
							}
						}, [ _('Unbind') ])
					])
				]));
			});
		}
		map.appendChild(E('div', { class: 'cbi-section' }, [
			E('h3', {}, [ _('Logical interfaces') ]),
			E('div', { class: 'cbi-section-descr' }, [ _('LAN and WAN interfaces created from physical adapters.') ]),
			E('div', { class: 'cbi-section-node' }, [
				E('table', { class: 'table cbi-section-table' }, [
					E('thead', {}, [ E('tr', { class: 'tr table-titles' }, [
						E('th', { class: 'th' }, [ _('Interface') ]),
						E('th', { class: 'th' }, [ _('Protocol') ]),
						E('th', { class: 'th' }, [ _('Adapters') ]),
						E('th', { class: 'th' }, [ _('Actions') ])
					]) ]),
					roleBody
				])
			])
		]));

		/* Bind form */
		var freeNets = (data.physical || []).filter(function (p) { return p.free; }).map(function (p) { return p.netdev; });
		var roleIn = E('input', { type: 'text', value: 'lan1', placeholder: 'lan1 / wan1' });
		var portSel = E('select', { multiple: 'multiple', size: Math.min(6, Math.max(3, freeNets.length || 3)) });
		freeNets.forEach(function (n) {
			portSel.appendChild(E('option', { value: n }, [ n ]));
		});
		var protoIn = E('select', {}, [
			E('option', { value: 'dhcp' }, [ 'DHCP' ]),
			E('option', { value: 'pppoe' }, [ 'PPPoE' ]),
			E('option', { value: 'static' }, [ 'Static' ])
		]);

		map.appendChild(E('div', { class: 'cbi-section' }, [
			E('h3', {}, [ _('Add binding') ]),
			E('div', { class: 'cbi-section-descr' }, [
				_('Select free adapters and assign them to a LAN or WAN role.')
			]),
			E('div', { class: 'cbi-section-node' }, [
				E('div', { class: 'cbi-value' }, [
					E('label', { class: 'cbi-value-title' }, [ _('Role') ]),
					E('div', { class: 'cbi-value-field' }, [ roleIn ])
				]),
				E('div', { class: 'cbi-value' }, [
					E('label', { class: 'cbi-value-title' }, [ _('Adapters') ]),
					E('div', { class: 'cbi-value-field' }, [
						portSel,
						E('br'),
						E('small', {}, [ _('Hold Ctrl/Cmd to select multiple adapters for LAN.') ])
					])
				]),
				E('div', { class: 'cbi-value' }, [
					E('label', { class: 'cbi-value-title' }, [ _('WAN protocol') ]),
					E('div', { class: 'cbi-value-field' }, [ protoIn ])
				])
			]),
			E('div', { class: 'cbi-page-actions' }, [
				E('button', {
					class: 'cbi-button cbi-button-apply',
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
				}, [ _('Save & Apply') ])
			])
		]));

		return map;
	}
});
