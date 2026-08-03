'use strict';
'require view';
'require rpc';

var callDetect = rpc.declare({ object: 'openont', method: 'offload_detect', expect: { '': {} } });
var callSet = rpc.declare({ object: 'openont', method: 'offload_set', params: [ 'mode' ] });
var callDpi = rpc.declare({ object: 'openont', method: 'dpi_status', expect: { '': {} } });

var MODES = [ 'off', 'software', 'hardware' ];

function modeLabel(m) {
	switch (m) {
	case 'off': return _('Off');
	case 'software': return _('Software only');
	case 'hardware': return _('Software + hardware');
	default: return m || '—';
	}
}

function yn(v) {
	return v ? _('Yes') : _('No');
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return Promise.all([
			callDetect(),
			callDpi().catch(function () { return {}; })
		]);
	},

	render: function (data) {
		var state = data[0] || {};
		var dpi = data[1] || {};
		var err = E('div', { class: 'alert-message', style: 'display:none' });
		var statusNode = E('div', { class: 'cbi-section-node' });
		var radioBox = E('div', { class: 'cbi-section-node' });
		var dpiNode = E('div', { class: 'cbi-section-node' });

		function modeDisabled(m) {
			if (m === 'software' && !state.software_supported) return true;
			if (m === 'hardware' && (!state.software_supported || !state.hardware_supported)) return true;
			return false;
		}

		function renderDpi(d) {
			dpi = d || {};
			dpiNode.innerHTML = '';
			dpiNode.appendChild(E('div', { class: 'cbi-map-descr' }, [
				_('Traffic distribution on the overview uses deep packet inspection (TLS SNI, HTTP Host, L7 signatures) via NFQUEUE. Flow offload may reduce classification coverage for already-offloaded flows.')
			]));
			dpiNode.appendChild(E('table', { class: 'table' }, [
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

		function renderStatus(d) {
			state = d || {};
			statusNode.innerHTML = '';
			statusNode.appendChild(E('table', { class: 'table' }, [
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Architecture') ]),
					E('td', { class: 'td' }, [ state.arch || '—' ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Software offload') ]),
					E('td', { class: 'td' }, [
						state.software_supported ? _('Available') : _('Not available')
					])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Hardware offload') ]),
					E('td', { class: 'td' }, [
						state.hardware_supported ? _('Available') : _('Not available')
					])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Current') ]),
					E('td', { class: 'td' }, [ modeLabel(state.current) ])
				]),
				E('tr', { class: 'tr' }, [
					E('td', { class: 'td' }, [ _('Recommended') ]),
					E('td', { class: 'td' }, [ modeLabel(state.recommend) ])
				])
			]));
			var warns = state.warnings || [];
			if (warns.length) {
				var ul = E('ul', {});
				warns.forEach(function (w) { ul.appendChild(E('li', {}, [ w ])); });
				statusNode.appendChild(ul);
			}
			MODES.forEach(function (m) {
				var r = document.getElementById('offload-mode-' + m);
				if (r) {
					r.checked = state.current === m;
					r.disabled = modeDisabled(m);
				}
			});
		}

		function buildRadios() {
			radioBox.innerHTML = '';
			MODES.forEach(function (m) {
				radioBox.appendChild(E('div', { class: 'cbi-value' }, [
					E('label', { class: 'cbi-value-title' }, [
						E('input', {
							type: 'radio',
							name: 'offload_mode',
							id: 'offload-mode-' + m,
							value: m,
							checked: state.current === m ? 'checked' : null,
							disabled: modeDisabled(m) ? 'disabled' : null
						}),
						' ',
						modeLabel(m)
					])
				]));
			});
		}

		buildRadios();
		renderStatus(state);
		renderDpi(dpi);

		return E('div', { class: 'cbi-map' }, [
			E('h2', { name: 'content' }, [ _('Flow Offload') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Configure firewall flow offloading to improve forwarding performance.')
			]),
			err,
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, [ _('Capability') ]),
				E('div', { class: 'cbi-section-actions' }, [
					E('button', {
						class: 'cbi-button',
						click: function () {
							Promise.all([
								callDetect(),
								callDpi().catch(function () { return {}; })
							]).then(function (res) {
								renderStatus(res[0]);
								buildRadios();
								renderStatus(res[0]);
								renderDpi(res[1]);
								err.style.display = 'none';
							});
						}
					}, [ _('Refresh') ])
				]),
				statusNode
			]),
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, [ _('Application DPI') ]),
				dpiNode
			]),
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, [ _('Mode') ]),
				E('div', { class: 'cbi-section-descr' }, [
					_('Applying reloads the firewall and may briefly interrupt traffic.')
				]),
				radioBox,
				E('div', { class: 'cbi-page-actions' }, [
					E('button', {
						class: 'cbi-button cbi-button-apply',
						click: function () {
							var sel = document.querySelector('input[name="offload_mode"]:checked');
							if (!sel) return;
							callSet(sel.value).then(function (res) {
								if (res && res.ok === false) {
									err.style.display = '';
									err.textContent = res.error || _('Failed');
								} else {
									err.style.display = 'none';
									return callDetect().then(function (d) {
										renderStatus(d);
										buildRadios();
										renderStatus(d);
									});
								}
							}).catch(function (e) {
								err.style.display = '';
								err.textContent = String(e);
							});
						}
					}, [ _('Save & Apply') ]),
					E('button', {
						class: 'cbi-button',
						click: function () {
							var rec = state.recommend || 'software';
							callSet(rec).then(function (res) {
								if (res && res.ok === false) {
									err.style.display = '';
									err.textContent = res.error || _('Failed');
								} else {
									err.style.display = 'none';
									return callDetect().then(function (d) {
										renderStatus(d);
										buildRadios();
										renderStatus(d);
									});
								}
							});
						}
					}, [ _('Apply recommended') ])
				])
			])
		]);
	}
});
