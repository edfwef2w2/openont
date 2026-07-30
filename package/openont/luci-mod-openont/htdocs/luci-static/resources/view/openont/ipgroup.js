'use strict';
'require view';
'require rpc';

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
		var editBox = E('div', { class: 'cbi-section', style: 'display:none' });
		var tbody = E('tbody', {});

		function showEdit(g) {
			g = g || { id: '', name: '', comment: '', entries: [] };
			editBox.style.display = '';
			editBox.innerHTML = '';
			var idIn = E('input', { type: 'text', value: g.id || '' });
			var nameIn = E('input', { type: 'text', value: g.name || '' });
			var cmtIn = E('input', { type: 'text', value: g.comment || '' });
			var entIn = E('textarea', { rows: 6, placeholder: _('One IP or CIDR per line') }, [
				(g.entries || []).join('\n')
			]);
			var err = E('div', { class: 'alert-message', style: 'display:none' });

			editBox.appendChild(E('h3', {}, [
				g.id ? _('Edit IP group') : _('Add IP group')
			]));
			editBox.appendChild(err);
			[
				[ 'ID', idIn ],
				[ _('Name'), nameIn ],
				[ _('Comment'), cmtIn ],
				[ _('Members'), entIn ]
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
						var id = idIn.value.trim() || nameIn.value.trim();
						var entries = entIn.value.split(/[\s,]+/).filter(Boolean).join(' ');
						callSet(id, nameIn.value.trim() || id, cmtIn.value.trim(), entries).then(function (res) {
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

		if (!groups.length) {
			tbody.appendChild(E('tr', { class: 'tr' }, [
				E('td', { class: 'td cbi-empty', colspan: 6 }, [
					_('No groups yet. Port mapping can use a group to restrict source IPs.')
				])
			]));
		}
		groups.forEach(function (g) {
			tbody.appendChild(E('tr', { class: 'tr' }, [
				E('td', { class: 'td' }, [ g.id ]),
				E('td', { class: 'td' }, [ g.name ]),
				E('td', { class: 'td' }, [
					String((g.entries || []).length),
					' · ',
					(g.entries || []).slice(0, 3).join(', '),
					(g.entries || []).length > 3 ? '…' : ''
				]),
				E('td', { class: 'td' }, [ _('%d mapping(s)').format(g.refs || 0) ]),
				E('td', { class: 'td' }, [ g.comment || '—' ]),
				E('td', { class: 'td' }, [
					E('a', { href: '#', click: function (ev) { ev.preventDefault(); showEdit(g); } }, [ _('Edit') ]),
					' ',
					E('a', {
						href: '#', class: 'cbi-button-remove',
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

		return E('div', { class: 'cbi-map' }, [
			E('h2', { name: 'content' }, [ _('IP Groups') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Named lists of IP addresses or networks used by port mapping access control.')
			]),
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, [ _('Groups') ]),
				E('div', { class: 'cbi-section-actions' }, [
					E('button', {
						class: 'cbi-button cbi-button-add',
						click: function () { showEdit(null); }
					}, [ _('Add') ])
				]),
				E('div', { class: 'cbi-section-node' }, [
					E('table', { class: 'table cbi-section-table' }, [
						E('thead', {}, [ E('tr', { class: 'tr table-titles' }, [
							E('th', { class: 'th' }, [ 'ID' ]),
							E('th', { class: 'th' }, [ _('Name') ]),
							E('th', { class: 'th' }, [ _('Members') ]),
							E('th', { class: 'th' }, [ _('References') ]),
							E('th', { class: 'th' }, [ _('Comment') ]),
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
