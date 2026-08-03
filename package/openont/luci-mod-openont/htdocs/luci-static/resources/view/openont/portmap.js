'use strict';
'require view';
'require openont.rpc-helper as rpcHelper';
'require openont.crud-table as CRUDTable';

var pm = rpcHelper.declareCrud('openont', 'portmap', {
	list: { expect: { '': {} } },
	add: {
		params: [
			'name', 'dest_ip', 'dest_port', 'proto',
			'src_dport', 'src_group', 'enabled'
		]
	},
	del: { params: [ 'name' ] },
	enable: { params: [ 'name' ] },
	disable: { params: [ 'name' ] }
});

var callGroups = rpcHelper.declareMap('openont', {
	list: { method: 'ipgroup_list', expect: { '': {} } }
}).list;

function wanLabel(v) {
	return (!v || v === 'all') ? _('All WAN') : v;
}

function groupLabel(id, groups) {
	if (!id)
		return _('Any');
	for (var i = 0; i < groups.length; i++) {
		if (groups[i].id === id)
			return groups[i].name;
	}
	return id;
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return Promise.all([ pm.list(), callGroups() ]);
	},

	render: function (data) {
		return new CRUDTable.Table({
			title: _('Port Mapping'),
			description: _('Forward external ports to internal hosts. Use IP groups to restrict source addresses.'),
			sectionTitle: _('Mappings'),
			emptyText: _('No port mappings.'),
			getRows: function (d) {
				return (d[0] && d[0].items) || [];
			},
			getContext: function (d) {
				return { groups: (d[1] && d[1].groups) || [] };
			},
			toolbar: {
				add: true,
				filterEnabled: true,
				search: true,
				searchKeys: [ 'dest_ip', 'dest_port', 'src_dport', 'name', 'proto' ]
			},
			columns: [
				{ key: 'dest_ip', label: _('Internal address') },
				{ key: 'dest_port', label: _('Internal port') },
				{ key: 'proto', label: _('Protocol') },
				{
					key: 'src_wan',
					label: _('External address'),
					format: function (row) { return wanLabel(row.src_wan); }
				},
				{ key: 'src_dport', label: _('External port') },
				{
					key: 'src_group',
					label: _('Allow-access IP'),
					format: function (row, ctx) {
						return groupLabel(row.src_group, ctx.groups || []);
					}
				},
				{ key: 'name', label: _('Comment') },
				{
					key: 'enabled',
					label: _('State'),
					format: function (row) {
						return row.enabled ? _('Enabled') : _('Disabled');
					}
				}
			],
			fields: [
				{ key: 'name', label: _('Comment / name'), type: 'text' },
				{ key: 'dest_ip', label: _('Internal address'), type: 'text' },
				{ key: 'dest_port', label: _('Internal port'), type: 'text' },
				{
					key: 'proto',
					label: _('Protocol'),
					type: 'select',
					options: [
						[ 'tcp', 'TCP' ],
						[ 'udp', 'UDP' ],
						[ 'tcp+udp', 'TCP+UDP' ]
					],
					normalizeValue: function (v) {
						return String(v || 'tcp').replace(/ /g, '+');
					}
				},
				{
					key: 'src_wan_static',
					label: _('External address'),
					type: 'static',
					value: _('All WAN')
				},
				{ key: 'src_dport', label: _('External port'), type: 'text' },
				{
					key: 'src_group',
					label: _('Allow-access IP'),
					type: 'select',
					optionsFrom: 'groups',
					optionValue: 'id',
					optionLabel: 'name',
					emptyLabel: _('Any')
				}
			],
			defaults: {
				name: '', dest_ip: '', dest_port: '', proto: 'tcp',
				src_dport: '', src_group: '', enabled: 1
			},
			formTitle: function (row) {
				return row && row.name
					? _('Edit port mapping')
					: _('Add port mapping');
			},
			afterFields: function (editBox, widgets, table) {
				var groups = (table.ctx && table.ctx.groups) || [];
				var grp = widgets.src_group;
				var prev = E('div', { class: 'cbi-section-descr' });

				function refreshPrev() {
					var id = grp ? grp.value : '';
					var g = null;
					for (var i = 0; i < groups.length; i++) {
						if (groups[i].id === id) {
							g = groups[i];
							break;
						}
					}
					prev.textContent = g
						? (_('Members') + ': ' + (g.entries || []).join(', '))
						: _('No source IP restriction');
				}

				if (grp)
					grp.addEventListener('change', refreshPrev);
				refreshPrev();
				editBox.appendChild(prev);
				editBox.appendChild(E('div', { class: 'cbi-section-descr' }, [
					E('a', {
						href: L.url('admin/network/openont-ipgroup')
					}, [ _('Manage IP groups') ])
				]));
			},
			actions: {
				save: function (v) {
					var n = v.name || ('pm-' + v.dest_ip + '-' + v.src_dport);
					return pm.add(
						n,
						v.dest_ip || '',
						v.dest_port || '',
						v.proto || 'tcp',
						v.src_dport || '',
						v.src_group || '',
						'1'
					);
				},
				delete: function (row) {
					return pm.del(row.name);
				},
				enable: function (row) {
					return pm.enable(row.name);
				},
				disable: function (row) {
					return pm.disable(row.name);
				}
			},
			rowActions: [
				{ id: 'edit' },
				{
					id: 'copy',
					transform: function (row) {
						return Object.assign({}, row, {
							name: (row.name || 'pm') + '-copy'
						});
					}
				},
				{ id: 'toggle' },
				{
					id: 'delete',
					confirm: function (row) {
						return _('Delete %s?').format(row.name);
					}
				}
			]
		}).render(data);
	}
});
