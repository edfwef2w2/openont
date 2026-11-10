'use strict';
'require view';
'require rpc';
'require openont.crud-table as CRUDTable';
'require openont.rpc-helper as rpcHelper';

var callList = rpc.declare({ object: 'openont', method: 'dns_accel_list', expect: { '': {} } });
var callCfg = rpc.declare({
	object: 'openont',
	method: 'dns_accel_cfg',
	params: [ 'enabled', 'sni', 'sni_name' ]
});
var callCa = rpc.declare({ object: 'openont', method: 'dns_ca', expect: { '': {} } });

var dom = rpcHelper.declareCrud('openont', 'dns_accel', {
	list: { method: 'dns_accel_list', expect: { '': {} } },
	set: { params: [ 'id', 'domain', 'enabled' ] },
	del: { params: [ 'id' ] }
});

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return callList();
	},

	render: function (data) {
		var st = data || {};
		var err = E('div', { class: 'alert-message', style: 'display:none' });
		var enabled = E('input', { type: 'checkbox', id: 'accel-en' });
		if (st.accel_enabled)
			enabled.checked = true;
		var sni = E('select', { id: 'accel-sni' }, [
			E('option', { value: 'keep', selected: st.accel_sni === 'keep' ? 'selected' : null }, [ _('Keep original SNI') ]),
			E('option', { value: 'omit', selected: !st.accel_sni || st.accel_sni === 'omit' ? 'selected' : null }, [ _('Omit SNI') ]),
			E('option', { value: 'replace', selected: st.accel_sni === 'replace' ? 'selected' : null }, [ _('Replace SNI') ])
		]);
		var sniName = E('input', { type: 'text', id: 'accel-sni-name', value: st.accel_sni_name || '' });

		var table = new CRUDTable.Table({
			title: _('Accelerated names'),
			description: _('Listed names resolve to this gateway. TLS for those names is terminated here and opened again toward the real address.'),
			sectionTitle: _('Names'),
			emptyText: _('No accelerated names.'),
			getRows: function (d) { return (d && d.domains) || []; },
			columns: [
				{ key: 'domain', label: _('Domain') },
				{
					key: 'enabled',
					label: _('Enabled'),
					format: function (row) { return row.enabled ? _('Enabled') : _('Disabled'); }
				}
			],
			fields: [
				{ key: 'domain', label: _('Domain'), type: 'text' },
				{
					key: 'enabled',
					label: _('Enabled'),
					type: 'select',
					options: [ [ '1', _('Enabled') ], [ '0', _('Disabled') ] ],
					deserialize: function (row) { return row.enabled ? '1' : '0'; }
				}
			],
			defaults: { domain: '', enabled: '1' },
			formTitle: function (row) { return row && row.id ? _('Edit domain') : _('Add domain'); },
			actions: {
				save: function (v, row) { return dom.set((row && row.id) || '', v.domain || '', v.enabled || '1'); },
				delete: function (row) { return dom.del(row.id); }
			}
		});

		return E('div', {}, [
			E('div', { class: 'cbi-map' }, [
				E('h2', { name: 'content' }, [ _('Web Acceleration') ]),
				E('div', { class: 'cbi-map-descr' }, [
					_('Acceleration answers listed names with this gateway LAN address and terminates TLS on the gateway. Only listed names are intercepted. Each client must trust the gateway certificate. The management HTTPS listener moves to a local port while acceleration is on.')
				]),
				err,
				E('div', { class: 'cbi-section' }, [
					E('h3', {}, [ _('Settings') ]),
					E('div', { class: 'cbi-value' }, [
						E('label', { class: 'cbi-value-title' }, [ _('Enabled') ]),
						E('div', { class: 'cbi-value-field' }, [ enabled ])
					]),
					E('div', { class: 'cbi-value' }, [
						E('label', { class: 'cbi-value-title' }, [ _('SNI policy') ]),
						E('div', { class: 'cbi-value-field' }, [ sni ])
					]),
					E('div', { class: 'cbi-value' }, [
						E('label', { class: 'cbi-value-title' }, [ _('Replacement SNI') ]),
						E('div', { class: 'cbi-value-field' }, [ sniName ])
					]),
					E('div', { class: 'cbi-value-description' }, [
						_('Keep checks the server name. Omit and Replace still require a public certificate chain, and do not require that name to match the original site.')
					]),
					E('div', { class: 'cbi-page-actions' }, [
						E('button', {
							class: 'cbi-button cbi-button-apply',
							click: function () {
								err.style.display = 'none';
								callCfg(enabled.checked ? '1' : '0', sni.value, sniName.value || '').then(function (res) {
									if (res && res.ok === false) {
										err.style.display = '';
										err.textContent = res.error || _('Failed');
										return;
									}
									location.reload();
								});
							}
						}, [ _('Save & Apply') ]),
						' ',
						E('button', {
							class: 'cbi-button',
							click: function () {
								err.style.display = 'none';
								callCa().then(function (res) {
									if (!res || !res.pem) {
										err.style.display = '';
										err.textContent = (res && res.error) || _('Certificate is not ready. Enable acceleration first.');
										return;
									}
									var blob = new Blob([ res.pem ], { type: 'application/x-x509-ca-cert' });
									var a = E('a', {
										href: URL.createObjectURL(blob),
										download: 'openont-dns-ca.crt'
									});
									document.body.appendChild(a);
									a.click();
									document.body.removeChild(a);
								});
							}
						}, [ _('Download CA') ])
					])
				])
			]),
			table.render(st)
		]);
	}
});
