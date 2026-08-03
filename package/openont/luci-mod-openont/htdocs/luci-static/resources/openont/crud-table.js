'use strict';
'require baseclass';

/**
 * Config-driven CRUD table for OpenONT LuCI views.
 *
 * new Module.Table(cfg).render(loadResult) → root DOM node
 *
 * cfg highlights:
 *   title, description, sectionTitle, emptyText
 *   getRows(loadResult), getContext(loadResult)
 *   columns[{ key, label, format? }]
 *   toolbar{ add?, filterEnabled?, search?, searchKeys? }
 *   fields[{ key, label, type, options?, optionsFrom?, ... }]
 *   defaults, formTitle(row)
 *   actions{ save, delete, enable?, disable? }
 *   rowActions[{ id: edit|copy|toggle|delete, ... }]
 *   afterFields(editBox, widgets, self)
 */

var Table = baseclass.extend({
	__name__: 'openont.CRUDTable',

	__init__: function (cfg) {
		this.cfg = cfg || {};
		this.rows = [];
		this.ctx = {};
		this.tbody = null;
		this.editBox = null;
		this.filterEl = null;
		this.searchEl = null;
		this._searchTimer = null;
	},

	_getRows: function (loadResult) {
		if (typeof this.cfg.getRows === 'function')
			return this.cfg.getRows(loadResult) || [];
		if (loadResult && Array.isArray(loadResult.items))
			return loadResult.items;
		return [];
	},

	_getContext: function (loadResult) {
		if (typeof this.cfg.getContext === 'function')
			return this.cfg.getContext(loadResult) || {};
		return {};
	},

	_cellText: function (col, row) {
	var v;
	if (typeof col.format === 'function')
		v = col.format(row, this.ctx);
	else if (col.key)
		v = row[col.key];
	else
		v = '';
	if (v == null || v === '')
		return '—';
	return v;
},

	_handleSaveRpc: function (promise, errEl) {
	return promise.then(function (res) {
		if (res && res.ok === false) {
			if (errEl) {
				errEl.style.display = '';
				errEl.textContent = res.error || _('Failed');
			}
		}
		else {
			location.reload();
		}
	});
},

	_reloadAfter: function (promise) {
	return promise.then(function () {
		location.reload();
	});
},

	_fieldWidget: function (field, row) {
	var type = field.type || 'text';
	var raw;

	if (typeof field.deserialize === 'function')
		raw = field.deserialize(row || {}, this.ctx);
	else if (field.key && row)
		raw = row[field.key];
	else
		raw = field.value;

	if (type === 'static') {
		return E('input', {
			type: 'text',
			value: field.value != null ? field.value : (raw || ''),
			disabled: 'disabled'
		});
	}

	if (type === 'textarea') {
		return E('textarea', {
			rows: field.rows || 4,
			placeholder: field.placeholder || ''
		}, [ raw != null ? String(raw) : '' ]);
	}

	if (type === 'select') {
		var sel = E('select', {});
		var opts = field.options || [];

		if (field.optionsFrom && this.ctx[field.optionsFrom]) {
			opts = [];
			if (field.emptyLabel != null)
				opts.push([ '', field.emptyLabel ]);
			var list = this.ctx[field.optionsFrom] || [];
			var vk = field.optionValue || 'id';
			var lk = field.optionLabel || 'name';
			for (var i = 0; i < list.length; i++) {
				opts.push([
					list[i][vk],
					list[i][lk] != null ? list[i][lk] : list[i][vk]
				]);
			}
		}

		for (var j = 0; j < opts.length; j++) {
			var o = opts[j];
			var val = Array.isArray(o) ? o[0] : o;
			var lab = Array.isArray(o) ? o[1] : o;
			sel.appendChild(E('option', { value: val }, [ lab ]));
		}

		var cur = raw != null ? String(raw) : '';
		if (field.normalizeValue)
			cur = field.normalizeValue(cur);
		sel.value = cur;
		return sel;
	}

	return E('input', {
		type: field.inputType || 'text',
		value: raw != null ? String(raw) : '',
		placeholder: field.placeholder || '',
		disabled: field.disabled ? 'disabled' : null
	});
},

	_readFields: function (fields, widgets) {
	var values = {};
	for (var i = 0; i < fields.length; i++) {
		var f = fields[i];
		if (!f.key || f.type === 'static')
			continue;
		var w = widgets[f.key];
		var v = w ? w.value : '';
		if (typeof f.serialize === 'function')
			v = f.serialize(v, this.ctx);
		else if (typeof v === 'string')
			v = v.trim();
		values[f.key] = v;
	}
	return values;
},

	_showEdit: function (row) {
	var self = this;
	var cfg = this.cfg;
	var fields = cfg.fields || [];
	var base = Object.assign({}, cfg.defaults || {}, row || {});
	var editBox = this.editBox;
	var widgets = {};

	editBox.style.display = '';
	editBox.innerHTML = '';

	var title = typeof cfg.formTitle === 'function'
		? cfg.formTitle(row, base)
		: (row ? _('Edit') : _('Add'));
	var err = E('div', { class: 'alert-message', style: 'display:none' });

	editBox.appendChild(E('h3', {}, [ title ]));
	editBox.appendChild(err);

	for (var i = 0; i < fields.length; i++) {
		var f = fields[i];
		var w = this._fieldWidget(f, base);
		if (f.key)
			widgets[f.key] = w;
		editBox.appendChild(E('div', { class: 'cbi-value' }, [
			E('label', { class: 'cbi-value-title' }, [ f.label || f.key || '' ]),
			E('div', { class: 'cbi-value-field' }, [ w ])
		]));
	}

	if (typeof cfg.afterFields === 'function')
		cfg.afterFields(editBox, widgets, this);

	editBox.appendChild(E('div', { class: 'cbi-page-actions' }, [
		E('button', {
			class: 'cbi-button cbi-button-apply',
			click: function () {
				var values = self._readFields(fields, widgets);
				if (!cfg.actions || typeof cfg.actions.save !== 'function')
					return;
				var p = cfg.actions.save(values, row, self);
				if (p && typeof p.then === 'function')
					self._handleSaveRpc(p, err);
			}
		}, [ _('Save & Apply') ]),
		E('button', {
			class: 'cbi-button',
			click: function () { editBox.style.display = 'none'; }
		}, [ _('Cancel') ])
	]));
},

	_rowActionNodes: function (row) {
	var self = this;
	var cfg = this.cfg;
	var actions = cfg.rowActions || [ { id: 'edit' }, { id: 'delete' } ];
	var nodes = [];

	function pushSep() {
		if (nodes.length)
			nodes.push(' ');
	}

	for (var i = 0; i < actions.length; i++) {
		(function (act) {
			var id = act.id;
			if (id === 'edit') {
				pushSep();
				nodes.push(E('a', {
					href: '#',
					click: function (ev) {
						ev.preventDefault();
						self._showEdit(row);
					}
				}, [ act.label || _('Edit') ]));
				return;
			}
			if (id === 'copy') {
				pushSep();
				nodes.push(E('a', {
					href: '#',
					click: function (ev) {
						ev.preventDefault();
						var next = typeof act.transform === 'function'
							? act.transform(row, self.ctx)
							: Object.assign({}, row);
						self._showEdit(next);
					}
				}, [ act.label || _('Copy') ]));
				return;
			}
			if (id === 'toggle') {
				pushSep();
				nodes.push(E('a', {
					href: '#',
					click: function (ev) {
						ev.preventDefault();
						var en = row.enabled;
						var fn = en
							? (cfg.actions && cfg.actions.disable)
							: (cfg.actions && cfg.actions.enable);
						if (typeof fn !== 'function')
							return;
						self._reloadAfter(fn(row, self));
					}
				}, [ row.enabled ? _('Disable') : _('Enable') ]));
				return;
			}
			if (id === 'delete') {
				pushSep();
				nodes.push(E('a', {
					href: '#',
					class: 'cbi-button-remove',
					click: function (ev) {
						ev.preventDefault();
						if (typeof act.guard === 'function' && !act.guard(row, self.ctx)) {
							if (typeof act.guardMessage === 'function')
								alert(act.guardMessage(row, self.ctx));
							return;
						}
						var msg = typeof act.confirm === 'function'
							? act.confirm(row, self.ctx)
							: _('Delete?');
						if (msg && !confirm(msg))
							return;
						if (!cfg.actions || typeof cfg.actions.delete !== 'function')
							return;
						self._reloadAfter(cfg.actions.delete(row, self));
					}
				}, [ act.label || _('Delete') ]));
			}
		})(actions[i]);
	}

	return nodes;
},

	_matchesFilter: function (row) {
	var cfg = this.cfg;
	var tb = cfg.toolbar || {};

	if (this.filterEl && this.filterEl.value !== '') {
		var want = this.filterEl.value;
		var en = row.enabled ? '1' : '0';
		if (String(en) !== want)
			return false;
	}

	if (this.searchEl) {
		var q = this.searchEl.value.trim().toLowerCase();
		if (q) {
			var keys = tb.searchKeys || [];
			var parts = [];
			for (var i = 0; i < keys.length; i++)
				parts.push(row[keys[i]]);
			var blob = parts.join(' ').toLowerCase();
			if (blob.indexOf(q) < 0)
				return false;
		}
	}

	return true;
},

	_renderRows: function () {
	var self = this;
	var cfg = this.cfg;
	var cols = cfg.columns || [];
	var tbody = this.tbody;
	var frag = document.createDocumentFragment();
	var n = 0;

	tbody.innerHTML = '';

	for (var i = 0; i < this.rows.length; i++) {
		var row = this.rows[i];
		if (!this._matchesFilter(row))
			continue;
		n++;
		var tds = [];
		for (var c = 0; c < cols.length; c++) {
			tds.push(E('td', { class: 'td' }, [ this._cellText(cols[c], row) ]));
		}
		tds.push(E('td', { class: 'td' }, this._rowActionNodes(row)));
		frag.appendChild(E('tr', { class: 'tr' }, tds));
	}

	if (!n) {
		frag.appendChild(E('tr', { class: 'tr' }, [
			E('td', {
				class: 'td cbi-empty',
				colspan: cols.length + 1
			}, [ cfg.emptyText || _('No entries.') ])
		]));
	}

	tbody.appendChild(frag);
},

	_scheduleRenderRows: function () {
	var self = this;
	if (this._searchTimer)
		window.clearTimeout(this._searchTimer);
	this._searchTimer = window.setTimeout(function () {
		self._searchTimer = null;
		self._renderRows();
	}, 120);
},

	render: function (loadResult) {
	var self = this;
	var cfg = this.cfg;
	var cols = cfg.columns || [];
	var tb = cfg.toolbar || { add: true };

	this.rows = this._getRows(loadResult);
	this.ctx = this._getContext(loadResult);
	this.editBox = E('div', { class: 'cbi-section', style: 'display:none' });
	this.tbody = E('tbody', {});

	var toolbarNodes = [];

	if (tb.filterEnabled) {
		this.filterEl = E('select', {}, [
			E('option', { value: '' }, [ _('All') ]),
			E('option', { value: '1' }, [ _('Enabled') ]),
			E('option', { value: '0' }, [ _('Disabled') ])
		]);
		this.filterEl.addEventListener('change', function () {
			self._renderRows();
		});
		toolbarNodes.push(this.filterEl, ' ');
	}

	if (tb.search) {
		this.searchEl = E('input', {
			type: 'text',
			placeholder: _('Search…')
		});
		this.searchEl.addEventListener('input', function () {
			self._scheduleRenderRows();
		});
		toolbarNodes.push(this.searchEl, ' ');
	}

	if (tb.add !== false) {
		toolbarNodes.push(E('button', {
			class: 'cbi-button cbi-button-add',
			click: function () { self._showEdit(null); }
		}, [ _('Add') ]));
	}

	var headCells = [];
	for (var i = 0; i < cols.length; i++) {
		headCells.push(E('th', { class: 'th' }, [ cols[i].label || cols[i].key || '' ]));
	}
	headCells.push(E('th', { class: 'th' }, [ _('Actions') ]));

	var map = E('div', { class: 'cbi-map' }, [
		E('h2', { name: 'content' }, [ cfg.title || '' ]),
		E('div', { class: 'cbi-map-descr' }, [ cfg.description || '' ]),
		E('div', { class: 'cbi-section' }, [
			E('h3', {}, [ cfg.sectionTitle || '' ]),
			E('div', { class: 'cbi-section-actions' }, toolbarNodes),
			E('div', { class: 'cbi-section-node' }, [
				E('table', { class: 'table cbi-section-table' }, [
					E('thead', {}, [
						E('tr', { class: 'tr table-titles' }, headCells)
					]),
					this.tbody
				])
			])
		]),
		this.editBox
	]);

	this._renderRows();
	return map;
}
});

return baseclass.extend({
	__name__: 'openont.crud-table',
	Table: Table
});
