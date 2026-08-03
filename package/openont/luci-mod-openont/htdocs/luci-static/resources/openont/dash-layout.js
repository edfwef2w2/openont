'use strict';
'require openont.chart-common as cc';

function directChartBoxes(card) {
	var out = [];
	if (!card) return out;
	for (var i = 0; i < card.children.length; i++) {
		var el = card.children[i];
		if (el.classList && el.classList.contains('o-chart-box'))
			out.push(el);
	}
	return out;
}

function updateDashUnit(root) {
	if (!root) return null;

	var BASE = 1100;
	var screenW = 1920;
	try {
		if (window.screen)
			screenW = window.screen.availWidth || window.screen.width || screenW;
	} catch (e) { /* ignore */ }
	if (!screenW || screenW < 1)
		screenW = 1920;

	var winW = window.innerWidth || document.documentElement.clientWidth || screenW;
	if (winW < 1)
		winW = screenW;
	var ratio = winW / screenW;

	var mode = document.documentElement.getAttribute('data-layout-mode');
	if (mode !== 'narrow' && mode !== 'normal' && mode !== 'wide2x') {
		if (typeof window.openontDetectLayoutMode === 'function')
			mode = window.openontDetectLayoutMode();
		else if (ratio > 2 / 3)
			mode = 'wide2x';
		else if (ratio > 1 / 3)
			mode = 'normal';
		else
			mode = 'narrow';
	}

	var avail = 0;
	var main = document.getElementById('maincontent');
	if (main && main.clientWidth > 0)
		avail = main.clientWidth;
	else if (root.parentElement && root.parentElement.clientWidth > 0)
		avail = root.parentElement.clientWidth;
	else
		avail = winW;

	if (main) {
		try {
			var mcs = getComputedStyle(main);
			var pl = parseFloat(mcs.paddingLeft) || 0;
			var pr = parseFloat(mcs.paddingRight) || 0;
			if (pl + pr > 0 && avail > pl + pr)
				avail = avail - pl - pr;
		} catch (e2) { /* ignore */ }
	}
	if (avail < 1)
		avail = winW;

	var U;
	if (mode === 'narrow')
		U = Math.max(1, avail);
	else if (mode === 'wide2x')
		U = Math.min(avail, BASE * 2);
	else
		U = Math.min(avail, BASE);

	var packCapacity = mode === 'wide2x' ? 2 : 1;

	root.style.maxWidth = U + 'px';
	root.style.setProperty('--o-dash-unit', U + 'px');
	root.style.setProperty('--o-pack-capacity', String(packCapacity));
	root.classList.toggle('is-narrow', mode === 'narrow');
	root.classList.toggle('is-wide2x', mode === 'wide2x');
	root.setAttribute('data-dash-mode', mode);
	root.setAttribute('data-pack-capacity', String(packCapacity));
	root.setAttribute('data-win-ratio', (Math.round(ratio * 1000) / 1000).toFixed(3));

	applySpanLayout(root, mode, packCapacity);

	return {
		U: U, avail: avail, mode: mode, packCapacity: packCapacity,
		winW: winW, screenW: screenW, ratio: ratio
	};
}

function applySpanLayout(root, mode, packCapacity) {
	if (!root) return;
	var cols = root.querySelectorAll('.o-dash > .o-col[data-span]');
	var i, col, span, pct, grow, isStrip;

	if (mode === 'narrow') {
		for (i = 0; i < cols.length; i++) {
			cols[i].style.flex = '0 0 100%';
			cols[i].style.width = '100%';
			cols[i].style.maxWidth = '100%';
			cols[i].style.minWidth = '0';
		}
		return;
	}

	var cap = packCapacity > 0 ? packCapacity : 1;
	for (i = 0; i < cols.length; i++) {
		col = cols[i];
		span = parseFloat(col.getAttribute('data-span'));
		if (!(span > 0))
			span = 1;
		isStrip = col.classList.contains('o-charts-strip');
		if (isStrip) {
			pct = 100;
			grow = 0;
		} else {
			pct = (span / cap) * 100;
			grow = span >= 1 ? 1 : 0;
		}
		col.style.flex = (grow ? '1' : '0') + ' 0 ' + pct + '%';
		col.style.width = pct + '%';
		col.style.maxWidth = grow ? '100%' : (pct + '%');
		col.style.minWidth = '0';
	}
}

function layoutChartBoxes(root) {
	if (!root) return;

	var MIN_PIE = 200, MAX_PIE = 340;
	var MIN_SM = 100, MAX_SM = 180;
	var GAP = 8;

	function setH(el, px) {
		var next = px + 'px';
		if (el.style.height !== next)
			el.style.height = next;
	}

	var pair = root.querySelector('.o-charts-pair');
	var groups = [];
	var cards = pair
		? pair.querySelectorAll('.o-card')
		: root.querySelectorAll('.o-dash .o-card');

	for (var c = 0; c < cards.length; c++) {
		var card = cards[c];
		var boxes = directChartBoxes(card);
		if (!boxes.length) continue;
		var cs = getComputedStyle(card);
		var pl = parseFloat(cs.paddingLeft) || 0;
		var pr = parseFloat(cs.paddingRight) || 0;
		var contentW = Math.max(1, card.clientWidth - pl - pr);
		if (boxes[0].clientWidth > 1)
			contentW = boxes[0].clientWidth;
		groups.push({ boxes: boxes, n: boxes.length, contentW: contentW });
	}

	if (!groups.length) return;

	var targetBody = 0;
	for (var g = 0; g < groups.length; g++) {
		var item = groups[g];
		var body;
		if (item.n === 1) {
			body = cc.clamp(Math.round(item.contentW * 0.90), MIN_PIE, MAX_PIE);
		} else {
			var each = cc.clamp(Math.round(item.contentW * 0.24), MIN_SM, MAX_SM);
			body = each * item.n + GAP * (item.n - 1);
		}
		if (body > targetBody) targetBody = body;
	}

	for (var g2 = 0; g2 < groups.length; g2++) {
		var grp = groups[g2];
		if (grp.n === 1) {
			setH(grp.boxes[0], targetBody);
		} else {
			var hEach = Math.max(
				MIN_SM,
				Math.floor((targetBody - GAP * (grp.n - 1)) / grp.n)
			);
			for (var b = 0; b < grp.n; b++)
				setH(grp.boxes[b], hEach);
		}
	}
}

function bindChartResize(view) {
	function schedule() {
		if (view._paintingCharts) return;
		if (view._resizeTimer)
			clearTimeout(view._resizeTimer);
		view._resizeTimer = setTimeout(function () {
			view._paintCharts();
		}, 80);
	}

	if (view._onChartResize)
		window.removeEventListener('resize', view._onChartResize);
	view._onChartResize = schedule;
	window.addEventListener('resize', view._onChartResize);

	requestAnimationFrame(function () {
		var root = view._overviewRoot || document.querySelector('.o-overview');
		if (typeof ResizeObserver === 'undefined' || !root) return;
		if (view._chartRO)
			view._chartRO.disconnect();
		view._chartRO = new ResizeObserver(schedule);
		view._chartRO.observe(root);
	});
}

return {
	updateDashUnit: updateDashUnit,
	applySpanLayout: applySpanLayout,
	layoutChartBoxes: layoutChartBoxes,
	bindChartResize: bindChartResize,
	directChartBoxes: directChartBoxes
};
