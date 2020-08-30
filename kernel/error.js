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

Errors.ServerError = {};
Errors.ServerError.UnavailableHost = new BlackHole("指定IP错误", "SVR-00001", "UnavailableHost");
Errors.ServerError.UnavailablePort = new BlackHole("指定端口错误", "SVR-00002", "UnavailablePort");
Errors.ServerError.CreateServerFailed = new BlackHole("服务器初始化失败", "SVR-00003", "CreateServerFailed");
Errors.ServerError.ConnectRemoteFailed = new BlackHole("连接节点失败", "SVR-00004", "ConnectRemoteFailed");
Errors.ServerError.ConnectionBroken = new BlackHole("连接被中断", "SVR-00005", "ConnectionBroken");
Errors.ServerError.CreateConsoleFailed = new BlackHole("命令行控制台初始化失败", "SVR-00006", "CreateConsoleFailed");

Errors.RuntimeError = {};
Errors.RuntimeError.MainProcessExited = new BlackHole("主进程关闭", "RTM-00001", "MainProcessExited");
Errors.RuntimeError.SubProcessBrokenDown = new BlackHole("子进程离线", "RTM-00002", "SubProcessBrokenDown");

Errors.GalanetError = {};
Errors.GalanetError.ShakehandFailed = new BlackHole("Galanet握手失败", "GLN-00001", "ShakehandFailed");
Errors.GalanetError.WrongProtocol = new BlackHole("Galanet请求协议错误", "GLN-00002", "WrongProtocol");
Errors.GalanetError.NotFriendNode = new BlackHole("非Galanet集群友机请求", "GLN-00003", "NotFriendNode");
Errors.GalanetError.CannotService = new BlackHole("非本节点可服务请求", "GLN-00004", "CannotService");
Errors.GalanetError.EmptyClustor = new BlackHole("集群无注册节点", "GLN-00005", "EmptyClustor");
Errors.GalanetError.UnavailableNodeAddress = new BlackHole("无法解析的节点地址", "GLN-00006", "UnavailableNodeAddress");
Errors.GalanetError.NoSuchNode = new BlackHole("当前集群中无指定节点", "GLN-00007", "NoSuchNode");
Errors.GalanetError.Unauthorized = new BlackHole("无权限调用本接口", "GLN-00008", "Unauthorized");

Errors.Quark = {};
Errors.Quark.DefaultPackerError = new BlackHole("不可用默认打包器", "QK-000001", "DefaultPackerError");
Errors.Quark.ConflictPackerError = new BlackHole("Quark打包器冲突", "QK-000002", "ConflictPackerError");
Errors.Quark.ConflictPrefixError = new BlackHole("数据类型前缀冲突", "QK-000003", "ConflictPrefixError");
Errors.Quark.PackerNotFoundError = new BlackHole("指定的打包器不存在", "QK-000004", "PackerNotFoundError");
Errors.Quark.ParseElementError = new BlackHole("解析Quark轻数据错误", "QK-000011", "ParseElementError");
Errors.Quark.ParseFixLengthArrayError = new BlackHole("解析Quark固长数组错误", "QK-000012", "ParseFixLengthArrayError");
Errors.Quark.ParseVarLengthArrayError = new BlackHole("解析Quark变长数组错误", "QK-000013", "ParseVarLengthArrayError");

global.BlackHole = BlackHole;
global.Errors = Errors;