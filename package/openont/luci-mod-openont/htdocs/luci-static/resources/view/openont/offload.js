'use strict';
'require view';
'require rpc';
'require poll';

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
		var self = this;
		var state = data || {};
		var root = E('div', { class: 'o-page' });
		var err = E('div', { class: 'o-alert', style: 'display:none' });
		var info = E('div', { class: 'o-muted', id: 'o-offload-info' });

		function renderInfo(d) {
			state = d || {};
			var soft = state.software_supported ? _('Available') : _('Not available');
			var hard = state.hardware_supported ? _('Available') : _('Not available');
			info.innerHTML = '';
			info.appendChild(E('div', { class: 'o-stat-bar' }, [
				E('span', {}, [ _('Architecture'), ': ', E('b', {}, [ state.arch || '—' ]) ]),
				E('span', {}, [ _('Software offload'), ': ',
					E('span', { class: state.software_supported ? 'o-badge o-badge-ok' : 'o-badge' }, [ soft ]) ]),
				E('span', {}, [ _('Hardware offload'), ': ',
					E('span', { class: state.hardware_supported ? 'o-badge o-badge-ok' : 'o-badge' }, [ hard ]) ]),
				E('span', {}, [ _('Current'), ': ', E('b', {}, [ modeLabel(state.current) ]) ]),
				E('span', {}, [ _('Recommended'), ': ', E('b', {}, [ modeLabel(state.recommend) ]) ])
			]));
			var warns = state.warnings || [];
			if (warns.length) {
				var ul = E('ul', { class: 'o-help' });
				warns.forEach(function (w) { ul.appendChild(E('li', {}, [ w ])); });
				info.appendChild(ul);
			}
			// sync radios
			MODES.forEach(function (m) {
				var r = document.getElementById('o-mode-' + m);
				if (r) r.checked = (state.current === m);
			});
		}

		root.appendChild(E('div', { class: 'o-toolbar' }, [
			E('h3', { style: 'margin:0;flex:1' }, [ _('Flow Offload') ]),
			E('button', {
				class: 'o-btn',
				click: function () {
					callDetect().then(function (d) {
						renderInfo(d);
						err.style.display = 'none';
					});
				}
			}, [ _('Detect') ])
		]));

		root.appendChild(err);
		root.appendChild(E('div', { class: 'o-card' }, [ info ]));

		var modeBox = E('div', { class: 'o-card', style: 'margin-top:12px' });
		modeBox.appendChild(E('div', { class: 'o-card-title' }, [ _('Select mode') ]));
		var form = E('div', { class: 'o-mode-group' });
		MODES.forEach(function (m) {
			var id = 'o-mode-' + m;
			var disabled = (m === 'hardware' && !state.hardware_supported) ||
				(m !== 'off' && !state.software_supported && m === 'software' && false);
			if (m === 'software' && !state.software_supported)
				disabled = true;
			if (m === 'hardware' && (!state.software_supported || !state.hardware_supported))
				disabled = true;
			form.appendChild(E('label', { class: 'o-mode-option' }, [
				E('input', {
					type: 'radio', name: 'offload_mode', id: id, value: m,
					checked: state.current === m ? 'checked' : null,
					disabled: disabled ? 'disabled' : null
				}),
				E('span', {}, [ modeLabel(m) ])
			]));
		});
		modeBox.appendChild(form);

		modeBox.appendChild(E('div', { class: 'o-form-actions', style: 'margin-left:0' }, [
			E('button', {
				class: 'o-btn o-btn-primary',
				click: function () {
					var sel = document.querySelector('input[name="offload_mode"]:checked');
					if (!sel) return;
					callSet(sel.value).then(function (res) {
						if (res && res.ok === false) {
							err.style.display = '';
							err.textContent = res.error || _('Failed');
						} else {
							err.style.display = 'none';
							return callDetect().then(renderInfo);
						}
					}).catch(function (e) {
						err.style.display = '';
						err.textContent = String(e);
					});
				}
			}, [ _('Apply') ]),
			E('button', {
				class: 'o-btn',
				click: function () {
					var rec = state.recommend || 'software';
					callSet(rec).then(function (res) {
						if (res && res.ok === false) {
							err.style.display = '';
							err.textContent = res.error || _('Failed');
						} else {
							err.style.display = 'none';
							return callDetect().then(renderInfo);
						}
					});
				}
			}, [ _('Apply recommended') ])
		]));
		modeBox.appendChild(E('p', { class: 'o-muted' }, [
			_('Applying reloads the firewall and may briefly interrupt traffic.'),
			' CLI: openont-offload detect | set off|software|hardware'
		]));
		root.appendChild(modeBox);

		renderInfo(state);
		return root;
	}
});
