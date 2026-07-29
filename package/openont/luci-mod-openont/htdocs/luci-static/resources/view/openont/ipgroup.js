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
			var entIn = E('textarea', { class: 'o-input', rows: 6, placeholder: '每行一个 IP 或 CIDR' }, [
				(g.entries || []).join('\n')
			]);
			var err = E('div', { class: 'o-alert', style: 'display:none' });
			editBox.appendChild(E('div', { class: 'o-card-title' }, [ g.id ? '编辑 IP 分组' : '添加 IP 分组' ]));
			editBox.appendChild(err);
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ 'ID' ]), idIn ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ '名称' ]), nameIn ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ '备注' ]), cmtIn ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ '成员' ]), entIn ]));
			editBox.appendChild(E('div', { class: 'o-form-actions' }, [
				E('button', {
					class: 'o-btn o-btn-primary',
					click: function () {
						var id = idIn.value.trim() || nameIn.value.trim();
						var entries = entIn.value.split(/[\s,]+/).filter(Boolean).join(' ');
						callSet(id, nameIn.value.trim() || id, cmtIn.value.trim(), entries).then(function (res) {
							if (res && res.ok === false) {
								err.style.display = '';
								err.textContent = res.error || '失败';
							} else location.reload();
						});
					}
				}, [ '保存' ]),
				E('button', { class: 'o-btn', click: function () { editBox.style.display = 'none'; } }, [ '取消' ])
			]));
			editBox.appendChild(E('p', { class: 'o-muted' }, [ 'CLI: openont-ipgroup set <id> <name> <comment> <ip>…' ]));
		}

		root.appendChild(E('div', { class: 'o-toolbar' }, [
			E('h3', { style: 'margin:0;flex:1' }, [ '允许访问 IP 分组' ]),
			E('button', { class: 'o-btn o-btn-primary', click: function () { showEdit(null); } }, [ '添加' ])
		]));

		var table = E('table', { class: 'o-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ 'ID' ]), E('th', {}, [ '名称' ]), E('th', {}, [ '成员' ]),
				E('th', {}, [ '引用' ]), E('th', {}, [ '备注' ]), E('th', {}, [ '操作' ])
			]) ])
		]);
		var tb = E('tbody', {});
		if (!groups.length) {
			tb.appendChild(E('tr', {}, [ E('td', { colspan: 6, class: 'o-muted' }, [ '暂无分组。端口映射中可选用分组限制源 IP。' ]) ]));
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
				E('td', {}, [ E('span', { class: 'o-badge' }, [ String(g.refs || 0) + ' 条映射' ]) ]),
				E('td', {}, [ g.comment || '—' ]),
				E('td', { class: 'o-ops' }, [
					E('a', { href: '#', click: function (ev) { ev.preventDefault(); showEdit(g); } }, [ '编辑' ]),
					' ',
					E('a', {
						href: '#', style: 'color:#fe6f73',
						click: function (ev) {
							ev.preventDefault();
							if ((g.refs || 0) > 0) {
								alert('该分组仍被 ' + g.refs + ' 条端口映射引用，请先修改映射。');
								return;
							}
							if (!confirm('删除分组 ' + g.id + ' ?')) return;
							callDel(g.id).then(function () { location.reload(); });
						}
					}, [ '删除' ])
				])
			]));
		});
		table.appendChild(tb);
		root.appendChild(E('div', { class: 'o-card' }, [ table ]));
		root.appendChild(editBox);
		return root;
	}
});
