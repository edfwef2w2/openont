'use strict';
'require view';
'require rpc';

var callList = rpc.declare({ object: 'openont', method: 'dmz_list', expect: { '': {} } });
var callAdd = rpc.declare({
	object: 'openont', method: 'dmz_add',
	params: [ 'name', 'dest_ip', 'enabled', 'excl_proto', 'excl_port' ]
});
var callDel = rpc.declare({ object: 'openont', method: 'dmz_del', params: [ 'name' ] });
var callEn = rpc.declare({ object: 'openont', method: 'dmz_enable', params: [ 'name' ] });
var callDis = rpc.declare({ object: 'openont', method: 'dmz_disable', params: [ 'name' ] });

return view.extend({
	handleSaveApply: null, handleSave: null, handleReset: null,

	load: function () { return callList(); },

	render: function (data) {
		var items = (data && data.items) || [];
		var editBox = E('div', { class: 'cbi-section', style: 'display:none' });
		var tbody = E('tbody', {});

		function wanLabel(v) {
			return (!v || v === 'all') ? _('All WAN') : v;
		}

		function showEdit(it) {
			it = it || { name: '', dest_ip: '', enabled: 1, excl_proto: '', excl_port: '' };
			editBox.style.display = '';
			editBox.innerHTML = '';
			var nameIn = E('input', { type: 'text', value: it.name || '' });
			var dip = E('input', { type: 'text', value: it.dest_ip || '' });
			var exclP = E('select', {}, [
				E('option', { value: '' }, [ _('None') ]),
				E('option', { value: 'tcp' }, [ 'TCP' ]),
				E('option', { value: 'udp' }, [ 'UDP' ]),
				E('option', { value: 'tcp+udp' }, [ 'TCP+UDP' ])
			]);
			exclP.value = it.excl_proto || '';
			var exclT = E('input', { type: 'text', value: it.excl_port || '', placeholder: _('e.g. 22,80') });
			var err = E('div', { class: 'alert-message', style: 'display:none' });

			editBox.appendChild(E('h3', {}, [ _('DMZ Host') ]));
			editBox.appendChild(err);
			[
				[ _('Comment / name'), nameIn ],
				[ _('External address'), E('input', { type: 'text', value: _('All WAN'), disabled: 'disabled' }) ],
				[ _('Internal address'), dip ],
				[ _('Exclude protocol'), exclP ],
				[ _('Exclude ports'), exclT ]
			].forEach(function (row) {
				editBox.appendChild(E('div', { class: 'cbi-value' }, [
					E('label', { class: 'cbi-value-title' }, [ row[0] ]),
					E('div', { class: 'cbi-value-field' }, [ row[1] ])
				]));
			});
			editBox.appendChild(E('div', { class: 'cbi-page-actions' }, [
				E('button', {
					class: 'cbi-button cbi-button-apply',
					click: function () {
						var n = nameIn.value.trim() || ('dmz-' + dip.value.trim());
						callAdd(n, dip.value.trim(), '1', exclP.value, exclT.value.trim()).then(function (res) {
							if (res && res.ok === false) {
								err.style.display = '';
								err.textContent = res.error || _('Failed');
							} else location.reload();
						});
					}
				}, [ _('Save & Apply') ]),
				E('button', {
					class: 'cbi-button',
					click: function () { editBox.style.display = 'none'; }
				}, [ _('Cancel') ])
			]));
		}

		if (!items.length) {
			tbody.appendChild(E('tr', { class: 'tr' }, [
				E('td', { class: 'td cbi-empty', colspan: 7 }, [ _('No DMZ hosts configured.') ])
			]));
		}
		items.forEach(function (it) {
			tbody.appendChild(E('tr', { class: 'tr' }, [
				E('td', { class: 'td' }, [ wanLabel(it.src_wan) ]),
				E('td', { class: 'td' }, [ it.dest_ip ]),
				E('td', { class: 'td' }, [ it.excl_proto || '—' ]),
				E('td', { class: 'td' }, [ it.excl_port || '—' ]),
				E('td', { class: 'td' }, [ it.name ]),
				E('td', { class: 'td' }, [ it.enabled ? _('Enabled') : _('Disabled') ]),
				E('td', { class: 'td' }, [
					E('a', { href: '#', click: function (ev) { ev.preventDefault(); showEdit(it); } }, [ _('Edit') ]), ' ',
					E('a', {
						href: '#', click: function (ev) {
							ev.preventDefault();
							(it.enabled ? callDis : callEn)(it.name).then(function () { location.reload(); });
						}
					}, [ it.enabled ? _('Disable') : _('Enable') ]), ' ',
					E('a', {
						href: '#', class: 'cbi-button-remove', click: function (ev) {
							ev.preventDefault();
							if (!confirm(_('Delete %s?').format(it.name))) return;
							callDel(it.name).then(function () { location.reload(); });
						}
					}, [ _('Delete') ])
				])
			]));
		});

		return E('div', { class: 'cbi-map' }, [
			E('h2', { name: 'content' }, [ _('DMZ Host') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Expose an internal host on WAN. Only one enabled DMZ host is recommended.')
			]),
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, [ _('Hosts') ]),
				E('div', { class: 'cbi-section-actions' }, [
					E('button', {
						class: 'cbi-button cbi-button-add',
						click: function () { showEdit(null); }
					}, [ _('Add') ])
				]),
				E('div', { class: 'cbi-section-node' }, [
					E('table', { class: 'table cbi-section-table' }, [
						E('thead', {}, [ E('tr', { class: 'tr table-titles' }, [
							E('th', { class: 'th' }, [ _('External address') ]),
							E('th', { class: 'th' }, [ _('Internal address') ]),
							E('th', { class: 'th' }, [ _('Exclude protocol') ]),
							E('th', { class: 'th' }, [ _('Exclude ports') ]),
							E('th', { class: 'th' }, [ _('Comment') ]),
							E('th', { class: 'th' }, [ _('State') ]),
							E('th', { class: 'th' }, [ _('Actions') ])
						]) ]),
						tbody
					])
				])
			]),
			editBox
		]);
	}
});
