'use strict';
'require view';
'require rpc';

var callLog = rpc.declare({
	object: 'openont',
	method: 'dns_log',
	params: [ 'limit', 'kind' ],
	expect: { '': {} }
});

function fmtTime(ts) {
	var n = parseInt(ts, 10);
	if (!n)
		return ts || '—';
	try {
		return new Date(n * 1000).toLocaleString();
	} catch (e) {
		return String(ts);
	}
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return callLog('200', 'all');
	},

	render: function (data) {
		var tbody = E('tbody', {});
		var filter = E('select', {}, [
			E('option', { value: 'all' }, [ _('All') ]),
			E('option', { value: 'block' }, [ _('Blocked') ]),
			E('option', { value: 'accel' }, [ _('Accelerated') ])
		]);

		function fill(rows) {
			tbody.innerHTML = '';
			rows = rows || [];
			if (!rows.length) {
				tbody.appendChild(E('tr', { class: 'tr' }, [
					E('td', { class: 'td', colspan: '6' }, [ _('No queries yet.') ])
				]));
				return;
			}
			rows.forEach(function (row) {
				tbody.appendChild(E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ fmtTime(row.time) ]),
					E('td', { class: 'td' }, [ row.client || '—' ]),
					E('td', { class: 'td' }, [ row.name || '—' ]),
					E('td', { class: 'td' }, [ row.qtype || '—' ]),
					E('td', { class: 'td' }, [ row.action || '—' ]),
					E('td', { class: 'td' }, [ row.detail || '—' ])
				]));
			});
		}

		fill((data && data.items) || []);

		return E('div', { class: 'cbi-map' }, [
			E('h2', { name: 'content' }, [ _('Query Log') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Recent decisions from the DNS service. Blocked and accelerated names are not written into the application class map.')
			]),
			E('div', { class: 'cbi-section' }, [
				E('div', { class: 'cbi-section-actions' }, [
					filter,
					' ',
					E('button', {
						class: 'cbi-button',
						click: function () {
							callLog('200', filter.value).then(function (res) {
								fill((res && res.items) || []);
							});
						}
					}, [ _('Refresh') ])
				]),
				E('div', { class: 'cbi-section-node' }, [
					E('table', { class: 'table cbi-section-table' }, [
						E('thead', {}, [
							E('tr', { class: 'tr table-titles' }, [
								E('th', { class: 'th' }, [ _('Time') ]),
								E('th', { class: 'th' }, [ _('Client') ]),
								E('th', { class: 'th' }, [ _('Name') ]),
								E('th', { class: 'th' }, [ _('Type') ]),
								E('th', { class: 'th' }, [ _('Action') ]),
								E('th', { class: 'th' }, [ _('Detail') ])
							])
						]),
						tbody
					])
				])
			])
		]);
	}
});
