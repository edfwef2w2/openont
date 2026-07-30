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

	function initAccordion() {
		/* Capture phase so we win over default navigation on href="#" */
		if (!document._bwAccordion) {
			document._bwAccordion = true;
			document.addEventListener('click', onMenuClick, true);
		}
		markActiveAndOpen();
	}

	function boot() {
		initThemeToggle();
		initAccordion();
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
