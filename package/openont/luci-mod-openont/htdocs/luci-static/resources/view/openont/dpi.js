'use strict';
'require view';
'require rpc';

var callDpi = rpc.declare({ object: 'openont', method: 'dpi_status', expect: { '': {} } });

function yn(v) {
	return v ? _('Yes') : _('No');
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return callDpi().catch(function () { return {}; });
	},

	render: function (data) {
		var dpi = data || {};
		var statusNode = E('div', { class: 'cbi-section-node' });

		function renderStatus(d) {
			dpi = d || {};
			statusNode.innerHTML = '';
			statusNode.appendChild(E('table', { class: 'table' }, [
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('DPI engine') ]),
					E('td', { class: 'td' }, [ dpi.engine || dpi.classifier || '—' ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('DPI binary installed') ]),
					E('td', { class: 'td' }, [ yn(!!dpi.binary_present) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('DPI running') ]),
					E('td', { class: 'td' }, [ yn(!!dpi.dpi_running) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('DPI mode') ]),
					E('td', { class: 'td' }, [ dpi.dpi_mode || '—' ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('DNS classify running') ]),
					E('td', { class: 'td' }, [ yn(!!dpi.classify_running) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('IP class map entries') ]),
					E('td', { class: 'td' }, [ String(dpi.map_entries != null ? dpi.map_entries : 0) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('DNS log present') ]),
					E('td', { class: 'td' }, [ yn(!!dpi.dns_log_ok) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Flows seen') ]),
					E('td', { class: 'td' }, [ String(dpi.flows_seen != null ? dpi.flows_seen : 0) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Flows classified') ]),
					E('td', { class: 'td' }, [ String(dpi.flows_classified != null ? dpi.flows_classified : 0) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Labeled flow entries') ]),
					E('td', { class: 'td' }, [ String(dpi.flow_entries != null ? dpi.flow_entries : 0) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Queue packets') ]),
					E('td', { class: 'td' }, [ String(dpi.queue_pkts != null ? dpi.queue_pkts : 0) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Queue drops') ]),
					E('td', { class: 'td' }, [ String(dpi.queue_drops != null ? dpi.queue_drops : 0) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Last sample classified') ]),
					E('td', { class: 'td' }, [
						String(dpi.classified_ratio != null ? dpi.classified_ratio : 0) + '%'
					])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Last sample unclassified') ]),
					E('td', { class: 'td' }, [
						String(dpi.unknown_ratio != null ? dpi.unknown_ratio : 0) + '%'
					])
				])
			]));
		}

		renderStatus(dpi);

		return E('div', { class: 'cbi-map' }, [
			E('h2', { name: 'content' }, [ _('Application DPI') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Traffic distribution on the overview uses deep packet inspection (TLS SNI, HTTP Host, L7 signatures) via NFQUEUE. Flow offload may reduce classification coverage for already-offloaded flows.')
			]),
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, [ _('Status') ]),
				E('div', { class: 'cbi-section-actions' }, [
					E('button', {
						class: 'cbi-button',
						click: function () {
							callDpi().catch(function () { return {}; }).then(function (d) {
								renderStatus(d);
							});
						}
					}, [ _('Refresh') ])
				]),
				statusNode
			])
		]);
	}
});
