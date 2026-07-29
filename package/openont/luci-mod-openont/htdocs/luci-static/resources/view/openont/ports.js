'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callPortStatus = rpc.declare({ object: 'openont', method: 'port_status', expect: { '': {} } });
var callPortSet = rpc.declare({ object: 'openont', method: 'port_set', params: [ 'role', 'ports', 'proto' ] });
var callPortAdd = rpc.declare({ object: 'openont', method: 'port_add', params: [ 'role', 'netdev' ] });
var callPortDelPort = rpc.declare({ object: 'openont', method: 'port_del_port', params: [ 'role', 'netdev' ] });
var callPortDel = rpc.declare({ object: 'openont', method: 'port_del', params: [ 'role' ] });

function badge(link) {
	return E('span', { class: link === 'up' ? 'o-badge o-badge-ok' : 'o-badge o-badge-bad' }, [ link === 'up' ? '已连接' : '断开' ]);
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return callPortStatus();
	},

	render: function (data) {
		var self = this;
		this._data = data || {};
		var root = E('div', { class: 'o-page' });
		root.appendChild(E('div', { class: 'o-card-title', style: 'margin-bottom:12px' }, [
			E('h3', { style: 'margin:0' }, [ '网口绑定' ]),
			E('span', { style: 'color:#888;font-size:12px' }, [ '与控制台 openont-port 完全一致' ])
		]));

		var st = (data && data.stats) || {};
		root.appendChild(E('div', { class: 'o-stat-bar' }, [
			E('span', {}, [ '总网卡: ', E('b', {}, [ String(st.total || 0) ]) ]),
			E('span', {}, [ '空闲: ', E('b', {}, [ String(st.free || 0) ]) ]),
			E('span', {}, [ 'LAN: ', E('b', {}, [ String(st.lan || 0) ]) ]),
			E('span', {}, [ 'WAN: ', E('b', {}, [ String(st.wan || 0) ]) ])
		]));

		/* Physical table */
		var table = E('table', { class: 'o-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ '物理网卡' ]), E('th', {}, [ '角色' ]),
				E('th', {}, [ '链路' ]), E('th', {}, [ '速率' ]),
				E('th', {}, [ 'MAC' ]), E('th', {}, [ '状态' ])
			]) ])
		]);
		var tb = E('tbody', {});
		(data.physical || []).forEach(function (p) {
			tb.appendChild(E('tr', { class: p.free ? '' : 'o-row-bound' }, [
				E('td', {}, [ p.netdev ]),
				E('td', {}, [ p.role || '—' ]),
				E('td', {}, [ badge(p.link) ]),
				E('td', {}, [ (p.speed ? p.speed + 'Mbps' : '—') + (p.duplex ? '/' + p.duplex : '') ]),
				E('td', {}, [ p.mac || '—' ]),
				E('td', {}, [ p.free ? E('span', { class: 'o-badge' }, [ '空闲' ]) : E('span', { class: 'o-badge o-badge-info' }, [ '已绑定' ]) ])
			]));
		});
		table.appendChild(tb);
		root.appendChild(E('div', { class: 'o-card' }, [
			E('div', { class: 'o-card-title' }, [ '物理网卡状态' ]),
			table
		]));

		/* Roles */
		var rolesBox = E('div', { class: 'o-card', style: 'margin-top:12px' }, [
			E('div', { class: 'o-card-title' }, [ '逻辑接口 (lanN / wanN)' ])
		]);
		var roles = data.roles || [];
		if (!roles.length) {
			rolesBox.appendChild(E('p', { class: 'o-muted' }, [ '尚未绑定。请使用下方表单或控制台: openont-port set lan1 eth0' ]));
		} else {
			roles.forEach(function (r) {
				var ports = (r.ports || []).map(function (p) {
					return E('span', { class: 'o-chip' }, [
						p.name || p, ' ', badge(p.link || 'down'),
						' ',
						E('a', {
							href: '#',
							click: function (ev) {
								ev.preventDefault();
								if (!confirm('从 ' + r.name + ' 移除 ' + (p.name || p) + ' ?')) return;
								callPortDelPort(r.name, p.name || p).then(function () { location.reload(); });
							}
						}, [ '移除' ])
					]);
				});
				rolesBox.appendChild(E('div', { class: 'o-role-card' }, [
					E('div', {}, [
						E('strong', {}, [ r.name ]), ' · ', r.proto || '?', ' · ', r.device || '',
						E('a', {
							href: '#', style: 'margin-left:12px;color:#fe6f73',
							click: function (ev) {
								ev.preventDefault();
								if (!confirm('解绑 ' + r.name + ' ?')) return;
								callPortDel(r.name).then(function () { location.reload(); });
							}
						}, [ '解绑' ])
					]),
					E('div', { class: 'o-chip-row' }, ports)
				]));
			});
		}
		root.appendChild(rolesBox);

		/* Bind form */
		var freeNets = (data.physical || []).filter(function (p) { return p.free; }).map(function (p) { return p.netdev; });
		var roleIn = E('input', { class: 'o-input', placeholder: 'lan1 或 wan1', value: 'lan1' });
		var portSel = E('select', { class: 'o-input o-select-multi', multiple: 'multiple', size: Math.min(6, Math.max(3, freeNets.length || 3)) });
		freeNets.forEach(function (n) {
			portSel.appendChild(E('option', { value: n }, [ n ]));
		});
		var protoIn = E('select', { class: 'o-input' }, [
			E('option', { value: 'dhcp' }, [ 'dhcp (WAN)' ]),
			E('option', { value: 'pppoe' }, [ 'pppoe (WAN)' ]),
			E('option', { value: 'static' }, [ 'static' ])
		]);
		var err = E('div', { class: 'o-alert', style: 'display:none' });

		root.appendChild(E('div', { class: 'o-card', style: 'margin-top:12px' }, [
			E('div', { class: 'o-card-title' }, [ '绑定 / 设置（≡ openont-port set）' ]),
			err,
			E('div', { class: 'o-form-row' }, [ E('label', {}, [ '角色' ]), roleIn ]),
			E('div', { class: 'o-form-row' }, [ E('label', {}, [ '网卡 (可多选 LAN)' ]), portSel ]),
			E('div', { class: 'o-form-row' }, [ E('label', {}, [ 'WAN 协议' ]), protoIn ]),
			E('div', { class: 'o-form-actions' }, [
				E('button', {
					class: 'o-btn o-btn-primary',
					click: function () {
						var role = roleIn.value.trim();
						var selected = Array.prototype.filter.call(portSel.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
						if (!role || !selected.length) {
							err.style.display = '';
							err.textContent = '请填写角色并选择网卡';
							return;
						}
						var ports = selected.join(' ');
						var proto = /^wan/i.test(role) ? protoIn.value : '';
						callPortSet(role, ports, proto).then(function (res) {
							if (res && res.ok === false) {
								err.style.display = '';
								err.textContent = res.error || '失败';
							} else {
								location.reload();
							}
						}).catch(function (e) {
							err.style.display = '';
							err.textContent = String(e);
						});
					}
				}, [ '应用绑定' ])
			]),
			E('p', { class: 'o-muted' }, [
				'CLI: openont-port set lan1 eth0 eth1 · openont-port add lan1 eth2 · openont-port del-port lan1 eth1 · openont-port del lan1'
			])
		]));

		poll.add(function () {
			return callPortStatus().then(function () { /* light refresh optional */ });
		}, 10);

		return root;
	}
});
