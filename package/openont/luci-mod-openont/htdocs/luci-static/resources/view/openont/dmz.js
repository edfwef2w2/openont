'use strict';
'require view';
'require openont.rpc-helper as rpcHelper';
'require openont.crud-table as CRUDTable';

var dmz = rpcHelper.declareCrud('openont', 'dmz', {
	list: { expect: { '': {} } },
	add: {
		params: [ 'name', 'dest_ip', 'enabled', 'excl_proto', 'excl_port' ]
	},
	del: { params: [ 'name' ] },
	enable: { params: [ 'name' ] },
	disable: { params: [ 'name' ] }
});

function wanLabel(v) {
	return (!v || v === 'all') ? _('All WAN') : v;
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return dmz.list();
	},

	render: function (data) {
		return new CRUDTable.Table({
			title: _('DMZ Host'),
			description: _('Expose an internal host on WAN. Only one enabled DMZ host is recommended.'),
			sectionTitle: _('Hosts'),
			emptyText: _('No DMZ hosts configured.'),
			getRows: function (d) {
				return (d && d.items) || [];
			},
			columns: [
				{
					key: 'src_wan',
					label: _('External address'),
					format: function (row) { return wanLabel(row.src_wan); }
				},
				{ key: 'dest_ip', label: _('Internal address') },
				{ key: 'excl_proto', label: _('Exclude protocol') },
				{ key: 'excl_port', label: _('Exclude ports') },
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
				{
					key: 'src_wan_static',
					label: _('External address'),
					type: 'static',
					value: _('All WAN')
				},
				{ key: 'dest_ip', label: _('Internal address'), type: 'text' },
				{
					key: 'excl_proto',
					label: _('Exclude protocol'),
					type: 'select',
					options: [
						[ '', _('None') ],
						[ 'tcp', 'TCP' ],
						[ 'udp', 'UDP' ],
						[ 'tcp+udp', 'TCP+UDP' ]
					]
				},
				{
					key: 'excl_port',
					label: _('Exclude ports'),
					type: 'text',
					placeholder: _('e.g. 22,80')
				}
			],
			defaults: {
				name: '', dest_ip: '', enabled: 1, excl_proto: '', excl_port: ''
			},
			formTitle: function () {
				return _('DMZ Host');
			},
			actions: {
				save: function (v) {
					var n = v.name || ('dmz-' + (v.dest_ip || ''));
					return dmz.add(n, v.dest_ip || '', '1', v.excl_proto || '', v.excl_port || '');
				},
				delete: function (row) {
					return dmz.del(row.name);
				},
				enable: function (row) {
					return dmz.enable(row.name);
				},
				disable: function (row) {
					return dmz.disable(row.name);
				}
			},
			rowActions: [
				{ id: 'edit' },
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
