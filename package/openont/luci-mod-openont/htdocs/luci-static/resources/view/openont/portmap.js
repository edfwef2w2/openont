'use strict';
'require view';
'require rpc';

var callList = rpc.declare({ object: 'openont', method: 'portmap_list', expect: { '': {} } });
var callGroups = rpc.declare({ object: 'openont', method: 'ipgroup_list', expect: { '': {} } });
var callAdd = rpc.declare({
	object: 'openont', method: 'portmap_add',
	params: [ 'name', 'dest_ip', 'dest_port', 'proto', 'src_dport', 'src_group', 'enabled' ]
});
var callDel = rpc.declare({ object: 'openont', method: 'portmap_del', params: [ 'name' ] });
var callEn = rpc.declare({ object: 'openont', method: 'portmap_enable', params: [ 'name' ] });
var callDis = rpc.declare({ object: 'openont', method: 'portmap_disable', params: [ 'name' ] });

return view.extend({
	handleSaveApply: null, handleSave: null, handleReset: null,

	load: function () {
		return Promise.all([ callList(), callGroups() ]);
	},

	render: function (data) {
		var items = (data[0] && data[0].items) || [];
		var groups = (data[1] && data[1].groups) || [];
		var filter = E('select', {}, [
			E('option', { value: '' }, [ _('All') ]),
			E('option', { value: '1' }, [ _('Enabled') ]),
			E('option', { value: '0' }, [ _('Disabled') ])
		]);
		var search = E('input', { type: 'text', placeholder: _('Search…') });
		var editBox = E('div', { class: 'cbi-section', style: 'display:none' });
		var tbody = E('tbody', {});

		function groupLabel(id) {
			if (!id) return _('Any');
			var g = groups.filter(function (x) { return x.id === id; })[0];
			return g ? g.name : id;
		}

		function wanLabel(v) {
			return (!v || v === 'all') ? _('All WAN') : v;
		}

		function showEdit(it) {
			it = it || { name: '', dest_ip: '', dest_port: '', proto: 'tcp', src_dport: '', src_group: '', enabled: 1 };
			editBox.style.display = '';
			editBox.innerHTML = '';
			var nameIn = E('input', { type: 'text', value: it.name || '' });
			var dip = E('input', { type: 'text', value: it.dest_ip || '' });
			var dport = E('input', { type: 'text', value: it.dest_port || '' });
			var sport = E('input', { type: 'text', value: it.src_dport || '' });
			var proto = E('select', {}, [
				E('option', { value: 'tcp' }, [ 'TCP' ]),
				E('option', { value: 'udp' }, [ 'UDP' ]),
				E('option', { value: 'tcp+udp' }, [ 'TCP+UDP' ])
			]);
			proto.value = (it.proto || 'tcp').replace(/ /g, '+');
			var grp = E('select', {}, [ E('option', { value: '' }, [ _('Any') ]) ]);
			groups.forEach(function (g) {
				grp.appendChild(E('option', { value: g.id }, [ g.name ]));
			});
			if (it.src_group) grp.value = it.src_group;
			var prev = E('div', { class: 'cbi-section-descr' });
			function refreshPrev() {
				var g = groups.filter(function (x) { return x.id === grp.value; })[0];
				prev.textContent = g
					? (_('Members') + ': ' + (g.entries || []).join(', '))
					: _('No source IP restriction');
			}
			grp.addEventListener('change', refreshPrev);
			refreshPrev();
			var err = E('div', { class: 'alert-message', style: 'display:none' });

			editBox.appendChild(E('h3', {}, [
				it.name ? _('Edit port mapping') : _('Add port mapping')
			]));
			editBox.appendChild(err);
			[
				[ _('Comment / name'), nameIn ],
				[ _('Internal address'), dip ],
				[ _('Internal port'), dport ],
				[ _('Protocol'), proto ],
				[ _('External address'), E('input', { type: 'text', value: _('All WAN'), disabled: 'disabled' }) ],
				[ _('External port'), sport ],
				[ _('Allow-access IP'), grp ]
			].forEach(function (row) {
				editBox.appendChild(E('div', { class: 'cbi-value' }, [
					E('label', { class: 'cbi-value-title' }, [ row[0] ]),
					E('div', { class: 'cbi-value-field' }, [ row[1] ])
				]));
			});
			editBox.appendChild(prev);
			editBox.appendChild(E('div', { class: 'cbi-section-descr' }, [
				E('a', { href: L.url('admin/network/openont-ipgroup') }, [ _('Manage IP groups') ])
			]));
			editBox.appendChild(E('div', { class: 'cbi-page-actions' }, [
				E('button', {
					class: 'cbi-button cbi-button-apply',
					click: function () {
						var n = nameIn.value.trim() || ('pm-' + dip.value + '-' + sport.value);
						callAdd(n, dip.value.trim(), dport.value.trim(), proto.value, sport.value.trim(), grp.value, '1')
							.then(function (res) {
								if (res && res.ok === false) {
									err.style.display = '';
									err.textContent = res.error || _('Failed');
								} else location.reload();
							});
					}
				}, [ _('Save & Apply') ]),
				E('button', {
					class: 'cbi-button',
					click: function () { editBox.style.display = 'none'; }
				}, [ _('Cancel') ])
			]));
		}

		function renderRows() {
			tbody.innerHTML = '';
			var q = search.value.trim().toLowerCase();
			var f = filter.value;
			var n = 0;
			items.forEach(function (it) {
				if (f !== '' && String(it.enabled ? 1 : 0) !== f) return;
				var blob = [ it.dest_ip, it.dest_port, it.src_dport, it.name, it.proto ].join(' ').toLowerCase();
				if (q && blob.indexOf(q) < 0) return;
				n++;
				tbody.appendChild(E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ it.dest_ip ]),
					E('td', { class: 'td' }, [ it.dest_port ]),
					E('td', { class: 'td' }, [ it.proto ]),
					E('td', { class: 'td' }, [ wanLabel(it.src_wan) ]),
					E('td', { class: 'td' }, [ it.src_dport ]),
					E('td', { class: 'td' }, [ groupLabel(it.src_group) ]),
					E('td', { class: 'td' }, [ it.name ]),
					E('td', { class: 'td' }, [ it.enabled ? _('Enabled') : _('Disabled') ]),
					E('td', { class: 'td' }, [
						E('a', { href: '#', click: function (ev) { ev.preventDefault(); showEdit(it); } }, [ _('Edit') ]), ' ',
						E('a', {
							href: '#', click: function (ev) {
								ev.preventDefault();
								showEdit(Object.assign({}, it, { name: (it.name || 'pm') + '-copy' }));
							}
						}, [ _('Copy') ]), ' ',
						E('a', {
							href: '#', click: function (ev) {
								ev.preventDefault();
								(it.enabled ? callDis : callEn)(it.name).then(function () { location.reload(); });
							}
						}, [ it.enabled ? _('Disable') : _('Enable') ]), ' ',
						E('a', {
							href: '#', class: 'cbi-button-remove', click: function (ev) {
								ev.preventDefault();
								if (!confirm(_('Delete %s?').format(it.name))) return;
								callDel(it.name).then(function () { location.reload(); });
							}
						}, [ _('Delete') ])
					])
				]));
			});
			if (!n) {
				tbody.appendChild(E('tr', { class: 'tr' }, [
					E('td', { class: 'td cbi-empty', colspan: 9 }, [ _('No port mappings.') ])
				]));
			}
		}

		filter.addEventListener('change', renderRows);
		search.addEventListener('input', renderRows);

		var map = E('div', { class: 'cbi-map' }, [
			E('h2', { name: 'content' }, [ _('Port Mapping') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Forward external ports to internal hosts. Use IP groups to restrict source addresses.')
			]),
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, [ _('Mappings') ]),
				E('div', { class: 'cbi-section-actions' }, [
					filter, ' ', search, ' ',
					E('button', {
						class: 'cbi-button cbi-button-add',
						click: function () { showEdit(null); }
					}, [ _('Add') ])
				]),
				E('div', { class: 'cbi-section-node' }, [
					E('table', { class: 'table cbi-section-table' }, [
						E('thead', {}, [ E('tr', { class: 'tr table-titles' }, [
							E('th', { class: 'th' }, [ _('Internal address') ]),
							E('th', { class: 'th' }, [ _('Internal port') ]),
							E('th', { class: 'th' }, [ _('Protocol') ]),
							E('th', { class: 'th' }, [ _('External address') ]),
							E('th', { class: 'th' }, [ _('External port') ]),
							E('th', { class: 'th' }, [ _('Allow-access IP') ]),
							E('th', { class: 'th' }, [ _('Comment') ]),
							E('th', { class: 'th' }, [ _('State') ]),
							E('th', { class: 'th' }, [ _('Actions') ])
						]) ]),
						tbody
					])
				])
			]),
			editBox
		]);

		renderRows();
		return map;
	}
});
