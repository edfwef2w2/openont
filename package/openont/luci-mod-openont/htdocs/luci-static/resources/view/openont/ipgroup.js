'use strict';
'require view';
'require openont.rpc-helper as rpcHelper';
'require openont.crud-table as CRUDTable';

var ig = rpcHelper.declareCrud('openont', 'ipgroup', {
	list: { expect: { '': {} } },
	set: { params: [ 'id', 'name', 'comment', 'entries' ] },
	del: { params: [ 'id' ] }
});

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return ig.list();
	},

	render: function (data) {
		return new CRUDTable({
			title: _('IP Groups'),
			description: _('Named lists of IP addresses or networks used by port mapping access control.'),
			sectionTitle: _('Groups'),
			emptyText: _('No groups yet. Port mapping can use a group to restrict source IPs.'),
			getRows: function (d) {
				return (d && d.groups) || [];
			},
			columns: [
				{ key: 'id', label: 'ID' },
				{ key: 'name', label: _('Name') },
				{
					key: 'entries',
					label: _('Members'),
					format: function (row) {
						var e = row.entries || [];
						return String(e.length) + ' · ' + e.slice(0, 3).join(', ') +
							(e.length > 3 ? '…' : '');
					}
				},
				{
					key: 'refs',
					label: _('References'),
					format: function (row) {
						return _('%d mapping(s)').format(row.refs || 0);
					}
				},
				{ key: 'comment', label: _('Comment') }
			],
			fields: [
				{ key: 'id', label: 'ID', type: 'text' },
				{ key: 'name', label: _('Name'), type: 'text' },
				{ key: 'comment', label: _('Comment'), type: 'text' },
				{
					key: 'entries',
					label: _('Members'),
					type: 'textarea',
					rows: 6,
					placeholder: _('One IP or CIDR per line'),
					deserialize: function (row) {
						return (row.entries || []).join('\n');
					},
					serialize: function (v) {
						return String(v || '').split(/[\s,]+/).filter(Boolean).join(' ');
					}
				}
			],
			defaults: { id: '', name: '', comment: '', entries: [] },
			formTitle: function (row) {
				return row && row.id ? _('Edit IP group') : _('Add IP group');
			},
			actions: {
				save: function (v) {
					var id = v.id || v.name;
					return ig.set(id, v.name || id, v.comment || '', v.entries || '');
				},
				delete: function (row) {
					return ig.del(row.id);
				}
			},
			rowActions: [
				{ id: 'edit' },
				{
					id: 'delete',
					guard: function (row) {
						return !(row.refs > 0);
					},
					guardMessage: function (row) {
						return _('This group is still referenced by %d port mapping(s). Update those first.')
							.format(row.refs);
					},
					confirm: function (row) {
						return _('Delete group %s?').format(row.id);
					}
				}
			]
		}).render(data);
	}
});
