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
Errors.ConfigError.NoWebServerAvailable = new BlackHole("无可用Web后台", "CFG-00002", "NoWebServerAvailable");
Errors.ConfigError.NoSocketServerAvailable = new BlackHole("无可用Socket后台", "CFG-00003", "NoSocketServerAvailable");
Errors.ConfigError.NoResponsor = new BlackHole("无 API 响应模块", "CFG-00004", "NoResponsor");
Errors.ConfigError.UnavailablePort = new BlackHole("指定端口错误", "CFG-00005", "UnavailablePort");
Errors.ConfigError.CreateServerFailed = new BlackHole("服务器初始化错误", "CFG-00006", "CreateServerFailed");
Errors.ConfigError.ConnectRemoteFailed = new BlackHole("连接节点失败", "CFG-00007", "ConnectRemoteFailed");

global.BlackHole = BlackHole;
global.Errors = Errors;