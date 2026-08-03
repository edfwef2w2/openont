'use strict';
'require baseclass';
/* Aligned with buckets.schema — colors/ids from buckets.json */

var DATA = {
	mark_shift: 16,
	buckets: [
		{ id: 0, name: 'unknown', color: '#7f8c8d' },
		{ id: 1, name: 'http', color: '#0088cc' },
		{ id: 2, name: 'video', color: '#e74c3c' },
		{ id: 3, name: 'game', color: '#9b59b6' },
		{ id: 4, name: 'download', color: '#27ae60' },
		{ id: 5, name: 'file', color: '#16a085' },
		{ id: 6, name: 'im', color: '#3498db' },
		{ id: 7, name: 'common', color: '#95a5a6' },
		{ id: 8, name: 'other_app', color: '#f39c12' },
		{ id: 9, name: 'speedtest', color: '#e67e22' }
	]
};

return baseclass.extend({
	__name__: 'openont.buckets',

	keys: function () {
		return DATA.buckets.map(function (b) { return b.name; });
	},

	colors: function () {
		var m = {};
		DATA.buckets.forEach(function (b) { m[b.name] = b.color; });
		return m;
	},

	getData: function () {
		return DATA;
	}
});
