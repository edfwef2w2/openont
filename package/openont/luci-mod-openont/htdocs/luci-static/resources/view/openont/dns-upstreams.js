'use strict';
'require view';
'require openont.crud-table as CRUDTable';
'require openont.rpc-helper as rpcHelper';

var up = rpcHelper.declareCrud('openont', 'dns_upstream', {
	list: { expect: { '': {} } },
	set: { params: [ 'id', 'name', 'group', 'proto', 'address', 'port', 'tls_host', 'doh_path', 'enabled' ] },
	del: { params: [ 'id' ] }
});

var dom = rpcHelper.declareCrud('openont', 'dns_domain', {
	list: { expect: { '': {} } },
	set: { params: [ 'id', 'pattern', 'match', 'group', 'nftset' ] },
	del: { params: [ 'id' ] }
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
		return Promise.all([ up.list(), dom.list() ]);
	},

	render: function (data) {
		var servers = new CRUDTable.Table({
			title: _('Upstreams'),
			description: _('DNS servers are queried by group. DoT and DoH addresses must be numeric; the TLS hostname is used for the certificate name.'),
			sectionTitle: _('Servers'),
			emptyText: _('No upstream servers.'),
			getRows: function (d) { return (d[0] && d[0].upstreams) || []; },
			columns: [
				{ key: 'name', label: _('Name') },
				{ key: 'group', label: _('Group') },
				{ key: 'proto', label: _('Protocol') },
				{ key: 'address', label: _('Address') },
				{ key: 'port', label: _('Port') },
				{
					key: 'enabled',
					label: _('Enabled'),
					format: function (row) { return row.enabled ? _('Enabled') : _('Disabled'); }
				}
			],
			fields: [
				{ key: 'name', label: _('Name'), type: 'text' },
				{ key: 'group', label: _('Group'), type: 'text', placeholder: 'default' },
				{
					key: 'proto',
					label: _('Protocol'),
					type: 'select',
					options: [ [ 'udp', 'UDP' ], [ 'tcp', 'TCP' ], [ 'dot', 'DoT' ], [ 'doh', 'DoH' ] ]
				},
				{ key: 'address', label: _('Address'), type: 'text' },
				{ key: 'port', label: _('Port'), type: 'text' },
				{ key: 'tls_host', label: _('TLS hostname'), type: 'text' },
				{ key: 'doh_path', label: _('DoH path'), type: 'text', placeholder: '/dns-query' },
				enField
			],
			defaults: { name: '', group: 'default', proto: 'udp', address: '', port: '53', tls_host: '', doh_path: '/dns-query', enabled: '1' },
			formTitle: function (row) { return row && row.id ? _('Edit upstream') : _('Add upstream'); },
			actions: {
				save: function (v, row) {
					return up.set((row && row.id) || '', v.name || '', v.group || 'default', v.proto || 'udp',
						v.address || '', v.port || '53', v.tls_host || '', v.doh_path || '/dns-query', v.enabled || '1');
				},
				delete: function (row) { return up.del(row.id); }
			},
			rowActions: [
				{ id: 'edit' },
				{ id: 'delete', confirm: function (row) { return _('Delete upstream %s?').format(row.name || row.address || ''); } }
			]
		});

		var rules = new CRUDTable.Table({
			title: _('Domain rules'),
			description: _('Longest suffix wins. The nft set is created in the named table and filled with resolved IPv4 addresses.'),
			sectionTitle: _('Rules'),
			emptyText: _('No domain rules. Unmatched names use the default group.'),
			getRows: function (d) { return (d[1] && d[1].domains) || []; },
			columns: [
				{ key: 'pattern', label: _('Domain') },
				{ key: 'match', label: _('Match') },
				{ key: 'group', label: _('Group') },
				{ key: 'nftset', label: _('nft set') }
			],
			fields: [
				{ key: 'pattern', label: _('Domain'), type: 'text' },
				{
					key: 'match',
					label: _('Match'),
					type: 'select',
					options: [ [ 'suffix', _('Domain and subdomains') ], [ 'exact', _('Exact name') ] ]
				},
				{ key: 'group', label: _('Group'), type: 'text' },
				{ key: 'nftset', label: _('nft set'), type: 'text', placeholder: 'inet/openont/example' }
			],
			defaults: { pattern: '', match: 'suffix', group: 'default', nftset: '' },
			formTitle: function (row) { return row && row.id ? _('Edit domain rule') : _('Add domain rule'); },
			actions: {
				save: function (v, row) {
					return dom.set((row && row.id) || '', v.pattern || '', v.match || 'suffix', v.group || 'default', v.nftset || '');
				},
				delete: function (row) { return dom.del(row.id); }
			}
		});

		return E('div', {}, [ servers.render(data), rules.render(data) ]);
	}
});
