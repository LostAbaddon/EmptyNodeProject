const Path = require('path');
const URL = require('url');
const Net = require('net');
const Http = require('http');

const AvailableSource = [ 'tcp', 'udp', 'http' ];

const Config = {
	prefix: '',
	nodes: [],
	services: []
}
const Handlers = {};

const setConfig = cfg => {
	if (!cfg.node || !cfg.node.length || cfg.node.length <= 0) return;

	Config.prefix = cfg.api.url;
	if (!!cfg.api?.services) {
		Config.services.push(...cfg.api.services);
	}
	require('./responser').load(Path.join(__dirname, 'insider'));
	if (isSlaver) return;

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
				name: node
			};
			nodes[tag] = info;
		}
		if (filter.length > 0) info.filter.push(filter);
	});
	for (let tag in nodes) {
		Config.nodes.push(nodes[tag]);
	}
	Config.nodes.forEach(node => connectNode(node));
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
		console.log(node);
	});
};
const reShakehand = (ip) => {
	Config.nodes.forEach(node => {
		if (node.available) return;
		if (node.host !== ip) return;
		connectNode(node);
	});	
};

const httpClient = (host, port, method, path, param, callback) => new Promise((res, rej) => {
	var p = [];
	if (!!param) for (let key in param) {
		p.push(key + '=' + param[key].toString());
	}
	if (p.length > 0) path = path + '?' + p.join('&');
	var socket = Http.request({
		host: host,
		port: port,
		method: method,
		path
	}, resp => {
		var reply = Buffer.alloc(0);
		resp.resume();
		resp.on('data', data => {
			reply = Buffer.concat([reply, data]);
		}).on('end', () => {
			var data = reply.toString();
			reply = undefined;
			delete replay;
			var msg;
			try {
				msg = JSON.parse(data);
			}
			catch {
				msg = data;
			}
			if (!!callback) callback(msg);
			res(msg);
		});
	}).on('error', (err) => {
		if (!!callback) callback(null, err);
		rej(err);
	}).end();
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
const connectTCP = (node, callback) => {};
const connectUDP = (node, callback) => {};

module.exports = {
	setConfig,
	reShakehand,
	get availableServices () {
		return Config.services;
	}
};