'use strict';
'require view';
'require openont.crud-table as CRUDTable';
'require openont.rpc-helper as rpcHelper';

var flt = rpcHelper.declareCrud('openont', 'dns_filter', {
	list: { expect: { '': {} } },
	set: { params: [ 'id', 'text', 'client' ] },
	del: { params: [ 'id' ] }
});

var lists = rpcHelper.declareMap('openont', {
	set: { method: 'dns_blocklist_set', params: [ 'id', 'name', 'url', 'enabled', 'refresh' ] },
	del: { method: 'dns_blocklist_del', params: [ 'id' ] }
});

var rw = rpcHelper.declareMap('openont', {
	set: { method: 'dns_rewrite_set', params: [ 'id', 'pattern', 'match', 'type', 'value' ] },
	del: { method: 'dns_rewrite_del', params: [ 'id' ] }
});

var clients = rpcHelper.declareMap('openont', {
	set: { method: 'dns_client_set', params: [ 'id', 'address' ] },
	del: { method: 'dns_client_del', params: [ 'id' ] }
});

var enField = {
	key: 'enabled',
	label: _('Enabled'),
	type: 'select',
	options: [ [ '1', _('Enabled') ], [ '0', _('Disabled') ] ],
	deserialize: function (row) { return row.enabled ? '1' : '0'; }
};

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return flt.list();
	},

	render: function (data) {
		var rules = new CRUDTable.Table({
			title: _('Filtering'),
			description: _('Whitelist rules win over an equal or broader block. Supported syntax: ||domain^ (with subdomains), |domain^ (exact), @@ exceptions, 0.0.0.0 host, /regex/, and a plain domain.'),
			sectionTitle: _('Rules'),
			emptyText: _('No manual rules.'),
			getRows: function (d) { return (d && d.rules) || []; },
			toolbar: { add: true, search: true, searchKeys: [ 'text', 'client' ] },
			columns: [
				{ key: 'text', label: _('Rule') },
				{ key: 'client', label: _('Client') }
			],
			fields: [
				{ key: 'text', label: _('Rule'), type: 'text', placeholder: '||ads.example^' },
				{ key: 'client', label: _('Client'), type: 'text', placeholder: _('Optional IP') }
			],
			defaults: { text: '', client: '' },
			formTitle: function (row) { return row && row.id ? _('Edit rule') : _('Add rule'); },
			actions: {
				save: function (v, row) { return flt.set((row && row.id) || '', v.text || '', v.client || ''); },
				delete: function (row) { return flt.del(row.id); }
			}
		});

		var subs = new CRUDTable.Table({
			title: _('Blocklists'),
			description: _('Downloaded lists use the same rule syntax. A failed download keeps the previous copy.'),
			sectionTitle: _('Subscriptions'),
			emptyText: _('No blocklists.'),
			getRows: function (d) { return (d && d.blocklists) || []; },
			columns: [
				{ key: 'name', label: _('Name') },
				{ key: 'url', label: _('URL') },
				{ key: 'refresh', label: _('Refresh') },
				{
					key: 'enabled',
					label: _('Enabled'),
					format: function (row) { return row.enabled ? _('Enabled') : _('Disabled'); }
				}
			],
			fields: [
				{ key: 'name', label: _('Name'), type: 'text' },
				{ key: 'url', label: _('URL'), type: 'text' },
				{ key: 'refresh', label: _('Refresh'), type: 'text', placeholder: '24h' },
				enField
			],
			defaults: { name: '', url: '', refresh: '24h', enabled: '1' },
			formTitle: function (row) { return row && row.id ? _('Edit blocklist') : _('Add blocklist'); },
			actions: {
				save: function (v, row) {
					return lists.set((row && row.id) || '', v.name || '', v.url || '', v.enabled || '0', v.refresh || '24h');
				},
				delete: function (row) { return lists.del(row.id); }
			}
		});

		var rewrites = new CRUDTable.Table({
			title: _('Rewrites'),
			description: _('A matching rewrite is answered locally and is not filtered.'),
			sectionTitle: _('Records'),
			emptyText: _('No rewrites.'),
			getRows: function (d) { return (d && d.rewrites) || []; },
			columns: [
				{ key: 'pattern', label: _('Domain') },
				{ key: 'match', label: _('Match') },
				{ key: 'type', label: _('Type') },
				{ key: 'value', label: _('Value') }
			],
			fields: [
				{ key: 'pattern', label: _('Domain'), type: 'text' },
				{
					key: 'match',
					label: _('Match'),
					type: 'select',
					options: [ [ 'suffix', _('Domain and subdomains') ], [ 'exact', _('Exact name') ] ]
				},
				{
					key: 'type',
					label: _('Type'),
					type: 'select',
					options: [ [ 'A', 'A' ], [ 'AAAA', 'AAAA' ], [ 'CNAME', 'CNAME' ] ]
				},
				{ key: 'value', label: _('Value'), type: 'text' }
			],
			defaults: { pattern: '', match: 'suffix', type: 'A', value: '' },
			formTitle: function (row) { return row && row.id ? _('Edit rewrite') : _('Add rewrite'); },
			actions: {
				save: function (v, row) {
					return rw.set((row && row.id) || '', v.pattern || '', v.match || 'suffix', v.type || 'A', v.value || '');
				},
				delete: function (row) { return rw.del(row.id); }
			}
		});

		var bypass = new CRUDTable.Table({
			title: _('Filtering bypass'),
			description: _('These clients still use rewrites, acceleration and upstream groups, but skip block and allow rules.'),
			sectionTitle: _('Clients'),
			emptyText: _('No bypass clients.'),
			getRows: function (d) { return (d && d.clients) || []; },
			columns: [
				{ key: 'address', label: _('Address') }
			],
			fields: [
				{ key: 'address', label: _('Address'), type: 'text' }
			],
			defaults: { address: '' },
			formTitle: function (row) { return row && row.id ? _('Edit client') : _('Add client'); },
			actions: {
				save: function (v, row) { return clients.set((row && row.id) || '', v.address || ''); },
				delete: function (row) { return clients.del(row.id); }
			}
		});

		return E('div', {}, [
			rules.render(data),
			subs.render(data),
			rewrites.render(data),
			bypass.render(data)
		]);
	}
});
