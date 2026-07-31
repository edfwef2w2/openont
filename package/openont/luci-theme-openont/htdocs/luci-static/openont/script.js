/* OpenONT theme — accordion sidebar + light/dark toggle */
(function () {
	var THEME_KEY = 'openont-theme-dark';

	function tr(s) {
		try {
			if (typeof _ === 'function')
				return _(s);
			if (typeof L !== 'undefined' && typeof L._ === 'function')
				return L._(s);
		} catch (e) { /* ignore */ }
		return s;
	}

	function isDark() {
		return document.documentElement.getAttribute('data-darkmode') === 'true';
	}

	function applyTheme(dark) {
		document.documentElement.setAttribute('data-darkmode', dark ? 'true' : 'false');
		document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
		try {
			localStorage.setItem(THEME_KEY, dark ? '1' : '0');
		} catch (e) { /* ignore */ }

		var btn = document.getElementById('bw-theme-toggle');
		if (!btn)
			return;

		btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
		var label = btn.querySelector('.bw-theme-toggle-text');
		/* Label + icon = mode you will switch TO (not current) */
		if (label)
			label.textContent = dark ? tr('Light mode') : tr('Dark mode');
		btn.title = tr('Toggle light / dark mode');
	}

	function initThemeToggle() {
		applyTheme(isDark());

		var btn = document.getElementById('bw-theme-toggle');
		if (btn && !btn._bwBound) {
			btn._bwBound = true;
			btn.addEventListener('click', function () {
				applyTheme(!isDark());
			});
		}

		/* Enable color transitions after first paint */
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				document.documentElement.classList.add('bw-theme-ready');
			});
		});
	}

	function pathMatches(href, pathParts) {
		if (!href || href === '#')
			return false;
		try {
			var a = document.createElement('a');
			a.href = href;
			var parts = (a.pathname || '').split('/').filter(Boolean);
			/* path often ends with .../cgi-bin/luci/admin/cat/page */
			var idx = parts.lastIndexOf('luci');
			var rest = idx >= 0 ? parts.slice(idx + 1) : parts;
			if (rest.length < pathParts.length)
				return false;
			for (var i = 0; i < pathParts.length; i++) {
				if (rest[i] !== pathParts[i])
					return false;
			}
			return true;
		} catch (e) {
			return false;
		}
	}

	function dispatchPath() {
		if (typeof L !== 'undefined' && L.env && L.env.dispatchpath && L.env.dispatchpath.length)
			return L.env.dispatchpath.slice();
		var dp = document.body && document.body.getAttribute('data-page');
		return dp ? dp.split('-').filter(Boolean) : [];
	}

	function markActiveAndOpen() {
		var top = document.getElementById('topmenu');
		if (!top)
			return;

		var path = dispatchPath();
		/* requestpath for admin is typically ['admin', cat, page, ...] */
		var want = path.length && path[0] === 'admin' ? path : ['admin'].concat(path);

		var links = top.querySelectorAll('a[href]');
		var activeLink = null;

		links.forEach(function (a) {
			var li = a.parentElement;
			if (li)
				li.classList.remove('active');
			if (pathMatches(a.getAttribute('href'), want) ||
			    (want.length >= 3 && pathMatches(a.getAttribute('href'), want.slice(0, 3)))) {
				/* Prefer deepest match */
				if (!activeLink || a.getAttribute('href').length >= activeLink.getAttribute('href').length)
					activeLink = a;
			}
		});

		/* Fallback: match by category only */
		if (!activeLink && want.length >= 2) {
			links.forEach(function (a) {
				if (pathMatches(a.getAttribute('href'), want.slice(0, 2)))
					activeLink = a;
			});
		}

		if (activeLink) {
			var node = activeLink.parentElement;
			if (node)
				node.classList.add('active');
			/* Open ancestor dropdowns */
			var p = activeLink.closest('li.dropdown');
			if (p) {
				p.classList.add('open');
				var menuA = p.querySelector(':scope > a.menu');
				if (menuA)
					menuA.setAttribute('aria-expanded', 'true');
			}
		}
	}

	function closeAllDropdowns(except) {
		var top = document.getElementById('topmenu');
		if (!top)
			return;
		top.querySelectorAll('li.dropdown.open').forEach(function (li) {
			if (except && li === except)
				return;
			li.classList.remove('open');
			var a = li.querySelector(':scope > a.menu');
			if (a)
				a.setAttribute('aria-expanded', 'false');
		});
	}

	function onMenuClick(ev) {
		var a = ev.target.closest && ev.target.closest('a.menu');
		if (!a || !document.getElementById('topmenu') || !document.getElementById('topmenu').contains(a))
			return;

		var li = a.parentElement;
		if (!li || !li.classList.contains('dropdown'))
			return;

		ev.preventDefault();
		ev.stopPropagation();

		var open = li.classList.contains('open');
		closeAllDropdowns(null);
		if (!open) {
			li.classList.add('open');
			a.setAttribute('aria-expanded', 'true');
		} else {
			a.setAttribute('aria-expanded', 'false');
		}
	}

	function markMenuReady() {
		var top = document.getElementById('topmenu');
		if (top && top.children.length)
			top.classList.add('bw-menu-ready');
	}

	function initAccordion() {
		/* Capture phase so we win over default navigation on href="#" */
		if (!document._bwAccordion) {
			document._bwAccordion = true;
			document.addEventListener('click', onMenuClick, true);
		}
		markActiveAndOpen();
		markMenuReady();
	}

	/**
	 * Scheme A + full fade-out:
	 *  - Appear: Dark mode + pills share layout dy; opacity 0→1 together.
	 *  - Exit: nodes are already removed by LuCI — rebuild fixed clones from
	 *    a live position snapshot and fade/move them with the same dy as
	 *    Dark mode FLIP, then drop the layer.
	 */
	function initIndicatorFlip() {
		var box = document.getElementById('indicators');
		var theme = document.getElementById('bw-theme-switch') ||
			document.querySelector('.bw-theme-switch');
		var hdr = (box && box.closest('header')) || document.querySelector('header');
		var toggle = theme && theme.querySelector('.bw-theme-toggle');
		if (!box || !theme || box._bwFlipBound)
			return;
		box._bwFlipBound = true;

		var DUR = 0.42;
		var EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
		var TRANS_T = 'transform ' + DUR + 's ' + EASE;
		var TRANS_BOTH = 'transform ' + DUR + 's ' + EASE + ', opacity ' + DUR + 's ' + EASE;
		var MS = DUR * 1000 + 40;

		var prevTop = theme.getBoundingClientRect().top;
		var prevCount = box.querySelectorAll('[data-indicator]').length;
		var flipTimer = null;
		var exitLayer = null;
		var savedToggleTransition = '';
		/* Live snapshot of pill geometry while visible (for exit clones) */
		var pillSnapshot = [];
		var reduceMotion = false;
		try {
			reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		} catch (e) { /* ignore */ }

		function pillsNow() {
			return Array.prototype.slice.call(box.querySelectorAll('[data-indicator]'));
		}

		function snapshotPills() {
			pillSnapshot = pillsNow().map(function (p) {
				var r = p.getBoundingClientRect();
				return {
					text: p.textContent || '',
					style: p.getAttribute('data-style') || 'active',
					clickable: p.getAttribute('data-clickable'),
					indicator: p.getAttribute('data-indicator') || 'exit',
					top: r.top,
					left: r.left,
					width: r.width,
					height: r.height
				};
			});
		}

		function hidePillHard(p) {
			p.style.transition = 'none';
			p.style.opacity = '0';
			p.style.visibility = 'hidden';
			p.classList.add('bw-indicator-pending');
		}

		function unlockChrome() {
			if (hdr) {
				hdr.classList.remove('bw-flipping');
				hdr.style.overflowY = '';
				hdr.style.overflowX = '';
			}
			if (toggle)
				toggle.style.transition = savedToggleTransition;
		}

		function clearMotion(els) {
			(els || []).forEach(function (el) {
				if (!el)
					return;
				el.style.transition = '';
				el.style.transform = '';
				el.style.opacity = '';
				el.style.visibility = '';
				el.classList.remove('bw-indicator-pending');
			});
			unlockChrome();
			prevTop = theme.getBoundingClientRect().top;
			if (pillsNow().length)
				snapshotPills();
		}

		function removeExitLayer() {
			if (exitLayer && exitLayer.parentNode)
				exitLayer.parentNode.removeChild(exitLayer);
			exitLayer = null;
		}

		function lockSidebarOverflow() {
			if (!hdr)
				return;
			hdr.classList.add('bw-flipping');
			hdr.style.overflowY = 'hidden';
			hdr.style.overflowX = 'hidden';
		}

		function prepareToggle() {
			if (!toggle)
				return;
			savedToggleTransition = toggle.style.transition;
			toggle.style.transition = 'none';
		}

		/** Appear: re-bind dy + opacity fade-in */
		function flipAppear() {
			if (reduceMotion) {
				pillsNow().forEach(function (p) {
					p.style.opacity = '';
					p.style.visibility = '';
					p.style.transform = '';
					p.classList.remove('bw-indicator-pending');
				});
				prevTop = theme.getBoundingClientRect().top;
				snapshotPills();
				return;
			}

			/* Cancel in-flight exit/appear */
			if (flipTimer)
				clearTimeout(flipTimer);
			removeExitLayer();

			var last = theme.getBoundingClientRect().top;
			var dy = prevTop - last;
			var pills = pillsNow();
			var targets = [theme].concat(pills);
			prevTop = last;

			var needThemeFlip = Math.abs(dy) >= 0.5;
			if (!needThemeFlip && !pills.length) {
				clearMotion(targets);
				return;
			}

			lockSidebarOverflow();
			prepareToggle();

			/*
			 * Snapshot final layout slots NOW (pills are in place, still
			 * hidden, no transform) so a quick remove can still fade out.
			 */
			snapshotPills();

			if (needThemeFlip) {
				theme.style.transition = 'none';
				theme.style.transform = 'translateY(' + dy + 'px)';
			}

			pills.forEach(function (p) {
				p.style.transition = 'none';
				p.style.opacity = '0';
				p.style.visibility = 'hidden';
				p.style.transform = needThemeFlip
					? 'translateY(' + dy + 'px)'
					: 'translateY(0)';
			});

			void theme.offsetWidth;

			requestAnimationFrame(function () {
				if (needThemeFlip) {
					theme.style.transition = TRANS_T;
					theme.style.transform = 'translateY(0)';
				}
				pills.forEach(function (p) {
					p.style.visibility = 'visible';
					p.classList.remove('bw-indicator-pending');
					p.style.transition = TRANS_BOTH;
					p.style.transform = 'translateY(0)';
					p.style.opacity = '1';
				});
			});

			flipTimer = setTimeout(function () {
				clearMotion(targets);
				snapshotPills();
			}, MS);
		}

		/**
		 * Exit: DOM already empty — paint fixed clones from pillSnapshot,
		 * FLIP Dark mode, fade/move clones with the same dy.
		 */
		function flipExit(removedNodes) {
			if (reduceMotion) {
				prevTop = theme.getBoundingClientRect().top;
				pillSnapshot = [];
				return;
			}

			if (flipTimer)
				clearTimeout(flipTimer);
			removeExitLayer();

			/* Cancel mid-appear transforms so measurements are layout-true */
			theme.style.transition = 'none';
			theme.style.transform = '';

			/* Prefer live snapshot; fall back to removedNodes text only */
			var shots = pillSnapshot.slice();
			if (!shots.length && removedNodes && removedNodes.length) {
				var boxRect = box.getBoundingClientRect();
				var y = boxRect.top + 8;
				removedNodes.forEach(function (n, i) {
					if (n.nodeType !== 1 || !n.hasAttribute || !n.hasAttribute('data-indicator'))
						return;
					shots.push({
						text: n.textContent || '',
						style: n.getAttribute('data-style') || 'active',
						clickable: n.getAttribute('data-clickable'),
						indicator: n.getAttribute('data-indicator') || 'exit',
						top: y + i * 28,
						left: boxRect.left + 14,
						width: 0,
						height: 0
					});
				});
			}

			var last = theme.getBoundingClientRect().top;
			var dy = prevTop - last;
			prevTop = last;

			var needThemeFlip = Math.abs(dy) >= 0.5;
			if (!needThemeFlip && !shots.length) {
				pillSnapshot = [];
				return;
			}

			lockSidebarOverflow();
			prepareToggle();
			removeExitLayer();

			/* Fixed clone layer (nodes already gone from #indicators) */
			var clones = [];
			if (shots.length) {
				exitLayer = document.createElement('div');
				exitLayer.className = 'bw-indicator-exit-layer';
				exitLayer.setAttribute('aria-hidden', 'true');
				shots.forEach(function (s) {
					var c = document.createElement('span');
					c.setAttribute('data-indicator', s.indicator);
					c.setAttribute('data-style', s.style);
					if (s.clickable)
						c.setAttribute('data-clickable', s.clickable);
					c.className = 'bw-indicator-exit-clone';
					c.textContent = s.text;
					c.style.position = 'fixed';
					c.style.left = s.left + 'px';
					c.style.top = s.top + 'px';
					c.style.margin = '0';
					c.style.zIndex = '961';
					c.style.boxSizing = 'border-box';
					if (s.width)
						c.style.minWidth = s.width + 'px';
					c.style.transition = 'none';
					c.style.transform = 'translateY(0)';
					c.style.opacity = '1';
					exitLayer.appendChild(c);
					clones.push(c);
				});
				document.body.appendChild(exitLayer);
			}

			if (needThemeFlip) {
				theme.style.transition = 'none';
				theme.style.transform = 'translateY(' + dy + 'px)';
			}
			void theme.offsetWidth;

			requestAnimationFrame(function () {
				if (needThemeFlip) {
					theme.style.transition = TRANS_T;
					theme.style.transform = 'translateY(0)';
				}
				/*
				 * Theme layout moved by (last - first) = -dy.
				 * Clones ride the same delta and fade out (bound exit).
				 */
				var cloneDy = -dy;
				clones.forEach(function (c) {
					c.style.transition = TRANS_BOTH;
					c.style.transform = 'translateY(' + cloneDy + 'px)';
					c.style.opacity = '0';
				});
			});

			if (flipTimer)
				clearTimeout(flipTimer);
			flipTimer = setTimeout(function () {
				removeExitLayer();
				clearMotion([theme]);
				pillSnapshot = [];
			}, MS);
		}

		var mo = new MutationObserver(function (records) {
			var count = box.querySelectorAll('[data-indicator]').length;
			var appear = count > prevCount;
			var exit = count < prevCount;
			var removed = [];

			records.forEach(function (rec) {
				if (rec.removedNodes) {
					Array.prototype.forEach.call(rec.removedNodes, function (n) {
						if (n.nodeType === 1 && n.hasAttribute &&
						    n.hasAttribute('data-indicator'))
							removed.push(n);
						else if (n.nodeType === 1 && n.querySelectorAll) {
							Array.prototype.forEach.call(
								n.querySelectorAll('[data-indicator]'),
								function (p) { removed.push(p); }
							);
						}
					});
				}
			});

			prevCount = count;

			if (appear) {
				records.forEach(function (rec) {
					if (!rec.addedNodes)
						return;
					Array.prototype.forEach.call(rec.addedNodes, function (n) {
						if (n.nodeType !== 1)
							return;
						if (n.hasAttribute && n.hasAttribute('data-indicator'))
							hidePillHard(n);
						else if (n.querySelectorAll) {
							Array.prototype.forEach.call(
								n.querySelectorAll('[data-indicator]'),
								hidePillHard
							);
						}
					});
				});
				if (!box.querySelector('[data-indicator].bw-indicator-pending') &&
				    pillsNow().length)
					pillsNow().forEach(hidePillHard);

				flipAppear();
			} else if (exit || removed.length) {
				/* Snapshot may already be current; removedNodes as fallback */
				flipExit(removed);
			} else {
				/* characterData / attribute noise — refresh snapshot only */
				if (pillsNow().length)
					snapshotPills();
			}
		});
		mo.observe(box, { childList: true, subtree: true, characterData: true });

		window.addEventListener('resize', function () {
			prevTop = theme.getBoundingClientRect().top;
			prevCount = box.querySelectorAll('[data-indicator]').length;
			if (pillsNow().length)
				snapshotPills();
		});

		/* Initial snapshot if indicators already present */
		if (pillsNow().length)
			snapshotPills();

		box._bwFlipTeardown = function () {
			mo.disconnect();
			removeExitLayer();
			if (flipTimer)
				clearTimeout(flipTimer);
		};
	}

	function boot() {
		initThemeToggle();
		initAccordion();
		initIndicatorFlip();
	}

	if (document.readyState === 'loading')
		document.addEventListener('DOMContentLoaded', boot);
	else
		boot();

	/* Re-run active/open after async menu render */
	document.addEventListener('openont-menu-ready', function () {
		initAccordion();
	});

	/* Fallback if custom event is missed */
	var tries = 0;
	var timer = setInterval(function () {
		tries++;
		var top = document.getElementById('topmenu');
		if (top && top.children.length) {
			initAccordion();
			clearInterval(timer);
		} else if (tries > 40) {
			clearInterval(timer);
		}
	}, 100);
})();
