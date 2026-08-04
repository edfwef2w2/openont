'use strict';
'require baseclass';
'require openont.chart-common as cc';
'require openont.chart-rate as chartRate';

function moveTipsToBody(root) {
	var tips = [];
	if (root && root.querySelectorAll)
		tips = root.querySelectorAll('.o-chart-tip');
	if (!tips.length) {
		['o-pie-tip', 'o-rate-tip-up', 'o-rate-tip-down'].forEach(function (id) {
			var el = document.getElementById(id);
			if (el) tips = Array.prototype.concat.call(tips, [el]);
		});
	}
	Array.prototype.forEach.call(tips, function (el) {
		cc.ensureTipHost(el);
	});
}

function localXY(canvas, clientX, clientY) {
	var rect = canvas.getBoundingClientRect();
	return {
		x: clientX - rect.left,
		y: clientY - rect.top,
		rect: rect
	};
}

function hitPie(view, clientX, clientY) {
	var canvas = document.getElementById('o-pie-canvas');
	if (!canvas)
		return null;
	var loc = localXY(canvas, clientX, clientY);
	var slices = view._pieSlices || [];
	var i, s, dx, dy, dist, ang, a0, a1, twoPi = Math.PI * 2;

	for (i = 0; i < slices.length; i++) {
		s = slices[i];
		dx = loc.x - s.cx;
		dy = loc.y - s.cy;
		dist = Math.sqrt(dx * dx + dy * dy);
		if (dist > s.r || dist < (s.rInner || 0))
			continue;
		ang = Math.atan2(dy, dx);
		a0 = s.a0;
		a1 = s.a1;
		while (ang < a0)
			ang += twoPi;
		while (ang >= a0 + twoPi)
			ang -= twoPi;
		if (ang <= a1 + 1e-9)
			return s;
	}
	return null;
}

function sharedPads(view, width) {
	var rate = view._geom && view._geom.rate;
	if (rate && rate.shared && rate.shared.pads)
		return rate.shared.pads;
	if (view._lastRatePads)
		return view._lastRatePads;
	return cc.ratePads(width || 640, null, null);
}

function hitRate(view, canvas, clientX, clientY) {
	var pts = view._rateWindow || [];
	if (!canvas || pts.length < 1)
		return null;
	var loc = localXY(canvas, clientX, clientY);
	var pads = sharedPads(view, loc.rect.width);
	var padL = pads.L, padR = pads.R;
	var plotW = Math.max(1, loc.rect.width - padL - padR);
	var ratio = (loc.x - padL) / plotW;
	if (ratio < 0) ratio = 0;
	if (ratio > 1) ratio = 1;
	var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
	if (t1 <= t0) t1 = t0 + 1;
	var t = t0 + ratio * (t1 - t0);
	var best = 0, bestD = Infinity, i, d;
	for (i = 0; i < pts.length; i++) {
		d = Math.abs(pts[i].t - t);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return { idx: best, pt: pts[best] };
}

function showPieTip(ev, slice) {
	var tip = document.getElementById('o-pie-tip');
	if (!tip || !slice)
		return;
	tip.textContent = slice.label + '：' + cc.fmtBytes(slice.value);
	cc.placeChartTip(tip, ev.clientX, ev.clientY);
}

function showRateTip(ev, pt) {
	var tipUp = document.getElementById('o-rate-tip-up');
	var tipDown = document.getElementById('o-rate-tip-down');
	if (!tipUp || !pt)
		return;
	var time = cc.fmtClock(pt.t);
	tipUp.textContent = time + '  ' + _('Upload') + '：' + cc.fmtRate(pt.tx) +
		'  ' + _('Download') + '：' + cc.fmtRate(pt.rx);
	cc.placeChartTip(tipUp, ev.clientX, ev.clientY);
	if (tipDown)
		cc.hideTip(tipDown);
}

function hideAllTips() {
	cc.hideTip(document.getElementById('o-pie-tip'));
	cc.hideTip(document.getElementById('o-rate-tip-up'));
	cc.hideTip(document.getElementById('o-rate-tip-down'));
}

function onPointerMove(view, ev) {
	var t = ev.target;
	if (!t || !t.id)
		return;

	if (t.id === 'o-pie-canvas') {
		view._pointer = { kind: 'pie', clientX: ev.clientX, clientY: ev.clientY };
		var s = hitPie(view, ev.clientX, ev.clientY);
		if (!s) {
			cc.hideTip(document.getElementById('o-pie-tip'));
			return;
		}
		showPieTip(ev, s);
		return;
	}

	if (t.id === 'o-rate-up-canvas' || t.id === 'o-rate-down-canvas') {
		view._pointer = {
			kind: 'rate',
			canvasId: t.id,
			clientX: ev.clientX,
			clientY: ev.clientY
		};
		var hit = hitRate(view, t, ev.clientX, ev.clientY);
		if (!hit) {
			hideAllTips();
			return;
		}
		if (view._hoverIdx !== hit.idx) {
			view._hoverIdx = hit.idx;
			chartRate.drawRateCharts(view);
		}
		showRateTip(ev, hit.pt);
	}
}

function onPointerLeave(view, ev) {
	var t = ev.target;
	if (!t || !t.id)
		return;
	if (t.id === 'o-pie-canvas' || t.id === 'o-rate-up-canvas' || t.id === 'o-rate-down-canvas') {
		view._pointer = null;
		view._hoverIdx = -1;
		if (t.id !== 'o-pie-canvas')
			chartRate.drawRateCharts(view);
		hideAllTips();
	}
}

function bind(view, root) {
	moveTipsToBody(root);
	view._hoverIdx = -1;
	view._pointer = null;
	view._geom = view._geom || { rate: {} };

	var strip = (root && root.querySelector)
		? (root.querySelector('.o-charts-strip') || root)
		: document.querySelector('.o-charts-strip');
	if (!strip)
		return;

	if (view._hoverBound)
		return;
	view._hoverBound = true;

	strip.addEventListener('pointermove', function (ev) {
		onPointerMove(view, ev);
	});
	strip.addEventListener('pointerleave', function (ev) {
		if (ev.target === strip) {
			view._pointer = null;
			view._hoverIdx = -1;
			chartRate.drawRateCharts(view);
			hideAllTips();
		}
	});

	/* Prefer root-scoped nodes (works while detached); fall back after mount. */
	function attachCanvasLeave() {
		['o-pie-canvas', 'o-rate-up-canvas', 'o-rate-down-canvas'].forEach(function (id) {
			var c = (root && root.querySelector) ? root.querySelector('#' + id) : null;
			if (!c)
				c = document.getElementById(id);
			if (!c || c._oHoverLeave)
				return;
			c._oHoverLeave = true;
			c.addEventListener('pointerleave', function (ev) {
				onPointerLeave(view, ev);
			});
		});
		moveTipsToBody(root);
	}
	attachCanvasLeave();
	requestAnimationFrame(attachCanvasLeave);
}

function resync(view) {
	var p = view && view._pointer;
	if (!p || view._paintingCharts)
		return;
	var fake = { clientX: p.clientX, clientY: p.clientY, target: null };
	if (p.kind === 'pie') {
		fake.target = document.getElementById('o-pie-canvas');
		if (fake.target)
			onPointerMove(view, fake);
		return;
	}
	if (p.kind === 'rate' && p.canvasId) {
		fake.target = document.getElementById(p.canvasId);
		if (fake.target)
			onPointerMove(view, fake);
	}
}

return baseclass.extend({
	__name__: 'openont.chart-hover',
	bind: bind,
	resync: resync,
	hitPie: hitPie,
	hitRate: hitRate,
	moveTipsToBody: moveTipsToBody
});
