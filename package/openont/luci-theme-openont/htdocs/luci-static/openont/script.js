/* OpenONT theme — accordion sidebar + light/dark toggle + layout shell */
(function () {
	var THEME_KEY = 'openont-theme-dark';

	/**
	 * Shared layout mode (window.innerWidth / screen width):
	 *   wide2x : ratio > 2/3
	 *   normal : ratio > 1/3
	 *   narrow : ratio ≤ 1/3  → sidebar collapses to top bar (is-layout-narrow)
	 * Must stay in sync with overview.js _updateDashUnit / header FOUC script.
	 */
	function detectLayoutMode() {
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
		if (ratio > 2 / 3)
			return 'wide2x';
		if (ratio > 1 / 3)
			return 'normal';
		return 'narrow';
	}

	function applyLayoutShell() {
		var mode = detectLayoutMode();
		var html = document.documentElement;
		var prev = html.getAttribute('data-layout-mode');
		html.setAttribute('data-layout-mode', mode);
		html.classList.toggle('is-layout-narrow', mode === 'narrow');
		html.classList.toggle('is-layout-wide2x', mode === 'wide2x');
		html.classList.toggle('is-layout-normal', mode === 'normal');
		if (prev !== mode) {
			try {
				document.dispatchEvent(new CustomEvent('openont-layout-mode', {
					detail: { mode: mode, prev: prev }
				}));
			} catch (e) { /* IE / old WebKit */ }
		}
		return mode;
	}

	/* Apply ASAP (header FOUC also runs; this keeps resize path alive) */
	applyLayoutShell();

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

	var TOPMENU_SNAP_KEY = 'openont-topmenu-html';
	var userNavAnimTimer = null;

	function enableUserNavAnim() {
		var hdr = document.querySelector('header');
		if (!hdr)
			return;
		hdr.classList.add('bw-user-nav-anim');
		if (userNavAnimTimer)
			clearTimeout(userNavAnimTimer);
		/* Cover longest expand transition (~0.6s + stagger) */
		userNavAnimTimer = setTimeout(function () {
			userNavAnimTimer = null;
			hdr.classList.remove('bw-user-nav-anim');
			persistTopmenuSnapshot();
		}, 750);
	}

	function persistTopmenuSnapshot() {
		var top = document.getElementById('topmenu');
		if (!top || !top.children.length)
			return;
		try {
			sessionStorage.setItem(TOPMENU_SNAP_KEY, top.innerHTML);
		} catch (e) { /* ignore quota / private mode */ }
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

		enableUserNavAnim();

		var open = li.classList.contains('open');
		closeAllDropdowns(null);
		if (!open) {
			li.classList.add('open');
			a.setAttribute('aria-expanded', 'true');
		} else {
			a.setAttribute('aria-expanded', 'false');
		}
		persistTopmenuSnapshot();
	}

	/**
	 * Wrap top-level nav label text so hover can translate text/icons
	 * without moving the row background (see theme CSS .bw-nav-lbl).
	 */
	function wrapNavLabels() {
		var top = document.getElementById('topmenu');
		if (!top)
			return;

		var links = top.querySelectorAll(':scope > li > a');
		Array.prototype.forEach.call(links, function (a) {
			if (a.querySelector('.bw-nav-lbl'))
				return;

			var texts = [];
			Array.prototype.forEach.call(a.childNodes, function (n) {
				if (n.nodeType === 3 && String(n.textContent || '').replace(/\s+/g, '').length)
					texts.push(n);
			});
			if (!texts.length)
				return;

			var span = document.createElement('span');
			span.className = 'bw-nav-lbl';
			a.insertBefore(span, texts[0]);
			texts.forEach(function (n) {
				span.appendChild(n);
			});
		});
	}

	function markMenuReady() {
		var top = document.getElementById('topmenu');
		if (top && top.children.length) {
			wrapNavLabels();
			top.classList.add('bw-menu-ready');
			persistTopmenuSnapshot();
		}
	}

	function initAccordion() {
		/* Capture phase so we win over default navigation on href="#" */
		if (!document._bwAccordion) {
			document._bwAccordion = true;
			document.addEventListener('click', onMenuClick, true);
		}
		/*
		 * When menu-openont already set active/open (or hydrate retagged),
		 * still run markActiveAndOpen as a path-accurate fallback after
		 * L.env is available — it only changes classes, not structure.
		 */
		markActiveAndOpen();
		markMenuReady();
	}

	/**
	 * Indicator FLIP + full fade-out:
	 *  - Appear: Dark mode + pills share layout dy; opacity 0→1 together.
	 *  - Exit (same document): rebuild fixed clones from snapshot after LuCI
	 *    removes nodes; fade/move with the same dy as Dark mode.
	 *  - Exit (full page nav): intercept same-origin link clicks so exit can
	 *    paint before unload — MutationObserver alone never wins a hard nav.
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
		var DUR_NAV = 0.3;
		var EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
		var TRANS_T = 'transform ' + DUR + 's ' + EASE;
		var TRANS_BOTH = 'transform ' + DUR + 's ' + EASE + ', opacity ' + DUR + 's ' + EASE;
		var TRANS_T_NAV = 'transform ' + DUR_NAV + 's ' + EASE;
		var TRANS_BOTH_NAV = 'transform ' + DUR_NAV + 's ' + EASE +
			', opacity ' + DUR_NAV + 's ' + EASE;
		var MS = DUR * 1000 + 40;
		var MS_NAV = DUR_NAV * 1000 + 40;

		var prevTop = theme.getBoundingClientRect().top;
		var prevCount = box.querySelectorAll('[data-indicator]').length;
		var flipTimer = null;
		var exitLayer = null;
		var exitInProgress = false;
		var pendingNavigateHref = null;
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

		function finishExitCleanup() {
			removeExitLayer();
			clearMotion([theme]);
			pillSnapshot = [];
			exitInProgress = false;
			var href = pendingNavigateHref;
			pendingNavigateHref = null;
			if (href)
				window.location.href = href;
		}

		/** Appear: re-bind dy + opacity fade-in */
		function flipAppear() {
			/* Do not kill an exit that is holding a pending page navigation */
			if (exitInProgress && pendingNavigateHref)
				return;

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

			/* Cancel in-flight exit/appear only when not navigating away */
			if (flipTimer)
				clearTimeout(flipTimer);
			if (!exitInProgress)
				removeExitLayer();
			else {
				removeExitLayer();
				exitInProgress = false;
			}

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
		 * Exit: paint fixed clones from pillSnapshot / removedNodes,
		 * FLIP Dark mode, fade/move clones with the same dy.
		 * @param {Node[]} [removedNodes]
		 * @param {{ forNav?: boolean }} [opts]
		 */
		function flipExit(removedNodes, opts) {
			opts = opts || {};
			var forNav = !!opts.forNav;
			var useDur = forNav ? DUR_NAV : DUR;
			var useTransT = forNav ? TRANS_T_NAV : TRANS_T;
			var useTransBoth = forNav ? TRANS_BOTH_NAV : TRANS_BOTH;
			var useMs = forNav ? MS_NAV : MS;

			if (reduceMotion) {
				prevTop = theme.getBoundingClientRect().top;
				pillSnapshot = [];
				exitInProgress = false;
				if (pendingNavigateHref) {
					var h = pendingNavigateHref;
					pendingNavigateHref = null;
					window.location.href = h;
				}
				return;
			}

			if (flipTimer)
				clearTimeout(flipTimer);
			removeExitLayer();
			exitInProgress = true;

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
				exitInProgress = false;
				if (pendingNavigateHref) {
					var hrefEmpty = pendingNavigateHref;
					pendingNavigateHref = null;
					window.location.href = hrefEmpty;
				}
				return;
			}

			lockSidebarOverflow();
			prepareToggle();

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
					theme.style.transition = useTransT;
					theme.style.transform = 'translateY(0)';
				}
				/*
				 * Theme layout moved by (last - first) = -dy.
				 * Clones ride the same delta and fade out (bound exit).
				 */
				var cloneDy = -dy;
				clones.forEach(function (c) {
					c.style.transition = useTransBoth;
					c.style.transform = 'translateY(' + cloneDy + 'px)';
					c.style.opacity = '0';
				});
			});

			flipTimer = setTimeout(finishExitCleanup, useMs);
		}

		/**
		 * Full-page navigation never fires a visible exit via MO alone.
		 * Intercept same-origin link clicks, play exit, then navigate.
		 */
		function shouldInterceptNav(a, ev) {
			if (!a || !a.getAttribute)
				return false;
			if (ev.defaultPrevented)
				return false;
			if (ev.button !== 0)
				return false;
			if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey)
				return false;
			if (a.target && a.target !== '' && a.target !== '_self')
				return false;
			if (a.hasAttribute('download'))
				return false;

			var hrefAttr = a.getAttribute('href');
			if (!hrefAttr || hrefAttr === '#' || hrefAttr.charAt(0) === '#')
				return false;
			/* Accordion category toggles */
			if (a.classList.contains('menu') &&
			    (hrefAttr === '#' || hrefAttr.indexOf('javascript:') === 0))
				return false;

			var url;
			try {
				url = new URL(a.href, window.location.href);
			} catch (e) {
				return false;
			}
			if (url.origin !== window.location.origin)
				return false;
			if (url.protocol !== 'http:' && url.protocol !== 'https:')
				return false;
			/* Same document (hash-only / identical) */
			if (url.pathname === window.location.pathname &&
			    url.search === window.location.search &&
			    url.hash !== window.location.hash)
				return false;
			if (url.href === window.location.href)
				return false;

			return true;
		}

		function onNavClick(ev) {
			if (pendingNavigateHref || reduceMotion)
				return;

			var a = ev.target && ev.target.closest
				? ev.target.closest('a[href]')
				: null;
			if (!shouldInterceptNav(a, ev))
				return;

			/* Only delay when there is something to fade out */
			if (!pillsNow().length && !pillSnapshot.length)
				return;

			ev.preventDefault();
			ev.stopPropagation();

			pendingNavigateHref = a.href;

			/* Fresh geometry before tear-down */
			if (pillsNow().length)
				snapshotPills();

			/* Detach live pills so theme can FLIP up; MO will also see exit */
			var removed = pillsNow();
			prevCount = 0;
			removed.forEach(function (p) {
				if (p.parentNode)
					p.parentNode.removeChild(p);
			});

			/*
			 * Call exit directly (do not rely on MO timing). forNav shortens
			 * duration so the click→navigate delay stays acceptable.
			 */
			flipExit(removed, { forNav: true });
		}

		/* Refresh snapshot before click so clones match final layout */
		function onPointerDown(ev) {
			if (reduceMotion || !pillsNow().length)
				return;
			var a = ev.target && ev.target.closest
				? ev.target.closest('a[href]')
				: null;
			if (a)
				snapshotPills();
		}

		var mo = new MutationObserver(function (records) {
			/* Nav-driven exit owns the animation; ignore MO churn */
			if (pendingNavigateHref)
				return;

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

		document.addEventListener('click', onNavClick, true);
		document.addEventListener('pointerdown', onPointerDown, true);

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
			document.removeEventListener('click', onNavClick, true);
			document.removeEventListener('pointerdown', onPointerDown, true);
			removeExitLayer();
			if (flipTimer)
				clearTimeout(flipTimer);
		};
	}

	function boot() {
		applyLayoutShell();
		initThemeToggle();
		initAccordion();
		initIndicatorFlip();

		var resizeTimer = null;
		window.addEventListener('resize', function () {
			if (resizeTimer)
				clearTimeout(resizeTimer);
			resizeTimer = setTimeout(function () {
				applyLayoutShell();
			}, 80);
		});
	}

	if (document.readyState === 'loading')
		document.addEventListener('DOMContentLoaded', boot);
	else
		boot();

	/* Re-run active/open + snapshot after async menu render */
	document.addEventListener('openont-menu-ready', function () {
		initAccordion();
	});

	/*
	 * Short fallback if custom event is missed (hydrated pages already
	 * have children; still need L.env-based active correction once).
	 */
	var tries = 0;
	var timer = setInterval(function () {
		tries++;
		var top = document.getElementById('topmenu');
		if (top && top.children.length) {
			initAccordion();
			clearInterval(timer);
		} else if (tries > 20) {
			clearInterval(timer);
		}
	}, 50);

	window.openontDetectLayoutMode = detectLayoutMode;
	window.openontApplyLayoutShell = applyLayoutShell;
})();
