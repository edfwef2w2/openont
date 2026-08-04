'use strict';
'require baseclass';
'require openont.chart-common as cc';
'require openont.buckets as buckets';

function appLabel(key) {
	var map = {
		http: _('HTTP'),
		video: _('Streaming video'),
		game: _('Online games'),
		download: _('Downloads'),
		file: _('File transfer'),
		im: _('Messaging'),
		common: _('Common protocols'),
		other_app: _('Other apps'),
		speedtest: _('Speed test'),
		unknown: _('Unknown apps')
	};
	return map[key] || key;
}

function drawPie(view, apps) {
	var canvas = document.getElementById('o-pie-canvas');
	var fit = cc.fitCanvas(canvas);
	if (!fit) return;
	var ctx = fit.ctx, w = fit.w, h = fit.h;
	view._pieSlices = [];
	view._lastApps = apps || {};

	var muted = cc.themeColor('--bw-gray-500', '#6b7f93');
	var text = cc.themeColor('--bw-gray-900', '#1a2433');
	var APP_KEYS = buckets.keys();
	var APP_COLORS = buckets.colors();

	var parts = [];
	APP_KEYS.forEach(function (k) {
		var v = Number((apps && apps[k]) || 0);
		if (v > 0)
			parts.push({ key: k, label: appLabel(k), value: v, color: APP_COLORS[k] || '#999' });
	});

	var total = parts.reduce(function (s, p) { return s + p.value; }, 0);
	if (total <= 0) {
		ctx.fillStyle = muted;
		ctx.font = '13px system-ui, -apple-system, "Segoe UI", sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(_('No data yet (sampling)'), w / 2, h / 2);
		return;
	}

	var sideLegend = w >= 260;
	var cx = sideLegend ? w * 0.34 : w * 0.5;
	var cy = sideLegend ? h / 2 : h * 0.42;
	var r = Math.min(sideLegend ? w * 0.34 : w * 0.42, sideLegend ? h * 0.42 : h * 0.32) * 0.92;
	var rInner = r * 0.58;
	var a0 = -Math.PI / 2;

	parts.forEach(function (p) {
		var a1 = a0 + (p.value / total) * Math.PI * 2;
		ctx.beginPath();
		ctx.moveTo(cx + Math.cos(a0) * rInner, cy + Math.sin(a0) * rInner);
		ctx.arc(cx, cy, r, a0, a1);
		ctx.arc(cx, cy, rInner, a1, a0, true);
		ctx.closePath();
		ctx.fillStyle = p.color;
		ctx.fill();
		view._pieSlices.push({
			a0: a0, a1: a1, cx: cx, cy: cy, r: r, rInner: rInner,
			label: p.label, value: p.value, color: p.color
		});
		a0 = a1;
	});

	ctx.fillStyle = text;
	ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(cc.fmtBytes(total), cx, cy - 7);
	ctx.fillStyle = muted;
	ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
	ctx.fillText(_('Total'), cx, cy + 10);

	var lx, ly, rowH = 20, maxW;
	if (sideLegend) {
		lx = w * 0.62;
		ly = Math.max(16, (h - parts.length * rowH) / 2);
		maxW = w - lx - 16;
	} else {
		lx = 12;
		ly = cy + r + 18;
		maxW = w - 28;
	}
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
	parts.forEach(function (p, i) {
		var y = ly + i * rowH;
		if (y > h - 6) return;
		var rr = 3;
		ctx.fillStyle = p.color;
		ctx.beginPath();
		ctx.moveTo(lx + rr, y - 5);
		ctx.arcTo(lx + 10, y - 5, lx + 10, y + 5, rr);
		ctx.arcTo(lx + 10, y + 5, lx, y + 5, rr);
		ctx.arcTo(lx, y + 5, lx, y - 5, rr);
		ctx.arcTo(lx, y - 5, lx + 10, y - 5, rr);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = text;
		var pct = ((p.value / total) * 100).toFixed(1);
		var label = p.label + '  ' + pct + '%';
		if (ctx.measureText(label).width > maxW) {
			while (label.length > 4 && ctx.measureText(label + '…').width > maxW)
				label = label.slice(0, -1);
			label += '…';
		}
		ctx.fillText(label, lx + 16, y);
	});
}

return baseclass.extend({
	__name__: 'openont.chart-pie',
	drawPie: drawPie,
	appLabel: appLabel
});
