'use strict';
'require view';
'require poll';
'require openont.rpc-helper as rpcHelper';

/*
 * Network → Interfaces: the only place that binds ports to lanN / wanN and
 * sets their protocol. DHCP pools live on the DHCP page.
 * Backend: openont-port (ports) + openont-address (protocol/address).
 */

var api = rpcHelper.declareMap('openont', {
	status: { method: 'iface_status', expect: { '': {} } },
	create: { method: 'iface_create', params: [ 'type', 'ports', 'proto' ] },
	ports: { method: 'iface_ports', params: [ 'role', 'ports' ] },
	del: { method: 'iface_delete', params: [ 'role' ] },
	proto: {
		method: 'iface_proto',
		params: [ 'role', 'proto', 'ipaddr', 'gateway', 'dns', 'username', 'password' ]
	},
	dial: { method: 'pppoe_dial', params: [ 'iface' ] },
	hangup: { method: 'pppoe_hangup', params: [ 'iface' ] },
	redial: { method: 'pppoe_redial', params: [ 'iface' ] }
});

var PROTO_LABEL = {
	dhcp: _('DHCP client'),
	static: _('Static address'),
	pppoe: 'PPPoE'
};

function badge(cls, text) {
	return E('span', { class: 'o-badge ' + cls }, [ text ]);
}

function linkBadge(p) {
	return p && p.link === 'up'
		? badge('o-badge-ok', _('Connected'))
		: badge('o-badge-err', _('Disconnected'));
}

function stateBadge(st) {
	st = st || {};
	if (st.pending)
		return badge('o-badge-warn', _('Connecting'));
	if (st.up)
		return badge('o-badge-ok', _('Up'));
	return badge('o-badge-err', _('Down'));
}

function fmtUptime(sec) {
	sec = parseInt(sec, 10) || 0;
	var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
	if (h > 0) return h + 'h ' + m + 'm';
	return m + 'm ' + (sec % 60) + 's';
}

function stateText(st) {
	st = st || {};
	var parts = [];
	if (st.ipv4) parts.push('IPv4 ' + st.ipv4);
	if (st.up) parts.push(_('Uptime') + ' ' + fmtUptime(st.uptime));
	if (st.error) parts.push(_('Error') + ': ' + st.error);
	return parts.join(' · ') || '—';
}

function row(label, control, hint) {
	return E('div', { class: 'o-form-row' }, [
		E('label', {}, [ label ]),
		control,
		hint ? E('span', { class: 'o-muted' }, [ hint ]) : ''
	]);
}

function input(value, placeholder, type) {
	return E('input', {
		class: 'o-input',
		type: type || 'text',
		value: value || '',
		placeholder: placeholder || ''
	});
}

function select(options, value) {
	var s = E('select', { class: 'o-input' });
	options.forEach(function (o) {
		s.appendChild(E('option', { value: o[0], selected: o[0] === value ? 'selected' : null }, [ o[1] ]));
	});
	return s;
}

function words(s) {
	return String(s || '').split(/[\s,]+/).filter(Boolean);
}

function sameList(a, b) {
	return a.slice().sort().join(' ') === b.slice().sort().join(' ');
}

/* Resolve { ok:false } into a rejection so chained saves stop early. */
function call(p) {
	return p.then(rpcHelper.rejectIfFailed);
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return api.status();
	},

	freePorts: function (data) {
		return (data.physical || []).filter(function (p) { return p.free; })
			.map(function (p) { return p.netdev; });
	},

	/* Member-port editor: chips with remove links plus an "add" dropdown. */
	portEditor: function (initial, free, single) {
		var members = initial.slice();
		var box = E('div', { class: 'o-chip-row', style: 'margin-top:0' });

		function draw() {
			box.innerHTML = '';
			if (single) {
				var opts = members.concat(free.filter(function (n) {
					return members.indexOf(n) < 0;
				})).map(function (n) { return [ n, n ]; });
				var s = select(opts, members[0]);
				s.addEventListener('change', function () { members = [ s.value ]; });
				box.appendChild(s);
				return;
			}
			members.forEach(function (n) {
				box.appendChild(E('span', { class: 'o-chip' }, [
					n, ' ',
					E('a', {
						href: '#',
						click: function (ev) {
							ev.preventDefault();
							if (members.length < 2) {
								alert(_('A LAN needs at least one port. Delete the interface instead.'));
								return;
							}
							members.splice(members.indexOf(n), 1);
							free.push(n);
							draw();
						}
					}, [ '×' ])
				]));
			});
			var avail = free.filter(function (n) { return members.indexOf(n) < 0; });
			if (avail.length) {
				var add = select([ [ '', _('Add port…') ] ].concat(avail.map(function (n) { return [ n, n ]; })), '');
				add.style.maxWidth = '160px';
				add.addEventListener('change', function () {
					if (!add.value) return;
					members.push(add.value);
					free.splice(free.indexOf(add.value), 1);
					draw();
				});
				box.appendChild(add);
			}
		}

		draw();
		return { node: box, value: function () { return members.slice(); } };
	},

	renderRole: function (r, data) {
		var self = this;
		var isLan = r.type === 'lan';
		var err = E('div', { class: 'o-alert', style: 'display:none' });
		var origPorts = (r.ports || []).map(function (p) { return p.name; });
		var ports = this.portEditor(origPorts, this.freePorts(data), !isLan);

		var protoSel = isLan ? null : select([
			[ 'dhcp', PROTO_LABEL.dhcp ],
			[ 'pppoe', PROTO_LABEL.pppoe ],
			[ 'static', PROTO_LABEL.static ]
		], r.proto || 'dhcp');

		var ipIn = input(r.ipaddr, '192.168.1.1/24');
		var gwIn = input(r.gateway, isLan ? _('optional') : '10.0.0.1');
		var dnsIn = input(r.dns, _('optional, space separated'));
		var userIn = input(r.username, _('PPPoE username'));
		var passIn = input('', r.has_password ? _('unchanged') : _('PPPoE password'), 'password');

		var staticRows = E('div', {}, [
			row(_('IPv4 address'), ipIn, _('address/prefix')),
			row(_('Gateway'), gwIn),
			row(_('DNS servers'), dnsIn)
		]);
		var pppoeRows = E('div', {}, [
			row(_('Username'), userIn),
			row(_('Password'), passIn)
		]);

		function syncProto() {
			var p = isLan ? 'static' : protoSel.value;
			staticRows.style.display = p === 'static' ? '' : 'none';
			pppoeRows.style.display = p === 'pppoe' ? '' : 'none';
		}
		if (protoSel)
			protoSel.addEventListener('change', syncProto);
		syncProto();

		function fail(e) {
			err.style.display = '';
			err.textContent = e && e.message ? e.message : String(e);
		}

		function save() {
			err.style.display = 'none';
			var steps = [];
			var newPorts = ports.value();
			var proto = isLan ? 'static' : protoSel.value;
			var ip = ipIn.value.trim();
			var gw = gwIn.value.trim();
			var dns = words(dnsIn.value);
			var redirect = null;

			if (!sameList(newPorts, origPorts))
				steps.push(function () { return call(api.ports(r.name, newPorts)); });

			var protoChanged = proto !== r.proto;
			if (proto === 'static') {
				if (!ip)
					return fail(_('Enter an IPv4 address such as 192.168.1.1/24'));
				if (protoChanged || ip !== r.ipaddr || gw !== (r.gateway || '') ||
				    !sameList(dns, words(r.dns))) {
					var oldIp = (r.ipaddr || '').split('/')[0];
					var newIp = ip.split('/')[0];
					if (isLan && oldIp && newIp !== oldIp && location.hostname === oldIp) {
						if (!confirm(_('This page is served from %s. After saving, the router moves to %s and this page will reload there.').format(oldIp, newIp)))
							return;
						redirect = newIp;
					}
					steps.push(function () { return call(api.proto(r.name, 'static', ip, gw, dns, '', '')); });
				}
			} else if (proto === 'pppoe') {
				var user = userIn.value.trim();
				if (!user && !r.username)
					return fail(_('Enter the PPPoE username'));
				if (protoChanged || user !== (r.username || '') || passIn.value)
					steps.push(function () {
						return call(api.proto(r.name, 'pppoe', '', '', [], user, passIn.value));
					});
			} else if (protoChanged) {
				steps.push(function () { return call(api.proto(r.name, 'dhcp', '', '', [], '', '')); });
			}

			if (!steps.length)
				return;
			steps.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve()).then(function () {
				if (redirect) {
					window.setTimeout(function () {
						location.href = location.protocol + '//' + redirect + location.pathname;
					}, 5000);
					err.style.display = '';
					err.textContent = _('Saved. Reconnecting to %s…').format(redirect);
				} else {
					location.reload();
				}
			}).catch(fail);
		}

		function remove(ev) {
			ev.preventDefault();
			var msg = isLan
				? _('Delete %s? Its DHCP pool and the static leases in its subnet are removed too.').format(r.name)
				: _('Delete %s?').format(r.name);
			if (!confirm(msg))
				return;
			call(api.del(r.name)).then(function () { location.reload(); }).catch(fail);
		}

		var stateEl = E('span', { 'data-state': r.name }, [ stateBadge(r.state) ]);
		var stateTxt = E('span', { class: 'o-muted', 'data-state-text': r.name }, [ stateText(r.state) ]);

		var head = E('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, [
			E('strong', {}, [ r.name ]),
			badge('o-badge-info', isLan ? 'LAN' : 'WAN'),
			stateEl, stateTxt,
			E('a', { href: '#', style: 'margin-left:auto;color:#fe6f73', click: remove }, [ _('Delete') ])
		]);

		var body = E('div', { style: 'margin-top:12px' }, [
			err,
			row(isLan ? _('Ports') : _('Port'), ports.node),
			protoSel ? row(_('Protocol'), protoSel) : ''
		]);
		if (isLan) {
			body.appendChild(row(_('IPv4 address'), ipIn, _('address/prefix')));
			var d = r.dhcp || {};
			body.appendChild(row(_('DHCP server'), E('span', {}, [
				d.enabled
					? badge('o-badge-ok', _('On')) : badge('o-badge-warn', _('Off')),
				' ',
				d.enabled ? E('span', { class: 'o-muted' }, [
					_('%s – %s, %d free').format(d.first, d.last, d.remaining || 0) ]) : '',
				' ',
				E('a', { href: L.url('admin/network/dhcp') }, [ _('Configure') ])
			])));
		} else {
			body.appendChild(staticRows);
			body.appendChild(pppoeRows);
		}

		var actions = E('div', { class: 'o-form-actions' }, [
			E('button', { class: 'o-btn o-btn-primary', click: save }, [ _('Save') ])
		]);
		if (!isLan && r.proto === 'pppoe') {
			[ [ api.dial, _('Connect') ], [ api.hangup, _('Disconnect') ], [ api.redial, _('Reconnect') ] ]
				.forEach(function (a) {
					actions.appendChild(E('button', {
						class: 'o-btn',
						click: function () {
							call(a[0](r.name)).then(function () { self.refresh(); }).catch(fail);
						}
					}, [ a[1] ]));
				});
		}
		body.appendChild(actions);

		return E('div', { class: 'o-role-card', style: 'margin-top:10px' }, [ head, body ]);
	},

	renderCreate: function (data) {
		var err = E('div', { class: 'o-alert', style: 'display:none' });
		var free = this.freePorts(data);
		var next = data.next || {};
		var typeSel = select([
			[ 'lan', _('LAN (bridge, one or more ports)') ],
			[ 'wan', _('WAN (one port)') ]
		], 'lan');
		var nameHint = E('span', { class: 'o-muted' });
		var portSel = E('select', {
			class: 'o-input o-select-multi',
			multiple: 'multiple',
			size: Math.min(6, Math.max(3, free.length))
		});
		free.forEach(function (n) { portSel.appendChild(E('option', { value: n }, [ n ])); });

		function sync() {
			nameHint.textContent = _('Will be created as %s').format(next[typeSel.value] || '');
			portSel.multiple = typeSel.value === 'lan';
		}
		typeSel.addEventListener('change', sync);
		sync();

		var card = E('div', { class: 'o-card', style: 'margin-top:12px' }, [
			E('div', { class: 'o-card-title' }, [ _('New interface') ]),
			err
		]);
		if (!free.length) {
			card.appendChild(E('p', { class: 'o-muted' }, [ _('All ports are in use. Remove a port from an interface first.') ]));
			return card;
		}
		card.appendChild(row(_('Type'), typeSel, nameHint));
		card.appendChild(row(_('Ports'), portSel));
		card.appendChild(E('div', { class: 'o-form-actions' }, [
			E('button', {
				class: 'o-btn o-btn-primary',
				click: function () {
					var sel = Array.prototype.filter.call(portSel.options, function (o) { return o.selected; })
						.map(function (o) { return o.value; });
					if (!sel.length) {
						err.style.display = '';
						err.textContent = _('Select at least one port');
						return;
					}
					call(api.create(typeSel.value, sel, '')).then(function () {
						location.reload();
					}).catch(function (e) {
						err.style.display = '';
						err.textContent = e.message || String(e);
					});
				}
			}, [ _('Create') ])
		]));
		return card;
	},

	refresh: function () {
		return api.status().then(function (data) {
			(data.roles || []).forEach(function (r) {
				var b = document.querySelector('[data-state="' + r.name + '"]');
				var t = document.querySelector('[data-state-text="' + r.name + '"]');
				if (b) { b.innerHTML = ''; b.appendChild(stateBadge(r.state)); }
				if (t) t.textContent = stateText(r.state);
			});
		});
	},

	render: function (data) {
		var self = this;
		data = data || {};
		var st = data.stats || {};
		var page = E('div', { class: 'o-page' });

		page.appendChild(E('div', { class: 'o-card-title', style: 'margin-bottom:12px' }, [
			E('h3', { style: 'margin:0' }, [ _('Interfaces') ]),
			E('span', {}, [ _('Same as console openont-port / openont-address') ])
		]));

		page.appendChild(E('div', { class: 'o-stat-bar' }, [
			E('span', {}, [ _('Ports') + ': ', E('b', {}, [ String(st.total || 0) ]) ]),
			E('span', {}, [ _('Free') + ': ', E('b', {}, [ String(st.free || 0) ]) ]),
			E('span', {}, [ 'LAN: ', E('b', {}, [ String(st.lan || 0) ]) ]),
			E('span', {}, [ 'WAN: ', E('b', {}, [ String(st.wan || 0) ]) ])
		]));

		/* Physical ports */
		var tbody = E('tbody', {});
		(data.physical || []).forEach(function (p) {
			var l = p.port || {};
			tbody.appendChild(E('tr', { class: p.free ? '' : 'o-row-bound' }, [
				E('td', {}, [ p.netdev ]),
				E('td', {}, [ p.role || '—' ]),
				E('td', {}, [ linkBadge(l) ]),
				E('td', {}, [ (l.speed ? l.speed + ' Mbps' : '—') + (l.duplex ? ' / ' + l.duplex : '') ]),
				E('td', {}, [ l.mac || '—' ])
			]));
		});
		if (!(data.physical || []).length)
			tbody.appendChild(E('tr', {}, [ E('td', { colspan: 5 }, [ _('No network adapters found.') ]) ]));

		page.appendChild(E('div', { class: 'o-card' }, [
			E('div', { class: 'o-card-title' }, [ _('Physical ports') ]),
			E('table', { class: 'o-table' }, [
				E('thead', {}, [ E('tr', {}, [
					E('th', {}, [ _('Port') ]),
					E('th', {}, [ _('Interface') ]),
					E('th', {}, [ _('Link') ]),
					E('th', {}, [ _('Speed') ]),
					E('th', {}, [ 'MAC' ])
				]) ]),
				tbody
			])
		]));

		/* Interfaces */
		var roles = E('div', { class: 'o-card', style: 'margin-top:12px' }, [
			E('div', { class: 'o-card-title' }, [ _('Interfaces (lanN / wanN)') ])
		]);
		if (!(data.roles || []).length)
			roles.appendChild(E('p', { class: 'o-muted' }, [ _('No interfaces yet. Create one below.') ]));
		(data.roles || []).forEach(function (r) {
			roles.appendChild(self.renderRole(r, data));
		});
		page.appendChild(roles);

		page.appendChild(this.renderCreate(data));

		poll.add(L.bind(this.refresh, this), 5);
		return page;
	}
});
