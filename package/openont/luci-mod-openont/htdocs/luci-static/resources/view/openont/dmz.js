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
		var root = E('div', { class: 'o-page' });
		var editBox = E('div', { class: 'o-card', style: 'display:none;margin-top:12px' });
		var tbody = E('tbody', {});

		function wanLabel(v) {
			return (!v || v === 'all') ? _('All WAN') : v;
		}

		function showEdit(it) {
			it = it || { name: '', dest_ip: '', enabled: 1, excl_proto: '', excl_port: '' };
			editBox.style.display = '';
			editBox.innerHTML = '';
			var nameIn = E('input', { class: 'o-input', value: it.name || '' });
			var dip = E('input', { class: 'o-input', value: it.dest_ip || '' });
			var exclP = E('select', { class: 'o-input' }, [
				E('option', { value: '' }, [ _('None') ]),
				E('option', { value: 'tcp' }, [ 'tcp' ]),
				E('option', { value: 'udp' }, [ 'udp' ]),
				E('option', { value: 'tcp+udp' }, [ 'tcp+udp' ])
			]);
			exclP.value = it.excl_proto || '';
			var exclT = E('input', { class: 'o-input', value: it.excl_port || '', placeholder: _('Optional, e.g. 22,80') });
			var err = E('div', { class: 'o-alert', style: 'display:none' });
			editBox.appendChild(E('div', { class: 'o-card-title' }, [ _('DMZ Host') ]));
			editBox.appendChild(err);
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ _('Comment / name') ]), nameIn ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [
				E('label', {}, [ _('External address') ]),
				E('input', { class: 'o-input', value: _('All WAN'), disabled: 'disabled' })
			]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ _('Internal address') + ' *' ]), dip ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ _('Exclude protocol') ]), exclP ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ _('Exclude ports') ]), exclT ]));
			editBox.appendChild(E('div', { class: 'o-form-actions' }, [
				E('button', {
					class: 'o-btn o-btn-primary',
					click: function () {
						var n = nameIn.value.trim() || ('dmz-' + dip.value.trim());
						callAdd(n, dip.value.trim(), '1', exclP.value, exclT.value.trim()).then(function (res) {
							if (res && res.ok === false) {
								err.style.display = '';
								err.textContent = res.error || _('Failed');
							} else location.reload();
						});
					}
				}, [ _('Save') ]),
				E('button', { class: 'o-btn', click: function () { editBox.style.display = 'none'; } }, [ _('Cancel') ])
			]));
			editBox.appendChild(E('p', { class: 'o-muted' }, [ 'CLI: openont-nat dmz-add <name> <dest_ip>' ]));
		}

		items.forEach(function (it) {
			tbody.appendChild(E('tr', {}, [
				E('td', {}, [ wanLabel(it.src_wan) ]),
				E('td', {}, [ it.dest_ip ]),
				E('td', {}, [ it.excl_proto || '—' ]),
				E('td', {}, [ it.excl_port || '—' ]),
				E('td', {}, [ it.name ]),
				E('td', {}, [
					E('span', { class: it.enabled ? 'colorG' : 'colorR' }, [
						it.enabled ? _('Enabled') : _('Disabled')
					])
				]),
				E('td', { class: 'o-ops' }, [
					E('a', { href: '#', click: function (ev) { ev.preventDefault(); showEdit(it); } }, [ _('Edit') ]), ' ',
					E('a', {
						href: '#', click: function (ev) {
							ev.preventDefault();
							(it.enabled ? callDis : callEn)(it.name).then(function () { location.reload(); });
						}
					}, [ it.enabled ? _('Disable') : _('Enable') ]), ' ',
					E('a', {
						href: '#', style: 'color:#fe6f73', click: function (ev) {
							ev.preventDefault();
							if (!confirm(_('Delete %s?').format(it.name))) return;
							callDel(it.name).then(function () { location.reload(); });
						}
					}, [ _('Delete') ])
				])
			]));
		});

		root.appendChild(E('div', { class: 'o-toolbar' }, [
			E('h3', { style: 'margin:0;margin-right:auto' }, [ _('DMZ Host') ]),
			E('button', { class: 'o-btn o-btn-primary', click: function () { showEdit(null); } }, [ _('Add') ])
		]));
		root.appendChild(E('div', { class: 'o-card' }, [
			E('table', { class: 'o-table' }, [
				E('thead', {}, [ E('tr', {}, [
					E('th', {}, [ _('External address') ]), E('th', {}, [ _('Internal address') ]),
					E('th', {}, [ _('Exclude protocol') ]), E('th', {}, [ _('Exclude ports') ]),
					E('th', {}, [ _('Comment') ]), E('th', {}, [ _('State') ]), E('th', {}, [ _('Actions') ])
				]) ]),
				tbody
			])
		]));
		root.appendChild(editBox);
		root.appendChild(E('div', { class: 'o-help' }, [
			_('Only one enabled DMZ is recommended. The host is fully exposed on WAN (DNAT 1-65535).')
		]));
		return root;
	}
});
