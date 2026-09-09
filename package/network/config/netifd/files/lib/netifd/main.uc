import * as uci from "uci";
import * as uloop from "uloop";
import * as libubus from "ubus";
import { access, dirname } from "fs";

function ex_handler(e)
{
	netifd.log(netifd.L_WARNING, `Exception: ${e}\n${e.stacktrace[0].context}\n`);
}

uloop.guard(ex_handler);
libubus.guard(ex_handler);

let ubus = netifd.ubus = libubus.connect();
let proto_mod;

function uci_ctx()
{
	let savedir = netifd.dummy_mode ? "./tmp" : null;
	let ctx = uci.cursor(netifd.config_path, savedir, null, {
		strict: false
	});
	return ctx;
}

function config_init()
{
	let ctx = uci_ctx();

	for (let mod in [ proto_mod ]) {
		try {
			mod?.config_init(ctx);
		} catch (e) {
			netifd.log(netifd.L_WARNING, `${e}\n${e.stacktrace[0].context}`);
		}
	}
}

function config_start()
{
}

function check_interfaces()
{
}

function hotplug(name, add)
{
}

function ex_wrap(cb)
{
	let fn = cb;
	return (...args) => {
		try {
			return fn(...args);
		} catch (e) {
			netifd.log(netifd.L_WARNING, `${e}\n${e.stacktrace[0].context}`);
		}
	};
}

netifd.cb = {
	hotplug: ex_wrap(hotplug),
	config_init: ex_wrap(config_init),
	config_start: ex_wrap(config_start),
	check_interfaces: ex_wrap(check_interfaces),
};

const proto_module = dirname(sourcepath()) + "/proto.uc";
if (access(proto_module, "r")) {
	try {
		proto_mod = loadfile(proto_module)();
	} catch (e) {
		netifd.log(netifd.L_WARNING, `Error loading proto module: ${e}\n${e.stacktrace[0].context}\n`);
	}
}
