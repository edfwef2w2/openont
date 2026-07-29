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
		var root = E('div', { class: 'o-page' });
		var filter = E('select', { class: 'o-input' }, [
			E('option', { value: '' }, [ _('All') ]),
			E('option', { value: '1' }, [ _('Enabled') ]),
			E('option', { value: '0' }, [ _('Disabled') ])
		]);
		var search = E('input', { class: 'o-input', placeholder: _('Internal address / ports / comment') });
		var editBox = E('div', { class: 'o-card', style: 'display:none;margin-top:12px' });
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
			var nameIn = E('input', { class: 'o-input', value: it.name || '' });
			var dip = E('input', { class: 'o-input', value: it.dest_ip || '' });
			var dport = E('input', { class: 'o-input', value: it.dest_port || '' });
			var sport = E('input', { class: 'o-input', value: it.src_dport || '' });
			var proto = E('select', { class: 'o-input' }, [
				E('option', { value: 'tcp' }, [ 'tcp' ]),
				E('option', { value: 'udp' }, [ 'udp' ]),
				E('option', { value: 'tcp+udp' }, [ 'tcp+udp' ])
			]);
			proto.value = (it.proto || 'tcp').replace(/ /g, '+');
			var grp = E('select', { class: 'o-input' }, [ E('option', { value: '' }, [ _('Any') ]) ]);
			groups.forEach(function (g) {
				grp.appendChild(E('option', { value: g.id }, [ g.name + ' (' + (g.entries || []).length + ')' ]));
			});
			if (it.src_group) grp.value = it.src_group;
			var prev = E('div', { class: 'o-muted' });
			function refreshPrev() {
				var g = groups.filter(function (x) { return x.id === grp.value; })[0];
				prev.textContent = g
					? (_('Members') + ': ' + (g.entries || []).join(', '))
					: _('No source IP restriction');
			}
			grp.addEventListener('change', refreshPrev);
			refreshPrev();
			var err = E('div', { class: 'o-alert', style: 'display:none' });
			editBox.appendChild(E('div', { class: 'o-card-title' }, [ it.name ? _('Edit port mapping') : _('Add port mapping') ]));
			editBox.appendChild(err);
			[
				[ _('Comment / name'), nameIn ],
				[ _('Internal address') + ' *', dip ],
				[ _('Internal port') + ' *', dport ],
				[ _('Protocol') + ' *', proto ],
				[ _('External address'), E('input', { class: 'o-input', value: _('All WAN'), disabled: 'disabled' }) ],
				[ _('External port') + ' *', sport ],
				[ _('Allow-access IP'), grp ]
			].forEach(function (row) {
				editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ row[0] ]), row[1] ]));
			});
			editBox.appendChild(prev);
			editBox.appendChild(E('p', {}, [
				E('a', { href: L.url('admin/network/openont-ipgroup') }, [ _('Manage IP groups') ]),
				' · CLI: openont-nat portmap-add …'
			]));
			editBox.appendChild(E('div', { class: 'o-form-actions' }, [
				E('button', {
					class: 'o-btn o-btn-primary',
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
				}, [ _('Save') ]),
				E('button', { class: 'o-btn', click: function () { editBox.style.display = 'none'; } }, [ _('Cancel') ])
			]));
		}

		function renderRows() {
			tbody.innerHTML = '';
			var q = search.value.trim().toLowerCase();
			var f = filter.value;
			items.forEach(function (it) {
				if (f !== '' && String(it.enabled ? 1 : 0) !== f) return;
				var blob = [ it.dest_ip, it.dest_port, it.src_dport, it.name, it.proto ].join(' ').toLowerCase();
				if (q && blob.indexOf(q) < 0) return;
				tbody.appendChild(E('tr', {}, [
					E('td', {}, [ it.dest_ip ]),
					E('td', {}, [ it.dest_port ]),
					E('td', {}, [ it.proto ]),
					E('td', {}, [ wanLabel(it.src_wan) ]),
					E('td', {}, [ it.src_dport ]),
					E('td', {}, [ groupLabel(it.src_group) ]),
					E('td', {}, [ it.name ]),
					E('td', {}, [
						E('span', { class: it.enabled ? 'colorG' : 'colorR' }, [
							it.enabled ? _('Enabled') : _('Disabled')
						])
					]),
					E('td', { class: 'o-ops' }, [
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
							href: '#', style: 'color:#fe6f73', click: function (ev) {
								ev.preventDefault();
								if (!confirm(_('Delete %s?').format(it.name))) return;
								callDel(it.name).then(function () { location.reload(); });
							}
						}, [ _('Delete') ])
					])
				]));
			});
		}

		filter.addEventListener('change', renderRows);
		search.addEventListener('input', renderRows);

		root.appendChild(E('div', { class: 'o-toolbar' }, [
			E('h3', { style: 'margin:0;margin-right:auto' }, [ _('Port Mapping') ]),
			filter, search,
			E('button', { class: 'o-btn o-btn-primary', click: function () { showEdit(null); } }, [ _('Add') ])
		]));

		var table = E('table', { class: 'o-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ _('Internal address') ]), E('th', {}, [ _('Internal port') ]), E('th', {}, [ _('Protocol') ]),
				E('th', {}, [ _('External address') ]), E('th', {}, [ _('External port') ]), E('th', {}, [ _('Allow-access IP') ]),
				E('th', {}, [ _('Comment') ]), E('th', {}, [ _('State') ]), E('th', {}, [ _('Actions') ])
			]) ]),
			tbody
		]);
		root.appendChild(E('div', { class: 'o-card' }, [ table ]));
		root.appendChild(editBox);
		root.appendChild(E('div', { class: 'o-help' }, [
			_('Hint: keep the same number of internal and external port entries when using ranges. Allow-access IP may use an IP group.')
		]));
		renderRows();
		return root;
	}
});
