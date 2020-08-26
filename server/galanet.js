const Path = require('path');
const Net = require('net');
const Axios = require('axios');
const TCP = require('../kernel/tcp');
const UDP = require('../kernel/udp');
const Logger = new (_("Utils.Logger"))('Galanet');
var ResponsorManager;

const AvailableSource = [ 'tcp', 'udp', 'http' ];
const Config = {
	prefix: '',
	nodes: [],
	services: []
}
const Pending = [];
const Reshakings = {};

const setConfig = async (cfg, callback) => {
	ResponsorManager = require('./responser'); // 不可先加载，因为那次该模块还没初始化完毕
	if (!callback) callback = () => {};

	Config.prefix = cfg.api.url;
	if (!!cfg.api?.services) {
		Config.services.push(...cfg.api.services);
	}
	require('./responser').load(Path.join(__dirname, 'insider'), false);
	if (isSlaver) return callback();
	if (!cfg.node || !cfg.node.length || cfg.node.length <= 0) return callback();

	var nodes = {};
	cfg.node.forEach(node => {
		var temp = parseNode(node);
		if (!temp) return;
		var info = nodes[temp.name];
		if (!!info) {
			temp.filter.forEach(f => {
				if (info.filter.includes(f)) return;
				info.filter.push(f);
			});
		}
		else {
			nodes[temp.name] = temp;
		}
	});
	for (let tag in nodes) {
		Config.nodes.push(nodes[tag]);
	}
	Config.nodes.push({
		name: 'local',
		available: true,
		taskInfo: {
			total: 0,
			done: 0,
			time: 0,
			energy: 50,
			power: 50
		},
		failed: 0
	});

	callback();
};
const shakehand = ip => {
	Config.nodes.forEach(node => {
		if (node.available) return;
		if (!!ip && node.host !== ip) return;
		connectNode(node);
	});	
};
const reshakehand = ip => {
	var res = Reshakings[ip];
	if (!!res) {
		clearTimeout(res);
	}
	Reshakings[ip] = setTimeout(() => {
		delete Reshakings[ip];
		shakehand(ip);
	}, 1000);
};
const checkRequester = ip => Config.nodes.some(node => node.host === ip);
const checkService = url => {
	if (!Config.services || Config.services.length === 0) return true;
	url = url.split('/').filter(f => f.trim().length > 0)[0];
	if (!url) return false;
	return Config.services.includes(url);
};
const launchTask = (responsor, param, query, url, data, method, source, ip, port, callback) => new Promise(async res => {
	var sender = (!!param.originSource || !!param.originHost + !!param.originPort)
		? (param.originSource + '/' + param.originHost + '/' + param.originPort)
		: (source + '/' + ip + '/' + port), sendInfo = method + ':' + url;
	var resps = [];
	// 筛选符合注册服务要求的节点
	Config.nodes.forEach(node => {
		if (!node.available) return;
		if (node.name === 'local') {
			if (!isDelegator) resps.push(node);
			return;
		}

		var parts = url.split('/').filter(f => !!f && f.length > 0);
		if ((!!node.services && node.services.length > 0) && !node.services.includes(parts[0])) return;
		if (!node.filter || node.filter.length === 0) return resps.push(node);
		var ok = node.filter.some(filter => {
			var l = filter.length;
			if (parts.length < l) return false;
			for (let i = 0; i < l; i ++) {
				if (parts[i] !== filter[i]) return false;
			}
			return true;
		});
		if (ok) resps.push(node);
	});

	// 若无适格节点
	if (resps.length === 0) {
		if (isDelegator) {
			let err = new Errors.GalanetError.EmptyClustor();
			let result = {
				ok: false,
				code: err.code,
				message: err.message
			};
			Logger.error('网关无可用节点响应请求！');
			if (!!callback) callback(result);
			return res(result);
		}
		else {
			resps = [Config.nodes.filter(node => node.name === 'local')[0]];
		}
	}

	// 筛选任务未满的节点
	resps = resps.filter(resp => resp.taskInfo.total <= resp.taskInfo.done * 2);
	if (resps.length === 0) {
		let cb = result => {
			if (!!callback) callback(result);
			res(result);
		};

		Logger.log("请求" + sender + '/' + sendInfo + '入池等待。 Q: ' + JSON.stringify(query) + '; P: ' + JSON.stringify(param));
		Pending.push([responsor, param, query, url, data, method, source, ip, port, cb]);
		return;
	}
	resps.sort((ra, rb) => ra.taskInfo.power - rb.taskInfo.power);
	var resp = resps[0];

	var time = now(), result;
	resp.taskInfo.total ++;
	resp.taskInfo.power = resp.taskInfo.energy * (1 + resp.taskInfo.total - resp.taskInfo.done);
	if (resp.name === 'local') { // 本地处理
		result = await ResponsorManager.launchLocally(responsor, param, query, url, data, method, source, ip, port);
	}
	else { // 发送给群组节点处理
		Logger.log("请求" + sender + '/' + sendInfo + '被转发至' + resp.name + '。 Q: ' + JSON.stringify(query) + '; P: ' + JSON.stringify(param));

		param = param || {};
		param.isGalanet = true;
		param.originHost = ip;
		param.originPort = port;
		param.originSource = source;
		result = await sendRequest(resp, method, url, param);
	}
	resp.taskInfo.done ++;
	time = now() - time;
	if (!result.ok) {
		time = 1.2 * time + 20;
		if (result.code === Errors.GalanetError.NotFriendNode.code) {
			Logger.error(resp.name + ' : not friend node (' + url + ')');
			resp.failed ++;
			if (resp.failed === 3) Config.nodes.remove(resp);
			await waitLoop();
			result = await launchTask(responsor, param, query, url, data, method, source, ip, port);
		}
		else if (result.code === Errors.GalanetError.CannotService.code) {
			Logger.error(resp.name + ' : cannot service (' + url + ')');
			let p = url.split('/')[0];
			if (!!p && !!resp.services) resp.services.remove(p);
			resp.failed ++;
			if (resp.failed === 3) Config.nodes.remove(resp);
			await waitLoop();
			result = await launchTask(responsor, param, query, url, data, method, source, ip, port);
		}
		else {
			Logger.error(resp.name + ' error(' + resp.code + '): ' + resp.message);
		}
	}
	else {
		resp.failed = 0;
	}
	resp.taskInfo.time += time;
	resp.taskInfo.energy = (resp.taskInfo.time / resp.taskInfo.done * 2 + time) / 3;
	resp.taskInfo.power = resp.taskInfo.energy * (1 + resp.taskInfo.total - resp.taskInfo.done);

	if (!!callback) callback(result);
	res(result);

	var task = Pending.shift();
	if (!!task) {
		Logger.log("池中请求" + sender + '/' + sendInfo + '被转发至' + resp.name + '。 Q: ' + JSON.stringify(query) + '; P: ' + JSON.stringify(param));
		launchTask(...task);
	}
});
const getUsage = () => {
	var result = {};
	result.pending = Pending.length;
	result.nodes = [];
	Config.nodes.forEach(worker => {
		var info = {
			name: worker.name,
			available: !!worker.available,
			failed: worker.failed,
			filter: !!worker.filter ? worker.filter.map(f => f.join('/')) : [],
			tasks: worker.taskInfo
		};
		result.nodes.push(info);
	});
	return result;
};

const httpClient = (host, port, method, path, param, callback) => new Promise((res, rej) => {
	var cfg = {
		method,
		url: 'http://' + host + ':' + port + path
	};
	if (!!param) cfg.data = param;
	Axios.request(cfg).then(result => {
		if (!!callback) callback(result.data);
		res(result.data);
	}).catch(err => {
		if (!!callback) callback(null, err);
		rej(err);
	});
});

const parseNode = node => {
	var conn = node.split('/');
	var source = conn[0];
	if (AvailableSource.indexOf(source) < 0) return null;
	var ip = conn[1], port = conn[2] * 1, filter = conn.splice(3, conn.length).filter(f => !!f && f.length > 0);
	if (!Net.isIP(ip) || !Number.is(port)) return null;
	var tag = source + '/' + ip + '/' + port;
	var info = {
		method: source,
		host: ip,
		port,
		filter: [],
		name: tag,
		taskInfo: {
			total: 0,
			done: 0,
			time: 0,
			energy: 100,
			power: 100
		},
		services: [],
		failed: 0,
		available: false
	};
	if (filter.length > 0) info.filter.push(filter);

	return info;
};
const addNode = async node => {
	var info = parseNode(node);
	if (!info) {
		return [null, new Errors.GalanetError.UnavailableNodeAddress()];
	}
	var last = Config.nodes.filter(node => node.name === info.name);
	if (last.length > 0) {
		last = last[0];
		if (info.filter.length === 0) last.filter = [];
		else {
			info.filter.forEach(f => {
				if (!last.filter.includes(f)) last.filter.push(f);
			});
		}
		if (last.available) return ['节点注册服务已更新'];
		let err = await connectNode(last);
		if (!!err) {
			return [null, err];
		}
		else {
			return ['节点注册服务已更新，并握手成功'];
		}
	}
	else {
		Config.nodes.push(info);
		let err = await connectNode(info);
		if (!!err) {
			return [null, err];
		}
		else {
			return ['节点已添加，并握手成功'];
		}
	}
};
const removeNode = node => {
	var info = parseNode(node);
	if (!info) {
		return [null, new Errors.GalanetError.UnavailableNodeAddress()];
	}
	var last = Config.nodes.filter(node => node.name === info.name);
	if (last.length === 0) {
		return [null, new Errors.GalanetError.NoSuchNode(info.name)];
	}
	else {
		Config.nodes.remove(last[0]);
		return ['删除节点成功'];
	}
};

const shutdownAll = () => new Promise(async res => {
	if (Config.nodes.length === 0) return res(0);
	var told = 0;
	await Promise.all(Config.nodes.map(async node => {
		if (!node.available) return;
		await sendRequest(node, 'put', '/galanet/shutdown');
		told ++;
	}));
	res(told);
});

const sendRequest = async (node, method, path, message) => {
	var result;
	try {
		if (node.method === 'http') {
			result = await httpClient(node.host, node.port, method, Config.prefix + path, message);
		}
		else {
			let data = {
				action: method || 'get',
				event: path,
				data: message
			};
			let err;
			if (node.method === 'tcp') {
				[result, err] = await TCP.client(node.host, node.port, data);
			}
			else if (node.method === 'udp') {
				[result, err] = await UDP.client(node.host, node.port, data);
			}
			else {
				let err = new Errors.GalanetError.WrongProtocol('错误的请求协议：' + node.method);
				return {
					ok: false,
					code: err.code,
					message: err.message
				};
			}
			if (!!err) {
				Logger.error(err);
				return {
					ok: false,
					code: err.code || 500,
					message: err.message
				};
			}
		}
		return result;
	}
	catch (err) {
		Logger.error(err);
		return {
			ok: false,
			code: err.code || 500,
			message: err.message
		};
	}
};

const connectNode = node => new Promise(res => {
	var connect;
	if (node.method === 'http') {
		connect = connectHTTP;
	}
	else if (node.method === 'tcp') {
		connect = connectTCP;
	}
	else if (node.method === 'udp') {
		connect = connectUDP;
	}
	else {
		Logger.warn('错误的节点协议: ', node);
		return res(new Errors.GalanetError.WrongProtocol());
	}
	connect(node, (data, err) => {
		if (!!err) {
			Logger.error('与节点 ' + node.name + ' 握手失败: ' + err.message);
			node.available = false;
			return res(err);
		}
		node.available = true;
		node.services = [...data];
		Logger.info('连接' + node.name + '成功！');
		res();
	});
});
const connectHTTP = async (node, callback) => {
	try {
		var reply = await httpClient(node.host, node.port, 'get', Config.prefix + '/galanet/shakehand', null);
		if (reply.ok) callback(reply.data);
		else callback(null, new Errors.GalanetError.ShakehandFailed(reply.message))
	}
	catch (err) {
		callback(null, err);
	}
};
const connectTCP = async (node, callback) => {
	var message = { event: '/galanet/shakehand', data: '' };
	try {
		var [reply, err] = await TCP.client(node.host, node.port, message);
		if (!!err) {
			callback(null, err);
		}
		else {
			if (reply.ok) callback(reply.data);
			else callback(null, new Errors.GalanetError.ShakehandFailed(reply.message))
		}
	}
	catch (err) {
		// callback(null, err);
	}
};
const connectUDP = async (node, callback) => {
	var message = { event: '/galanet/shakehand', data: '' };
	try {
		var [reply, err] = await UDP.client(node.host, node.port, message);
		if (!!err) {
			callback(null, err);
		}
		else {
			if (reply.ok) callback(reply.data);
			else callback(null, new Errors.GalanetError.ShakehandFailed(reply.message))
		}
	}
	catch (err) {
		callback(null, err);
	}
};

module.exports = {
	setConfig,
	addNode,
	removeNode,
	shakehand,
	reshakehand,
	check: checkRequester,
	checkService,
	launch: launchTask,
	getUsage,
	shutdownAll,
	get availableServices () {
		return Config.services;
	},
	get isInGroup () {
		return Config.nodes.filter(n => n.available).length > 1;
	}
};