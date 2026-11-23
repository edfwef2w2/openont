'use strict';
'require view';
'require poll';
'require openont.rpc-helper as rpcHelper';
'require openont.crud-table as CRUDTable';

/*
 * Network → DHCP: per-LAN address pools, static leases and the lease table.
 * Backend: openont-dhcp (dhcp.sh). DNS settings belong to openont-dns.
 */

var api = rpcHelper.declareMap('openont', {
	status: { method: 'dhcp_status', expect: { '': {} } },
	leases: { method: 'dhcp_leases', expect: { '': {} } },
	pool: { method: 'dhcp_pool_set', params: [ 'role', 'enabled', 'start', 'limit', 'leasetime' ] },
	staticSet: { method: 'dhcp_static_set', params: [ 'id', 'mac', 'ip', 'name' ] },
	staticDel: { method: 'dhcp_static_del', params: [ 'id' ] }
});

function call(p) {
	return p.then(rpcHelper.rejectIfFailed);
}

function fmtRemain(sec) {
	sec = parseInt(sec, 10);
	if (isNaN(sec) || sec < 0) return _('Infinite');
	var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
	return h > 0 ? h + 'h ' + m + 'm' : m + 'm ' + (sec % 60) + 's';
}

function row(label, control, hint) {
	return E('div', { class: 'o-form-row' }, [
		E('label', {}, [ label ]),
		control,
		hint ? E('span', { class: 'o-muted' }, [ hint ]) : ''
	]);
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return Promise.all([ api.status(), api.leases() ]);
	},

	renderPool: function (p) {
		var err = E('div', { class: 'o-alert', style: 'display:none' });
		var en = E('input', { type: 'checkbox', checked: p.enabled ? 'checked' : null });
		var start = E('input', { class: 'o-input', type: 'number', min: 1, value: p.start || 100 });
		var limit = E('input', { class: 'o-input', type: 'number', min: 1, value: p.limit || 150 });
		var lease = E('input', { class: 'o-input', type: 'text', value: p.leasetime || '12h', placeholder: '12h' });

		return E('div', { class: 'o-role-card', style: 'margin-top:10px' }, [
			E('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
				E('strong', {}, [ p.role ]),
				E('span', { class: 'o-muted' }, [ p.cidr || _('no address') ]),
				p.enabled
					? E('span', { class: 'o-badge o-badge-ok' }, [ _('On') ])
					: E('span', { class: 'o-badge o-badge-warn' }, [ _('Off') ]),
				p.enabled ? E('span', { class: 'o-muted' }, [
					_('%s – %s · %d in use · %d free').format(p.first, p.last, p.used || 0, p.remaining || 0)
				]) : ''
			]),
			E('div', { style: 'margin-top:12px' }, [
				err,
				row(_('Enable DHCP server'), en),
				row(_('Start offset'), start, _('first address = network + offset')),
				row(_('Pool size'), limit),
				row(_('Lease time'), lease, _('e.g. 30m, 12h, 7d, infinite')),
				E('div', { class: 'o-form-actions' }, [
					E('button', {
						class: 'o-btn o-btn-primary',
						click: function () {
							err.style.display = 'none';
							call(api.pool(p.role, en.checked ? 'on' : 'off',
								start.value, limit.value, lease.value.trim()))
								.then(function () { location.reload(); })
								.catch(function (e) {
									err.style.display = '';
									err.textContent = e.message || String(e);
								});
						}
					}, [ _('Save') ])
				])
			])
		]);
	},

	renderLeases: function (list, statics) {
		var tbody = E('tbody', {});
		var known = {};
		(statics || []).forEach(function (s) { known[String(s.mac).toLowerCase()] = true; });

		function fill(items) {
			tbody.innerHTML = '';
			if (!items.length) {
				tbody.appendChild(E('tr', {}, [ E('td', { colspan: 6 }, [ _('No active leases.') ]) ]));
				return;
			}
			items.forEach(function (l) {
				var isStatic = l.static || known[String(l.mac).toLowerCase()];
				tbody.appendChild(E('tr', {}, [
					E('td', {}, [ l.hostname || '—' ]),
					E('td', {}, [ l.ip ]),
					E('td', {}, [ l.mac ]),
					E('td', {}, [ l.role || '—' ]),
					E('td', {}, [ fmtRemain(l.remaining) ]),
					E('td', {}, [
						isStatic ? E('span', { class: 'o-badge o-badge-info' }, [ _('Static') ]) :
						E('a', {
							href: '#',
							click: function (ev) {
								ev.preventDefault();
								call(api.staticSet('', l.mac, l.ip, l.hostname || ''))
									.then(function () { location.reload(); })
									.catch(function (e) { alert(e.message || String(e)); });
							}
						}, [ _('Make static') ])
					])
				]));
			});
		}
		fill(list || []);
		poll.add(function () {
			return api.leases().then(function (d) { fill((d && d.leases) || []); });
		}, 5);

		return E('div', { class: 'o-card', style: 'margin-top:12px' }, [
			E('div', { class: 'o-card-title' }, [ _('Active leases') ]),
			E('table', { class: 'o-table' }, [
				E('thead', {}, [ E('tr', {}, [
					E('th', {}, [ _('Hostname') ]),
					E('th', {}, [ 'IPv4' ]),
					E('th', {}, [ 'MAC' ]),
					E('th', {}, [ _('Interface') ]),
					E('th', {}, [ _('Remaining') ]),
					E('th', {}, [ '' ])
				]) ]),
				tbody
			])
		]);
	},

	render: function (res) {
		var status = res[0] || {}, leases = (res[1] && res[1].leases) || [];
		var self = this;
		var page = E('div', { class: 'o-page' });

		page.appendChild(E('div', { class: 'o-card-title', style: 'margin-bottom:12px' }, [
			E('h3', { style: 'margin:0' }, [ _('DHCP') ]),
			E('span', {}, [ _('Same as console openont-dhcp') ])
		]));

		var pools = E('div', { class: 'o-card' }, [
			E('div', { class: 'o-card-title' }, [ _('Address pools') ])
		]);
		if (!(status.pools || []).length)
			pools.appendChild(E('p', { class: 'o-muted' }, [
				_('No LAN interface yet. Create one under Network → Interfaces.') ]));
		(status.pools || []).forEach(function (p) { pools.appendChild(self.renderPool(p)); });
		page.appendChild(pools);

		page.appendChild(new CRUDTable.Table({
			title: '',
			sectionTitle: _('Static leases'),
			emptyText: _('No static leases.'),
			getRows: function (d) { return (d && d.static) || []; },
			columns: [
				{ key: 'name', label: _('Hostname') },
				{ key: 'mac', label: 'MAC' },
				{ key: 'ip', label: 'IPv4' },
				{ key: 'role', label: _('Interface') }
			],
			fields: [
				{ key: 'name', label: _('Hostname'), type: 'text', placeholder: _('optional') },
				{ key: 'mac', label: 'MAC', type: 'text', placeholder: 'aa:bb:cc:dd:ee:ff' },
				{ key: 'ip', label: 'IPv4', type: 'text', placeholder: '192.168.1.50' }
			],
			defaults: { id: '', name: '', mac: '', ip: '' },
			formTitle: function (r) {
				return r && r.id ? _('Edit static lease') : _('Add static lease');
			},
			actions: {
				save: function (v, r) {
					return api.staticSet((r && r.id) || '', v.mac, v.ip, v.name || '');
				},
				delete: function (r) {
					return api.staticDel(r.id);
				}
			},
			rowActions: [
				{ id: 'edit' },
				{
					id: 'delete',
					confirm: function (r) { return _('Delete static lease %s?').format(r.ip); }
				}
			]
		}).render(status));

		page.appendChild(this.renderLeases(leases, status.static));
		return page;
	}
});
