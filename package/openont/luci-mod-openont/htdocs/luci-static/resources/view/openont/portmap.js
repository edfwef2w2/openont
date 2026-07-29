'use strict';
'require view';
'require rpc';

var callList = rpc.declare({ object: 'openont', method: 'portmap_list', expect: { '': {} } });
var callGroups = rpc.declare({ object: 'openont', method: 'ipgroup_list', expect: { '': {} } });
var callAdd = rpc.declare({
	object: 'openont', method: 'portmap_add',
	params: [ 'name', 'dest_ip', 'dest_port', 'proto', 'src_dport', 'src_group', 'enabled' ]
});
var callDel = rpc.declare({ object: 'openont', method: 'portmap_del', params: [ 'name' ] });
var callEn = rpc.declare({ object: 'openont', method: 'portmap_enable', params: [ 'name' ] });
var callDis = rpc.declare({ object: 'openont', method: 'portmap_disable', params: [ 'name' ] });

return view.extend({
	handleSaveApply: null, handleSave: null, handleReset: null,

	load: function () {
		return Promise.all([ callList(), callGroups() ]);
	},

	render: function (data) {
		var items = (data[0] && data[0].items) || [];
		var groups = (data[1] && data[1].groups) || [];
		var root = E('div', { class: 'o-page' });
		var filter = E('select', { class: 'o-input' }, [
			E('option', { value: '' }, [ '全部' ]),
			E('option', { value: '1' }, [ '已启用' ]),
			E('option', { value: '0' }, [ '已停用' ])
		]);
		var search = E('input', { class: 'o-input', placeholder: '内网地址/内外网端口/备注' });
		var editBox = E('div', { class: 'o-card', style: 'display:none;margin-top:12px' });
		var tbody = E('tbody', {});

		function groupName(id) {
			if (!id) return '任意';
			var g = groups.filter(function (x) { return x.id === id; })[0];
			return g ? g.name : id;
		}

		function showEdit(it) {
			it = it || { name: '', dest_ip: '', dest_port: '', proto: 'tcp', src_dport: '', src_group: '', enabled: 1 };
			editBox.style.display = '';
			editBox.innerHTML = '';
			var nameIn = E('input', { class: 'o-input', value: it.name || '' });
			var dip = E('input', { class: 'o-input', value: it.dest_ip || '' });
			var dport = E('input', { class: 'o-input', value: it.dest_port || '' });
			var sport = E('input', { class: 'o-input', value: it.src_dport || '' });
			var proto = E('select', { class: 'o-input' }, [
				E('option', { value: 'tcp' }, [ 'tcp' ]),
				E('option', { value: 'udp' }, [ 'udp' ]),
				E('option', { value: 'tcp+udp' }, [ 'tcp+udp' ])
			]);
			proto.value = (it.proto || 'tcp').replace(/ /g, '+');
			var grp = E('select', { class: 'o-input' }, [ E('option', { value: '' }, [ '任意' ]) ]);
			groups.forEach(function (g) {
				grp.appendChild(E('option', { value: g.id }, [ g.name + ' (' + (g.entries || []).length + ')' ]));
			});
			if (it.src_group) grp.value = it.src_group;
			var prev = E('div', { class: 'o-muted' });
			function refreshPrev() {
				var g = groups.filter(function (x) { return x.id === grp.value; })[0];
				prev.textContent = g ? ('成员: ' + (g.entries || []).join(', ')) : '不限制源 IP';
			}
			grp.addEventListener('change', refreshPrev);
			refreshPrev();
			var err = E('div', { class: 'o-alert', style: 'display:none' });
			editBox.appendChild(E('div', { class: 'o-card-title' }, [ it.name ? '编辑端口映射' : '添加端口映射' ]));
			editBox.appendChild(err);
			[
				[ '备注/名称', nameIn ], [ '内网地址 *', dip ], [ '内网端口 *', dport ],
				[ '协议 *', proto ], [ '外网地址', E('input', { class: 'o-input', value: '全部线路', disabled: 'disabled' }) ],
				[ '外网端口 *', sport ], [ '允许访问 IP', grp ]
			].forEach(function (row) {
				editBox.appendChild(E('div', { class: 'o-form-row' }, [ E('label', {}, [ row[0] ]), row[1] ]));
			});
			editBox.appendChild(prev);
			editBox.appendChild(E('p', {}, [
				E('a', { href: L.url('admin/network/openont-ipgroup') }, [ '管理 IP 分组' ]),
				' · 与 CLI openont-nat portmap-add 相同'
			]));
			editBox.appendChild(E('div', { class: 'o-form-actions' }, [
				E('button', {
					class: 'o-btn o-btn-primary',
					click: function () {
						var n = nameIn.value.trim() || ('pm-' + dip.value + '-' + sport.value);
						callAdd(n, dip.value.trim(), dport.value.trim(), proto.value, sport.value.trim(), grp.value, '1')
							.then(function (res) {
								if (res && res.ok === false) {
									err.style.display = '';
									err.textContent = res.error || '失败';
								} else location.reload();
							});
					}
				}, [ '保存' ]),
				E('button', { class: 'o-btn', click: function () { editBox.style.display = 'none'; } }, [ '取消' ])
			]));
		}

		function renderRows() {
			tbody.innerHTML = '';
			var q = search.value.trim().toLowerCase();
			var f = filter.value;
			items.forEach(function (it) {
				if (f !== '' && String(it.enabled ? 1 : 0) !== f) return;
				var blob = [ it.dest_ip, it.dest_port, it.src_dport, it.name, it.proto ].join(' ').toLowerCase();
				if (q && blob.indexOf(q) < 0) return;
				tbody.appendChild(E('tr', {}, [
					E('td', {}, [ it.dest_ip ]),
					E('td', {}, [ it.dest_port ]),
					E('td', {}, [ it.proto ]),
					E('td', {}, [ it.src_wan || '全部线路' ]),
					E('td', {}, [ it.src_dport ]),
					E('td', {}, [ groupName(it.src_group) ]),
					E('td', {}, [ it.name ]),
					E('td', {}, [
						E('span', { class: it.enabled ? 'colorG' : 'colorR' }, [ it.enabled ? '已启用' : '已停用' ])
					]),
					E('td', { class: 'o-ops' }, [
						E('a', { href: '#', click: function (ev) { ev.preventDefault(); showEdit(it); } }, [ '编辑' ]), ' ',
						E('a', {
							href: '#', click: function (ev) {
								ev.preventDefault();
								var c = Object.assign({}, it, { name: (it.name || 'pm') + '-copy' });
								showEdit(c);
							}
						}, [ '复制' ]), ' ',
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
		}

		filter.addEventListener('change', renderRows);
		search.addEventListener('input', renderRows);

		root.appendChild(E('div', { class: 'o-toolbar' }, [
			E('h3', { style: 'margin:0;margin-right:auto' }, [ '端口映射' ]),
			filter, search,
			E('button', { class: 'o-btn o-btn-primary', click: function () { showEdit(null); } }, [ '添加' ])
		]));

		var table = E('table', { class: 'o-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ '内网地址' ]), E('th', {}, [ '内网端口' ]), E('th', {}, [ '协议' ]),
				E('th', {}, [ '外网地址' ]), E('th', {}, [ '外网端口' ]), E('th', {}, [ '允许访问 IP' ]),
				E('th', {}, [ '备注' ]), E('th', {}, [ '状态' ]), E('th', {}, [ '操作' ])
			]) ]),
			tbody
		]);
		root.appendChild(E('div', { class: 'o-card' }, [ table ]));
		root.appendChild(editBox);
		root.appendChild(E('div', { class: 'o-help' }, [
			'帮助：内外网端口段数量需一致。允许访问 IP 可选用 IP 分组。CLI: openont-nat portmap-add …'
		]));
		renderRows();
		return root;
	}
});
