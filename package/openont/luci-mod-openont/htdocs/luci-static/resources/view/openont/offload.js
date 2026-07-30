'use strict';
'require view';
'require rpc';

var callDetect = rpc.declare({ object: 'openont', method: 'offload_detect', expect: { '': {} } });
var callSet = rpc.declare({ object: 'openont', method: 'offload_set', params: [ 'mode' ] });

var MODES = [ 'off', 'software', 'hardware' ];

function modeLabel(m) {
	switch (m) {
	case 'off': return _('Off');
	case 'software': return _('Software only');
	case 'hardware': return _('Software + hardware');
	default: return m || '—';
	}
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return callDetect();
	},

	render: function (data) {
		var state = data || {};
		var err = E('div', { class: 'alert-message', style: 'display:none' });
		var statusNode = E('div', { class: 'cbi-section-node' });
		var radioBox = E('div', { class: 'cbi-section-node' });

		function modeDisabled(m) {
			if (m === 'software' && !state.software_supported) return true;
			if (m === 'hardware' && (!state.software_supported || !state.hardware_supported)) return true;
			return false;
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
							callDetect().then(function (d) {
								renderStatus(d);
								buildRadios();
								renderStatus(d);
								err.style.display = 'none';
							});
						}
					}, [ _('Refresh') ])
				]),
				statusNode
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
