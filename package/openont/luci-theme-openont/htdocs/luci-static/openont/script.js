/* OpenONT theme helpers */
(function () {
	function fmtRate(bps) {
		if (bps == null || isNaN(bps)) return '—';
		var u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
		var i = 0;
		var v = Number(bps);
		while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
		return v.toFixed(v >= 10 || i === 0 ? 0 : 2) + ' ' + u[i];
	}

	function fmtPct(x) {
		if (x == null || isNaN(x)) return '—';
		return Number(x).toFixed(0) + '%';
	}

	async function pollHeader() {
		var box = document.getElementById('o-header-stats');
		if (!box || typeof L === 'undefined' || !L.rpc) return;

		try {
			var data = await L.resolveDefault(L.rpc.declare({
				object: 'openont',
				method: 'status',
				expect: { '': {} }
			})(), {});

			var cpu = box.querySelector('[data-stat="cpu"]');
			var mem = box.querySelector('[data-stat="mem"]');
			var up = box.querySelector('[data-stat="up"]');
			var down = box.querySelector('[data-stat="down"]');
			if (cpu) cpu.textContent = 'CPU: ' + fmtPct(data.cpu);
			if (mem) mem.textContent = '内存: ' + fmtPct(data.mem);
			if (up) up.textContent = '上行: ' + fmtRate(data.tx_bps);
			if (down) down.textContent = '下行: ' + fmtRate(data.rx_bps);
		} catch (e) { /* ignore */ }
	}

	if (document.readyState === 'loading')
		document.addEventListener('DOMContentLoaded', function () {
			pollHeader();
			setInterval(pollHeader, 5000);
		});
	else {
		pollHeader();
		setInterval(pollHeader, 5000);
	}
})();
