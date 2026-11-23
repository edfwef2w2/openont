'use strict';
'require view';
'require rpc';
'require openont.crud-table as CRUDTable';
'require openont.rpc-helper as rpcHelper';

var callList = rpc.declare({ object: 'openont', method: 'dns_accel_list', expect: { '': {} } });
var callCfg = rpc.declare({
	object: 'openont',
	method: 'dns_accel_cfg',
	params: [ 'enabled', 'fooling', 'ttl_mode', 'ttl', 'ttl_delta', 'repeat', 'fake_sni' ]
});

var dom = rpcHelper.declareCrud('openont', 'dns_accel', {
	list: { method: 'dns_accel_list', expect: { '': {} } },
	set: { params: [ 'id', 'domain', 'enabled' ] },
	del: { params: [ 'id' ] }
});

function row(title, field, descr) {
	return E('div', { class: 'cbi-value' }, [
		E('label', { class: 'cbi-value-title' }, [ title ]),
		E('div', { class: 'cbi-value-field' }, [
			field,
			descr ? E('div', { class: 'cbi-value-description' }, [ descr ]) : ''
		])
	]);
}

function option(value, label, current) {
	return E('option', { value: value, selected: value === current ? 'selected' : null }, [ label ]);
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return callList();
	},

	render: function (data) {
		var st = data || {};
		var ds = st.desync || {};
		var err = E('div', { class: 'alert-message', style: 'display:none' });
		var enabled = E('input', { type: 'checkbox', id: 'accel-en' });
		if (st.accel_enabled)
			enabled.checked = true;

		var fooling = E('select', { id: 'accel-fooling' }, [
			option('ttl', _('Low TTL'), st.accel_fooling || 'ttl'),
			option('badsum', _('Bad TCP checksum'), st.accel_fooling),
			option('both', _('Low TTL and bad TCP checksum'), st.accel_fooling)
		]);
		var ttlMode = E('select', { id: 'accel-ttl-mode' }, [
			option('auto', _('Automatic'), st.accel_ttl_mode || 'auto'),
			option('manual', _('Manual'), st.accel_ttl_mode)
		]);
		var ttl = E('input', { type: 'number', min: 1, max: 64, id: 'accel-ttl', value: st.accel_ttl || 5 });
		var delta = E('input', { type: 'number', min: 0, max: 10, id: 'accel-ttl-delta', value: st.accel_ttl_delta != null ? st.accel_ttl_delta : 1 });
		var repeat = E('input', { type: 'number', min: 1, max: 5, id: 'accel-repeat', value: st.accel_repeat || 1 });
		var fakeSni = E('input', { type: 'text', id: 'accel-fake-sni', value: st.accel_fake_sni || 'www.baidu.com' });

		var ttlRows = [
			row(_('TTL mode'), ttlMode,
				_('Automatic reads the hop count from the server reply and sets the decoy to expire that many hops short of the server. Manual always uses the TTL below.')),
			row(_('TTL'), ttl,
				_('Manual value, and the fallback when the hop count is unknown.')),
			row(_('TTL margin'), delta,
				_('Automatic mode: how many hops before the server the decoy expires.'))
		];

		function syncTtl() {
			var useTtl = fooling.value !== 'badsum';
			ttlRows.forEach(function (r) { r.style.display = useTtl ? '' : 'none'; });
			ttlRows[2].style.display = useTtl && ttlMode.value === 'auto' ? '' : 'none';
		}
		fooling.addEventListener('change', syncTtl);
		ttlMode.addEventListener('change', syncTtl);
		syncTtl();

		var status = st.accel_enabled
			? (ds.running
				? _('Running. Handshakes: %d, decoys sent: %d (automatic TTL %d, fixed TTL %d), errors: %d')
					.format(ds.hellos || 0, ds.fakes || 0, ds.auto_ttl || 0, ds.fixed_ttl || 0, ds.errors || 0)
				: _('Not running. Traffic passes unchanged.'))
			: _('Disabled');

		var table = new CRUDTable.Table({
			title: _('Accelerated names'),
			description: _('Addresses returned for these names (and their subdomains) are tracked. New HTTPS connections to those addresses get a decoy handshake first.'),
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
					_('Before a client sends its TLS handshake to a listed site, the gateway sends a decoy handshake for another name. The decoy is built to be seen on the way out but dropped before it reaches the server. The real handshake then leaves unchanged. DNS answers are not altered and no certificate is needed on clients.')
				]),
				err,
				E('div', { class: 'cbi-section' }, [
					E('h3', {}, [ _('Settings') ]),
					row(_('Enabled'), enabled),
					row(_('Status'), E('span', {}, [ status ])),
					row(_('Decoy drop method'), fooling,
						_('Low TTL lets the decoy expire on the way to the server. A bad checksum makes the server discard it. Using both is safer, but some networks drop bad-checksum packets before inspection.')),
					ttlRows[0],
					ttlRows[1],
					ttlRows[2],
					row(_('Repeat'), repeat, _('Decoys sent per handshake.')),
					row(_('Decoy name'), fakeSni, _('Server name carried in the decoy handshake.')),
					E('div', { class: 'cbi-page-actions' }, [
						E('button', {
							class: 'cbi-button cbi-button-apply',
							click: function () {
								err.style.display = 'none';
								callCfg(enabled.checked ? '1' : '0', fooling.value, ttlMode.value,
									String(ttl.value || ''), String(delta.value || ''),
									String(repeat.value || ''), (fakeSni.value || '').trim()).then(function (res) {
									if (res && res.ok === false) {
										err.style.display = '';
										err.textContent = res.error || _('Failed');
										return;
									}
									location.reload();
								});
							}
						}, [ _('Save & Apply') ])
					])
				])
			]),
			table.render(st)
		]);
	}
});
