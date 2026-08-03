'use strict';
'require baseclass';
'require ui';

/**
 * OpenONT menu renderer — LuCI-compatible main / tab / mode menus.
 * Sets active/open while building so theme script does not need a second paint.
 */
return baseclass.extend({
	__init__() {
		ui.menu.load().then((tree) => this.render(tree));
	},

	render(tree) {
		let node = tree;
		let url = '';

		this.renderModeMenu(tree);

		if (L.env.dispatchpath.length >= 3) {
			for (var i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}

			if (node)
				this.renderTabMenu(node, url);
		}

		/* Notify theme script that nav DOM is ready */
		try {
			document.dispatchEvent(new CustomEvent('openont-menu-ready'));
		} catch (e) { /* ignore */ }
	},

	renderTabMenu(tree, url, level) {
		const container = document.querySelector('#tabmenu');
		if (!container)
			return E([]);

		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(tree);
		let activeNode = null;

		children.forEach(child => {
			const isActive = (L.env.dispatchpath[3 + (level || 0)] == child.name);
			const activeClass = isActive ? ' active' : '';
			const className = 'tabmenu-item-%s %s'.format(child.name, activeClass);

			ul.appendChild(E('li', { 'class': className }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));

			if (isActive)
				activeNode = child;
		});

		if (ul.children.length == 0)
			return E([]);

		container.appendChild(ul);
		container.style.display = '';

		if (activeNode)
			this.renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);

		return ul;
	},

	/**
	 * @param {string} url  Path segments joined without leading slash, e.g. admin/status
	 * @param {number} level  0 = top categories, 1 = pages under a category
	 */
	renderMainMenu(tree, url, level) {
		const path = (L.env && L.env.dispatchpath) ? L.env.dispatchpath : [];
		const liveTop = !level ? document.querySelector('#topmenu') : null;
		/* Build top-level into a detached ul so replace is one paint */
		const ul = level
			? E('ul', { 'class': 'dropdown-menu' })
			: E('ul', { 'class': 'nav', 'id': 'topmenu' });
		if (!level && !liveTop)
			return E([]);

		const children = ui.menu.getChildren(tree);

		if (children.length == 0 || level > 1)
			return level ? ul : E([]);

		children.forEach(child => {
			const childUrl = url + '/' + child.name;
			const submenu = this.renderMainMenu(child, childUrl, (level || 0) + 1);
			const hasSub = !!(submenu && submenu.firstElementChild);
			const subclass = (!level && hasSub) ? 'dropdown' : '';
			const linkclass = (!level && hasSub) ? 'menu' : '';
			const linkurl = hasSub ? '#' : L.url(url, child.name);

			let isOpen = false;
			let isActive = false;

			if (!level) {
				/* Category row: open when current dispatch is under this category */
				if (path[0] === 'admin' && path[1] === child.name)
					isOpen = hasSub;
				else if (path[0] === child.name)
					isOpen = hasSub;

				/* Leaf at top level (no submenu) */
				if (!hasSub) {
					const segs = childUrl.split('/');
					isActive = path.length >= segs.length &&
						segs.every(function (seg, i) { return path[i] === seg; });
				}
			} else {
				/* Page under category */
				const segs = childUrl.split('/');
				isActive = path.length >= segs.length &&
					segs.every(function (seg, i) { return path[i] === seg; });
			}

			const classes = [];
			if (subclass)
				classes.push(subclass);
			if (isOpen)
				classes.push('open');
			if (isActive)
				classes.push('active');

			const li = E('li', { 'class': classes.length ? classes.join(' ') : null }, [
				E('a', {
					'class': linkclass || null,
					'href': linkurl,
					'aria-expanded': subclass ? (isOpen ? 'true' : 'false') : null
				}, [
					_(child.title)
				]),
				submenu
			]);

			ul.appendChild(li);
		});

		if (!level && liveTop) {
			/* Preserve ready class / display; swap children in one step */
			const ready = liveTop.classList.contains('bw-menu-ready');
			while (liveTop.firstChild)
				liveTop.removeChild(liveTop.firstChild);
			while (ul.firstChild)
				liveTop.appendChild(ul.firstChild);
			liveTop.style.display = '';
			if (ready)
				liveTop.classList.add('bw-menu-ready');
			return liveTop;
		}

		return ul;
	},

	renderModeMenu(tree) {
		const ul = document.querySelector('#modemenu');
		const children = ui.menu.getChildren(tree);

		if (!ul)
			return;

		children.forEach((child, index) => {
			const isActive = L.env.requestpath.length
				? child.name === L.env.requestpath[0]
				: index === 0;

			ul.appendChild(E('li', { 'class': isActive ? 'active' : '' }, [
				E('a', { 'href': L.url(child.name) }, [ _(child.title) ])
			]));

			if (isActive)
				this.renderMainMenu(child, child.name);
		});

		if (ul.children.length > 1)
			ul.style.display = '';
	}
});
