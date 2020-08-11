const Path = require('path');
const URL = require('url');
const Net = require('net');
const Axios = require('axios');
const Http = require('http');
const TCP = require('../kernel/tcp');
const UDP = require('../kernel/udp');
var ResponsorManager;

const AvailableSource = [ 'tcp', 'udp', 'http' ];
const Config = {
	prefix: '',
	nodes: [],
	services: []
}
const Reshakings = {};

const setConfig = cfg => {
	ResponsorManager = require('./responser'); // 不可先加载，因为那次该模块还没初始化完毕

	Config.prefix = cfg.api.url;
	if (!!cfg.api?.services) {
		Config.services.push(...cfg.api.services);
	}
	require('./responser').load(Path.join(__dirname, 'insider'), false);
	if (isSlaver) return;
	if (!cfg.node || !cfg.node.length || cfg.node.length <= 0) return;

	var nodes = {};
	cfg.node.forEach(node => {
		var conn = node.split('/');
		var source = conn[0];
		if (AvailableSource.indexOf(source) < 0) return;
		var ip = conn[1], port = conn[2] * 1, filter = conn.splice(3, conn.length).filter(f => !!f && f.length > 0);
		if (!Net.isIP(ip) || !Number.is(port)) return;
		var tag = source + '/' + ip + '/' + port;
		var info = nodes[tag];
		if (!info) {
			info = {
				method: source,
				host: ip,
				port,
				filter: [],
				name: tag
			};
			nodes[tag] = info;
		}
		if (filter.length > 0) info.filter.push(filter);
	});
	for (let tag in nodes) {
		Config.nodes.push(nodes[tag]);
	}
	Config.nodes.push({ name: 'local', available: true });

	Config.nodes.forEach(node => {
		node.taskInfo = {
			total: 0,
			done: 0,
			time: 0,
			energy: 1,
			power: 1
		};
		node.failed = 0;
		if (node.name == 'local') node.taskInfo.power = 0.5;
	});
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
const launchTask = async (responsor, param, query, url, data, method, source, ip, port) => {
	var resps = [];
	Config.nodes.forEach(node => {
		if (!node.available) return;
		if (node.name === 'local') {
			if (!isDelegator) resps.push(node);
			return;
		}

		var parts = url.split('/').filter(f => !!f && f.length > 0);
		if (node.services.indexOf(parts[0]) < 0) return;
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

	// 筛选
	var resp;
	if (resps.length === 0) {
		if (isDelegator) {
			let err = new Errors.GalanetError.EmptyClustor();
			return {
				ok: false,
				code: err.code,
				message: err.message
			};
		}
		else {
			resp = Config.nodes.filter(node => node.name === 'local')[0];
		}
	}
	else {
		resps.sort((ra, rb) => ra.taskInfo.power - rb.taskInfo.power);
		resp = resps[0];
	}

	var time = Date.now(), result;
	resp.taskInfo.total ++;
	resp.taskInfo.power = resp.taskInfo.energy * (1 + resp.taskInfo.total - resp.taskInfo.done);
	if (resp.name === 'local') { // 本地处理
		result = await ResponsorManager.launchLocally(responsor, param, query, url, data, method, source, ip, port);
	}
	else { // 发送给群组节点处理
		param = param || {};
		param.isGalanet = true;
		param.originHost = ip;
		param.originPort = port;
		param.originSource = source;
		result = await sendRequest(resp, method, url, param);
	}
	resp.taskInfo.done ++;
	time = Date.now() - time;
	if (!result.ok) {
		time = 1.2 * time + 20;
		if (result.code === Errors.GalanetError.NotFriendNode.code) {
			resp.failed ++;
			if (resp.failed === 3) Config.nodes.remove(resp);
			await waitLoop();
			result = await launchTask(responsor, param, query, url, data, method, source, ip, port);
		}
		else {
			console.error(resp.name + ' error(' + resp.code + '): ' + resp.message);
		}
	}
	resp.taskInfo.time += time;
	resp.taskInfo.energy = (resp.taskInfo.time / resp.taskInfo.done * 2 + time) / 3;
	resp.taskInfo.power = resp.taskInfo.energy * (1 + resp.taskInfo.total - resp.taskInfo.done);

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
				console.error(err);
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
		console.error(err);
		return {
			ok: false,
			code: err.code || 500,
			message: err.message
		};
	}
};

const connectNode = node => {
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
		console.log(node);
		return;
	}
	connect(node, (data, err) => {
		if (!!err) {
			console.error('SHAKEHAND FAILED: ' + err.message);
			node.available = false;
			return;
		}
		node.available = true;
		node.services = [...data];
		console.log('连接' + node.name + '成功！');
	});
};
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
	shakehand,
	reshakehand,
	check: checkRequester,
	launch: launchTask,
	get availableServices () {
		return Config.services;
	},
	get isInGroup () {
		return Config.nodes.length > 1;
	}
};