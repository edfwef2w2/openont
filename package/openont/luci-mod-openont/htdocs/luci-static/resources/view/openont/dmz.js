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

		function showEdit(it) {
			it = it || { name: '', dest_ip: '', enabled: 1, excl_proto: '', excl_port: '' };
			editBox.style.display = '';
			editBox.innerHTML = '';
			var nameIn = E('input', { class: 'o-input', value: it.name || '' });
			var dip = E('input', { class: 'o-input', value: it.dest_ip || '' });
			var exclP = E('select', { class: 'o-input' }, [
				E('option', { value: '' }, [ '无' ]),
				E('option', { value: 'tcp' }, [ 'tcp' ]),
				E('option', { value: 'udp' }, [ 'udp' ]),
				E('option', { value: 'tcp+udp' }, [ 'tcp+udp' ])
			]);
			exclP.value = it.excl_proto || '';
			var exclT = E('input', { class: 'o-input', value: it.excl_port || '', placeholder: '可选，如 22,80' });
			var err = E('div', { class: 'o-alert', style: 'display:none' });
			editBox.appendChild(E('div', { class: 'o-card-title' }, [ 'DMZ 主机' ]));
			editBox.appendChild(err);
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ '备注/名称' ]), nameIn ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ '外网地址' ]), E('input', { class: 'o-input', value: '全部线路', disabled: 'disabled' }) ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ '内网地址 *' ]), dip ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ '排除协议' ]), exclP ]));
			editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ '排除端口' ]), exclT ]));
			editBox.appendChild(E('div', { class: 'o-form-actions' }, [
				E('button', {
					class: 'o-btn o-btn-primary',
					click: function () {
						var n = nameIn.value.trim() || ('dmz-' + dip.value.trim());
						callAdd(n, dip.value.trim(), '1', exclP.value, exclT.value.trim()).then(function (res) {
							if (res && res.ok === false) {
								err.style.display = '';
								err.textContent = res.error || '失败';
							} else location.reload();
						});
					}
				}, [ '保存' ]),
				E('button', { class: 'o-btn', click: function () { editBox.style.display = 'none'; } }, [ '取消' ])
			]));
			editBox.appendChild(E('p', { class: 'o-muted' }, [ 'CLI: openont-nat dmz-add <name> <dest_ip>' ]));
		}

		items.forEach(function (it) {
			tbody.appendChild(E('tr', {}, [
				E('td', {}, [ it.src_wan || '全部线路' ]),
				E('td', {}, [ it.dest_ip ]),
				E('td', {}, [ it.excl_proto || '—' ]),
				E('td', {}, [ it.excl_port || '—' ]),
				E('td', {}, [ it.name ]),
				E('td', {}, [ E('span', { class: it.enabled ? 'colorG' : 'colorR' }, [ it.enabled ? '已启用' : '已停用' ]) ]),
				E('td', { class: 'o-ops' }, [
					E('a', { href: '#', click: function (ev) { ev.preventDefault(); showEdit(it); } }, [ '编辑' ]), ' ',
					E('a', {
						href: '#', click: function (ev) {
							ev.preventDefault();
							(it.enabled ? callDis : callEn)(it.name).then(function () { location.reload(); });
						}
					}, [ it.enabled ? '停用' : '启用' ]), ' ',
					E('a', {
						href: '#', style: 'color:#fe6f73', click: function (ev) {
							ev.preventDefault();
							if (!confirm('删除 ' + it.name + ' ?')) return;
							callDel(it.name).then(function () { location.reload(); });
						}
					}, [ '删除' ])
				])
			]));
		});

		root.appendChild(E('div', { class: 'o-toolbar' }, [
			E('h3', { style: 'margin:0;margin-right:auto' }, [ 'DMZ 主机' ]),
			E('button', { class: 'o-btn o-btn-primary', click: function () { showEdit(null); } }, [ '添加' ])
		]));
		root.appendChild(E('div', { class: 'o-card' }, [
			E('table', { class: 'o-table' }, [
				E('thead', {}, [ E('tr', {}, [
					E('th', {}, [ '外网地址' ]), E('th', {}, [ '内网地址' ]),
					E('th', {}, [ '排除协议' ]), E('th', {}, [ '排除端口' ]),
					E('th', {}, [ '备注' ]), E('th', {}, [ '状态' ]), E('th', {}, [ '操作' ])
				]) ]),
				tbody
			])
		]));
		root.appendChild(editBox);
		root.appendChild(E('div', { class: 'o-help' }, [
			'每个外网侧仅建议启用一条 DMZ。将内网主机完整暴露到 WAN（DNAT 1-65535）。'
		]));
		return root;
	}
});
