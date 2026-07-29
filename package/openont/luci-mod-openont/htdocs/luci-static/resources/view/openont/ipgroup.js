'use strict';
'require view';
'require rpc';
'require ui';

var callList = rpc.declare({ object: 'openont', method: 'ipgroup_list', expect: { '': {} } });
var callSet = rpc.declare({ object: 'openont', method: 'ipgroup_set', params: [ 'id', 'name', 'comment', 'entries' ] });
var callDel = rpc.declare({ object: 'openont', method: 'ipgroup_del', params: [ 'id' ] });

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () { return callList(); },

	render: function (data) {
		var groups = (data && data.groups) || [];
		var root = E('div', { class: 'o-page' });
		var editBox = E('div', { id: 'o-ig-edit', class: 'o-card', style: 'display:none;margin-top:12px' });

		function showEdit(g) {
			g = g || { id: '', name: '', comment: '', entries: [] };
			editBox.style.display = '';
			editBox.innerHTML = '';
			var idIn = E('input', { class: 'o-input', value: g.id || '' });
			var nameIn = E('input', { class: 'o-input', value: g.name || '' });
			var cmtIn = E('input', { class: 'o-input', value: g.comment || '' });
			var entIn = E('textarea', { class: 'o-input', rows: 6, placeholder: _('One IP or CIDR per line') }, [
				(g.entries || []).join('\n')
			]);
			var err = E('div', { class: 'o-alert', style: 'display:none' });
			editBox.appendChild(E('div', { class: 'o-card-title' }, [ g.id ? _('Edit IP group') : _('Add IP group') ]));
			editBox.appendChild(err);
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ 'ID' ]), idIn ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ _('Name') ]), nameIn ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ _('Comment') ]), cmtIn ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ _('Members') ]), entIn ]));
			editBox.appendChild(E('div', { class: 'o-form-actions' }, [
				E('button', {
					class: 'o-btn o-btn-primary',
					click: function () {
						var id = idIn.value.trim() || nameIn.value.trim();
						var entries = entIn.value.split(/[\s,]+/).filter(Boolean).join(' ');
						callSet(id, nameIn.value.trim() || id, cmtIn.value.trim(), entries).then(function (res) {
							if (res && res.ok === false) {
								err.style.display = '';
								err.textContent = res.error || _('Failed');
							} else location.reload();
						});
					}
				}, [ _('Save') ]),
				E('button', { class: 'o-btn', click: function () { editBox.style.display = 'none'; } }, [ _('Cancel') ])
			]));
			editBox.appendChild(E('p', { class: 'o-muted' }, [ 'CLI: openont-ipgroup set <id> <name> <comment> <ip>…' ]));
		}

		root.appendChild(E('div', { class: 'o-toolbar' }, [
			E('h3', { style: 'margin:0;flex:1' }, [ _('Allow-access IP groups') ]),
			E('button', { class: 'o-btn o-btn-primary', click: function () { showEdit(null); } }, [ _('Add') ])
		]));

		var table = E('table', { class: 'o-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ 'ID' ]), E('th', {}, [ _('Name') ]), E('th', {}, [ _('Members') ]),
				E('th', {}, [ _('References') ]), E('th', {}, [ _('Comment') ]), E('th', {}, [ _('Actions') ])
			]) ])
		]);
		var tb = E('tbody', {});
		if (!groups.length) {
			tb.appendChild(E('tr', {}, [ E('td', { colspan: 6, class: 'o-muted' }, [
				_('No groups yet. Port mapping can use a group to restrict source IPs.')
			]) ]));
		}
		groups.forEach(function (g) {
			tb.appendChild(E('tr', {}, [
				E('td', {}, [ g.id ]),
				E('td', {}, [ g.name ]),
				E('td', {}, [
					E('span', { class: 'o-badge o-badge-info' }, [ String((g.entries || []).length) ]),
					' ', (g.entries || []).slice(0, 3).join(', '),
					(g.entries || []).length > 3 ? '…' : ''
				]),
				E('td', {}, [ E('span', { class: 'o-badge' }, [ _('%d mapping(s)').format(g.refs || 0) ]) ]),
				E('td', {}, [ g.comment || '—' ]),
				E('td', { class: 'o-ops' }, [
					E('a', { href: '#', click: function (ev) { ev.preventDefault(); showEdit(g); } }, [ _('Edit') ]),
					' ',
					E('a', {
						href: '#', style: 'color:#fe6f73',
						click: function (ev) {
							ev.preventDefault();
							if ((g.refs || 0) > 0) {
								alert(_('This group is still referenced by %d port mapping(s). Update those first.').format(g.refs));
								return;
							}
							if (!confirm(_('Delete group %s?').format(g.id))) return;
							callDel(g.id).then(function () { location.reload(); });
						}
					}, [ _('Delete') ])
				])
			]));
		});
		table.appendChild(tb);
		root.appendChild(E('div', { class: 'o-card' }, [ table ]));
		root.appendChild(editBox);
		return root;
	}
});
