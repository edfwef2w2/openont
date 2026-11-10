'use strict';
'require view';
'require rpc';

var callStatus = rpc.declare({ object: 'openont', method: 'dns_status', expect: { '': {} } });
var callSet = rpc.declare({
	object: 'openont',
	method: 'dns_set',
	params: [ 'enabled', 'port', 'cache_size', 'min_ttl', 'max_ttl', 'serve_expired', 'prefetch',
		'response_mode', 'speed_check', 'ip_pref', 'block_mode', 'log_size', 'bogus' ]
});

function yn(v) {
	return v ? _('Yes') : _('No');
}

function modeLabel(v) {
	switch (v) {
	case 'first-response': return _('First response');
	case 'fastest-response': return _('Fastest response');
	case 'fastest-ip': return _('Fastest IP');
	default: return v || '—';
	}
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return callStatus();
	},

	render: function (data) {
		var st = data || {};
		var err = E('div', { class: 'alert-message', style: 'display:none' });
		var bogus = (st.bogus || []).join('\n');

		function field(id, label, node) {
			return E('div', { class: 'cbi-value' }, [
				E('label', { class: 'cbi-value-title', 'for': id }, [ label ]),
				E('div', { class: 'cbi-value-field' }, [ node ])
			]);
		}

		function sel(id, value, options) {
			var node = E('select', { id: id });
			options.forEach(function (o) {
				node.appendChild(E('option', { value: o[0], selected: value === o[0] ? 'selected' : null }, [ o[1] ]));
			});
			return node;
		}

		var enabled = E('input', { id: 'dns-enabled', type: 'checkbox' });
		if (st.enabled)
			enabled.checked = true;
		var port = E('input', { id: 'dns-port', type: 'number', value: String(st.port || 53) });
		var cache = E('input', { id: 'dns-cache', type: 'number', value: String(st.cache_size || 4096) });
		var minTtl = E('input', { id: 'dns-min', type: 'number', value: String(st.min_ttl || 0) });
		var maxTtl = E('input', { id: 'dns-max', type: 'number', value: String(st.max_ttl || 3600) });
		var serve = E('input', { id: 'dns-serve', type: 'checkbox' });
		if (st.serve_expired)
			serve.checked = true;
		var prefetch = E('input', { id: 'dns-prefetch', type: 'checkbox' });
		if (st.prefetch)
			prefetch.checked = true;
		var mode = sel('dns-mode', st.response_mode || 'fastest-ip', [
			[ 'first-response', _('First response') ],
			[ 'fastest-response', _('Fastest response') ],
			[ 'fastest-ip', _('Fastest IP') ]
		]);
		var speed = sel('dns-speed', st.speed_check || 'tcp443', [
			[ 'off', _('Off') ],
			[ 'icmp', _('ICMP') ],
			[ 'tcp443', _('TCP 443') ]
		]);
		var pref = sel('dns-pref', st.ip_pref || 'dual', [
			[ 'dual', _('Dual stack') ],
			[ 'v4', _('Prefer IPv4') ],
			[ 'v6', _('Prefer IPv6') ]
		]);
		var block = sel('dns-block', st.block_mode || 'nxdomain', [
			[ 'nxdomain', _('NXDOMAIN') ],
			[ 'refused', _('REFUSED') ],
			[ 'zero', _('Zero address') ]
		]);
		var logsz = E('input', { id: 'dns-logsz', type: 'number', value: String(st.log_size || 500) });
		var bogusBox = E('textarea', { id: 'dns-bogus', rows: 5 }, [ bogus ]);

		return E('div', { class: 'cbi-map' }, [
			E('h2', { name: 'content' }, [ _('General') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Forward LAN DNS through upstream groups. DHCP keeps using the existing server, which stops listening on port 53 while this service is enabled.')
			]),
			err,
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, [ _('Status') ]),
				E('div', { class: 'cbi-section-node' }, [
					E('table', { class: 'table' }, [
						E('tr', { class: 'tr' }, [
							E('td', { class: 'td' }, [ _('Running') ]),
							E('td', { class: 'td' }, [ yn(st.running) ])
						]),
						E('tr', { class: 'tr' }, [
							E('td', { class: 'td' }, [ _('Listening') ]),
							E('td', { class: 'td' }, [ yn(st.listen_ok) ])
						]),
						E('tr', { class: 'tr' }, [
							E('td', { class: 'td' }, [ _('DHCP DNS handed over') ]),
							E('td', { class: 'td' }, [ yn(st.dnsmasq_yielded) ])
						]),
						E('tr', { class: 'tr' }, [
							E('td', { class: 'td' }, [ _('LAN address') ]),
							E('td', { class: 'td' }, [ st.lan_ip || '—' ])
						]),
						E('tr', { class: 'tr' }, [
							E('td', { class: 'td' }, [ _('Response mode') ]),
							E('td', { class: 'td' }, [ modeLabel(st.response_mode) ])
						])
					])
				])
			]),
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, [ _('Settings') ]),
				field('dns-enabled', _('Enabled'), enabled),
				field('dns-port', _('Listen port'), port),
				field('dns-cache', _('Cache size'), cache),
				field('dns-min', _('Minimum TTL'), minTtl),
				field('dns-max', _('Maximum TTL'), maxTtl),
				field('dns-serve', _('Serve expired replies'), serve),
				field('dns-prefetch', _('Prefetch'), prefetch),
				field('dns-mode', _('Response mode'), mode),
				field('dns-speed', _('Speed check'), speed),
				field('dns-pref', _('Address preference'), pref),
				field('dns-block', _('Block answer'), block),
				field('dns-logsz', _('Query log size'), logsz),
				field('dns-bogus', _('Bogus prefixes'), bogusBox),
				E('div', { class: 'cbi-value-description' }, [
					_('One CIDR per line. Answers inside these prefixes are dropped before an address is chosen.')
				])
			]),
			E('div', { class: 'cbi-page-actions' }, [
				E('button', {
					class: 'cbi-button cbi-button-apply',
					click: function () {
						err.style.display = 'none';
						callSet(
							enabled.checked ? '1' : '0',
							port.value,
							cache.value,
							minTtl.value,
							maxTtl.value,
							serve.checked ? '1' : '0',
							prefetch.checked ? '1' : '0',
							mode.value,
							speed.value,
							pref.value,
							block.value,
							logsz.value,
							bogusBox.value
						).then(function (res) {
							if (res && res.ok === false) {
								err.style.display = '';
								err.textContent = res.error || _('Failed');
								return;
							}
							location.reload();
						});
					}
				}, [ _('Save & Apply') ])
			])
		]);
	}
});
