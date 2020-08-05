const BlackHole = function (message, code, name) {
	if (!!code) {
		if (!code.match(/\w{1,3}-\d{5}/)) {
			name = code;
			code = null;
		}
	}
	name = name || "CommonError";
	return class extends Error {
		constructor (msg) {
			super(message + (!!msg && msg.length > 0 ? "\n" + msg : ""));
		}
		get code () {
			return code;
		}
		get [Symbol.toStringTag] () {
			return name;
		}
		static get code () {
			return code;
		}
		static get name () {
			return name;
		}
	}
};

const Errors = {};

Errors.ConfigError = {};
Errors.ConfigError.NoPorts = new BlackHole("无指定端口信息", "CFG-00001", "NoPortConfig");
Errors.ConfigError.NoResponser = new BlackHole("无 API 响应模块", "CFG-00002", "NoResponser");

global.BlackHole = BlackHole;
global.Errors = Errors;