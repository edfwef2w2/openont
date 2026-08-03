'use strict';
'require openont.chart-common as cc';

function drawLine(view, id, pts, key, color, label) {
	var canvas = document.getElementById(id);
	var fit = cc.fitCanvas(canvas);
	if (!fit) return;
	var ctx = fit.ctx, w = fit.w, h = fit.h;

	var maxV = 1;
	(pts || []).forEach(function (p) {
		if (p[key] > maxV) maxV = p[key];
	});
	maxV = maxV * 1.15;

	var ticks = cc.rateAxisTicks(maxV);
	var pads = cc.ratePads(w, ctx, ticks);
	view._lastRatePads = pads;
	view._lastRateMaxV = maxV;

	var padL = pads.L, padR = pads.R, padT = pads.T, padB = pads.B;
	var plotW = w - padL - padR, plotH = h - padT - padB;
	var grid = cc.themeColor('--bw-gray-200', '#dce6f0');
	var muted = cc.themeColor('--bw-gray-500', '#6b7f93');
	var hoverLine = cc.themeColor('--bw-gray-700', '#3a4a5c');

	ctx.strokeStyle = grid;
	ctx.lineWidth = 1;
	ctx.fillStyle = muted;
	ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
	ctx.textAlign = 'right';
	ctx.textBaseline = 'middle';

	for (var g = 0; g < 4; g++) {
		var y = padT + (plotH * g / 3);
		ctx.beginPath();
		ctx.moveTo(padL, y);
		ctx.lineTo(w - padR, y);
		ctx.stroke();
		ctx.fillText(ticks[g], padL - 4, y);
	}

	if (!pts || pts.length < 2) {
		ctx.fillStyle = muted;
		ctx.textAlign = 'center';
		ctx.fillText(_('Sampling…'), w / 2, h / 2);
		return;
	}

	var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
	if (t1 <= t0) t1 = t0 + 1;

	function ptXY(p) {
		return {
			x: padL + ((p.t - t0) / (t1 - t0)) * plotW,
			y: padT + plotH - (p[key] / maxV) * plotH
		};
	}

	ctx.beginPath();
	pts.forEach(function (p, i) {
		var xy = ptXY(p);
		if (i === 0) ctx.moveTo(xy.x, xy.y); else ctx.lineTo(xy.x, xy.y);
	});
	var last = ptXY(pts[pts.length - 1]);
	var first = ptXY(pts[0]);
	ctx.lineTo(last.x, padT + plotH);
	ctx.lineTo(first.x, padT + plotH);
	ctx.closePath();
	ctx.save();
	ctx.globalAlpha = 0.14;
	ctx.fillStyle = color;
	ctx.fill();
	ctx.restore();

	ctx.strokeStyle = color;
	ctx.lineWidth = 2;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.beginPath();
	pts.forEach(function (p, i) {
		var xy = ptXY(p);
		if (i === 0) ctx.moveTo(xy.x, xy.y); else ctx.lineTo(xy.x, xy.y);
	});
	ctx.stroke();

	var hi = view._hoverIdx;
	if (hi >= 0 && hi < pts.length) {
		var hxy = ptXY(pts[hi]);
		ctx.strokeStyle = hoverLine;
		ctx.globalAlpha = 0.35;
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 3]);
		ctx.beginPath();
		ctx.moveTo(hxy.x, padT);
		ctx.lineTo(hxy.x, padT + plotH);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(hxy.x, hxy.y, 4, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = cc.themeColor('--bw-white', '#fff');
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}

	ctx.fillStyle = color;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'alphabetic';
	ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
	ctx.fillText(label, padL + 4, padT + 12);
}

function drawRateCharts(view) {
	var upColor = cc.themeColor('--bw-warn', '#d97706');
	var downColor = cc.themeColor('--bw-blue-500', '#1a7fd4');
	drawLine(view, 'o-rate-up-canvas', view._rateWindow, 'tx', upColor, _('Upload'));
	drawLine(view, 'o-rate-down-canvas', view._rateWindow, 'rx', downColor, _('Download'));
}

function bindRateHover(view) {
	var up = document.getElementById('o-rate-up-canvas');
	var down = document.getElementById('o-rate-down-canvas');
	if (!up || !down) return;

	function onMove(ev, canvas) {
		var pts = view._rateWindow || [];
		if (pts.length < 1) return;
		var rect = canvas.getBoundingClientRect();
		var maxV = view._lastRateMaxV || 1;
		var pads = view._lastRatePads || cc.ratePads(rect.width, null, null);
		var padL = pads.L, padR = pads.R;
		var plotW = Math.max(1, rect.width - padL - padR);
		var x = ev.clientX - rect.left;
		var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
		if (t1 <= t0) t1 = t0 + 1;
		var ratio = (x - padL) / plotW;
		if (ratio < 0) ratio = 0;
		if (ratio > 1) ratio = 1;
		var t = t0 + ratio * (t1 - t0);
		var best = 0, bestD = Infinity;
		for (var i = 0; i < pts.length; i++) {
			var d = Math.abs(pts[i].t - t);
			if (d < bestD) { bestD = d; best = i; }
		}
		view._hoverIdx = best;
		drawRateCharts(view);
		showRateTips(ev, pts[best]);
	}

	function onLeave() {
		view._hoverIdx = -1;
		drawRateCharts(view);
		hideRateTips();
	}

	up.addEventListener('mousemove', function (ev) { onMove(ev, up); });
	down.addEventListener('mousemove', function (ev) { onMove(ev, down); });
	up.addEventListener('mouseleave', onLeave);
	down.addEventListener('mouseleave', onLeave);
}

function showRateTips(ev, pt) {
	var tipUp = document.getElementById('o-rate-tip-up');
	var tipDown = document.getElementById('o-rate-tip-down');
	if (!tipUp || !pt) return;
	var time = cc.fmtClock(pt.t);
	tipUp.textContent = time + '  ' + _('Upload') + '：' + cc.fmtRate(pt.tx) +
		'  ' + _('Download') + '：' + cc.fmtRate(pt.rx);
	cc.placeChartTip(tipUp, ev.clientX, ev.clientY);
	if (tipDown)
		cc.hideTip(tipDown);
}

function hideRateTips() {
	cc.hideTip(document.getElementById('o-rate-tip-up'));
	cc.hideTip(document.getElementById('o-rate-tip-down'));
}

return {
	drawRateCharts: drawRateCharts,
	bindRateHover: bindRateHover,
	drawLine: drawLine
};
