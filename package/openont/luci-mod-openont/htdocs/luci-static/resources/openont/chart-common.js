'use strict';

function fmtRate(bps) {
	if (bps == null || isNaN(bps)) return '0 B/s';
	var u = [ 'B/s', 'KB/s', 'MB/s', 'GB/s' ];
	var i = 0, v = Number(bps);
	while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
	return (v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(2)) + ' ' + u[i];
}

function fmtBytes(n) {
	if (n == null || isNaN(n) || n <= 0) return '0 B';
	var u = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
	var i = 0, v = Number(n);
	while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
	return (v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(2)) + ' ' + u[i];
}

function rateParts(bps) {
	if (bps == null || isNaN(bps)) return { v: '0', u: 'B/s' };
	var u = [ 'B/s', 'KB/s', 'MB/s', 'GB/s' ];
	var i = 0, v = Number(bps);
	while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
	return { v: (v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(2)), u: u[i] };
}

function fmtClock(ts) {
	var d = new Date((ts || 0) * 1000);
	if (isNaN(d.getTime())) return '--:--:--';
	function z(n) { return n < 10 ? '0' + n : String(n); }
	return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
}

function themeColor(name, fallback) {
	try {
		var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return v || fallback;
	} catch (e) {
		return fallback;
	}
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

function fitCanvas(canvas) {
	if (!canvas) return null;
	var dpr = window.devicePixelRatio || 1;
	var rect = canvas.getBoundingClientRect();
	var cssW = Math.max(1, Math.round(rect.width));
	var cssH = Math.max(1, Math.round(rect.height));
	if (cssW <= 1 && canvas.clientWidth)
		cssW = canvas.clientWidth;
	if (cssH <= 1 && canvas.clientHeight)
		cssH = canvas.clientHeight;
	if (cssW <= 1)
		cssW = parseInt(canvas.getAttribute('width'), 10) || 320;
	if (cssH <= 1)
		cssH = parseInt(canvas.getAttribute('height'), 10) || 200;

	var bw = Math.max(1, Math.round(cssW * dpr));
	var bh = Math.max(1, Math.round(cssH * dpr));
	if (canvas.width !== bw || canvas.height !== bh) {
		canvas.width = bw;
		canvas.height = bh;
	}
	var ctx = canvas.getContext('2d');
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, cssW, cssH);
	return { ctx: ctx, w: cssW, h: cssH, dpr: dpr };
}

function ratePads(w, ctx, tickLabels) {
	var padR = 12, padT = 16, padB = 22;
	var padL;
	var gap = 8;
	var minL = 44;
	var maxL = Math.min(100, Math.max(minL, Math.round(w * 0.32)));

	if (ctx && tickLabels && tickLabels.length) {
		ctx.save();
		ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
		var maxW = 0;
		for (var i = 0; i < tickLabels.length; i++) {
			var mw = ctx.measureText(String(tickLabels[i])).width;
			if (mw > maxW) maxW = mw;
		}
		ctx.restore();
		padL = Math.ceil(maxW) + gap;
	} else {
		padL = clamp(Math.round(w * 0.12), minL, 72);
	}
	padL = clamp(padL, minL, maxL);
	if (padL + padR + 40 > w)
		padL = Math.max(minL, w - padR - 40);
	return { L: padL, R: padR, T: padT, B: padB };
}

function rateAxisTicks(maxV) {
	var labels = [];
	for (var g = 0; g < 4; g++)
		labels.push(fmtRate(maxV * (1 - g / 3)));
	return labels;
}

function ensureTipHost(tip) {
	if (!tip || !document.body)
		return tip;
	if (tip.parentNode !== document.body)
		document.body.appendChild(tip);
	return tip;
}

function placeChartTip(tip, clientX, clientY) {
	if (!tip) return;
	tip = ensureTipHost(tip);
	var pad = 8;
	var gap = 12;
	tip.style.display = 'block';
	tip.style.position = 'fixed';
	tip.style.zIndex = '10050';
	var tw = tip.offsetWidth || 120;
	var th = tip.offsetHeight || 32;
	var vw = window.innerWidth || document.documentElement.clientWidth || 800;
	var vh = window.innerHeight || document.documentElement.clientHeight || 600;
	var left = clientX + gap;
	var top = clientY + gap;
	if (left + tw > vw - pad)
		left = clientX - tw - gap;
	if (top + th > vh - pad)
		top = clientY - th - gap;
	if (left < pad)
		left = pad;
	if (top < pad)
		top = pad;
	tip.style.left = Math.round(left) + 'px';
	tip.style.top = Math.round(top) + 'px';
}

function hideTip(tip) {
	if (tip) tip.style.display = 'none';
}

return {
	fmtRate: fmtRate,
	fmtBytes: fmtBytes,
	rateParts: rateParts,
	fmtClock: fmtClock,
	themeColor: themeColor,
	clamp: clamp,
	fitCanvas: fitCanvas,
	ratePads: ratePads,
	rateAxisTicks: rateAxisTicks,
	ensureTipHost: ensureTipHost,
	placeChartTip: placeChartTip,
	hideTip: hideTip
};
