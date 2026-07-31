'use strict';
'require rpc';

/**
 * OpenONT RPC declaration helpers.
 *
 * declareMap(object, { alias: { method?, params?, expect?, timeout? } })
 * declareCrud(object, prefix, { list: { expect }, add: { params }, ... })
 *   → methods named prefix_verb unless method is overridden
 */

function declareMap(object, methods) {
	var out = {};
	var keys = Object.keys(methods || {});

	for (var i = 0; i < keys.length; i++) {
		var alias = keys[i];
		var spec = methods[alias] || {};
		var opts = {
			object: object,
			method: spec.method || alias
		};

		if (spec.params)
			opts.params = spec.params;
		if (spec.expect)
			opts.expect = spec.expect;
		if (spec.timeout != null)
			opts.timeout = spec.timeout;

		out[alias] = rpc.declare(opts);
	}

	return out;
}

function declareCrud(object, prefix, verbs) {
	var methods = {};
	var keys = Object.keys(verbs || {});

	for (var i = 0; i < keys.length; i++) {
		var verb = keys[i];
		var spec = {};
		var src = verbs[verb] || {};
		var sk = Object.keys(src);

		for (var j = 0; j < sk.length; j++)
			spec[sk[j]] = src[sk[j]];

		if (!spec.method)
			spec.method = prefix + '_' + verb;

		methods[verb] = spec;
	}

	return declareMap(object, methods);
}

/** Pass-through helper: reject when backend returns { ok: false }. */
function rejectIfFailed(res) {
	if (res && res.ok === false)
		return Promise.reject(new Error(res.error || 'Failed'));
	return res;
}

return {
	declareMap: declareMap,
	declareCrud: declareCrud,
	rejectIfFailed: rejectIfFailed
};
