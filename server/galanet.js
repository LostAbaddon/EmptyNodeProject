const Path = require('path');
const Net = require('net');
const Axios = require('axios');
const TCP = require('../kernel/tcp');
const UDP = require('../kernel/udp');
const { Dealer, DealerPool } = require('../kernel/dealer');
const Personel = require('./personel');
const Shakehand = _('Message.Shakehand');
const Logger = new (_("Utils.Logger"))('Galanet');
var ResponsorManager;

const AvailableSource = [ 'tcp', 'udp', 'http' ];
const Config = {
	prefix: '',
	nodes: [],
	services: []
}
const Pending = [];
const Reshakings = new Map();

class RichAddress extends Dealer {
	#name = '';
	protocol = '';
	host = '';
	port = '';
	filter = new Set();  // 本地转发哪些服务
	constructor (protocol, host, port, filter) {
		super();
		if (!host) {
			if (String.is(protocol)) {
				protocol = RichAddress.parse(protocol);
			}
			if (protocol instanceof RichAddress) {
				this.#name = protocol.name;
				this.protocol = protocol.protocol;
				this.host = protocol.host;
				this.port = protocol.port;
				protocol.filter.forEach(f => this.filter.add(f));
			}
			else {
				return;
			}
		}
		else if (!!protocol) {
			if (AvailableSource.indexOf(protocol) < 0) return;
			this.protocol = protocol;
			this.host = host;
			this.port = port;
			if (String.is(filter)) filter = filter.split('/').filter(f => !!f && f.length > 0);
			filter.forEach(f => this.filter.add(f));
			this.#name = protocol + '/' + host + '/' + port;
		}
		this.available = false;
	}
	addFilter (filter) {
		// filter中为空表示对所有服务都可转发
		if (!filter) return;
		if (this.filter.size === 0) return;
		if (Array.is(filter)) {
			if (filter.length === 0) {
				this.filter.clear();
				return;
			}
			filter.forEach(f => this.filter.add(f));
		}
		else if (filter instanceof Set) {
			if (filter.size === 0) {
				this.filter.clear();
				return;
			}
			for (let f of filter) {
				this.filter.add(f);
			}
		}
	}
	equal (conn) {
		if (String.is(conn)) conn = RichAddress.parse(conn);
		else if (!(conn instanceof RichAddress)) return false;
		if (!conn) return false;
		return this.name === conn.name;
	}
	toString () {
		return this.fullname;
	}
	suicide () {
		this.onDied(() => {
			this.filter.clear();
			delete this.filter;
			this.#name = '';
			this.protocol = '';
			this.host = '';
			this.port = '';
		});
		super.suicide();
	}
	get name () {
		return this.#name;
	}
	get fullname () {
		return this.#name + '/' + [...this.filter].join('/');
	}
	get isEmpty () {
		return !!this.#name;
	}
	static parse (node) {
		var conn = node.split('/');
		var source = conn[0];
		if (AvailableSource.indexOf(source) < 0) return null;
		var ip = conn[1], port = conn[2] * 1, filter = conn.splice(3, conn.length).filter(f => !!f && f.length > 0);
		if (!Net.isIP(ip) || !Number.is(port)) return null;
		var info = new RichAddress(source, ip, port, filter);
		return info;
	}
}
class UserNode extends Dealer {
	name = "";
	pubkey = "";
	#services = new Set(); // 对方接受的服务类型
	#pool = new DealerPool(RichAddress);
	constructor (name) {
		super();
		if (!!name) this.name = name;
	}
	addConn (conn) {
		if (String.is(conn)) conn = RichAddress.parse(conn);
		else if (!(conn instanceof RichAddress)) return;
		if (!conn) return;

		var has = false;
		this.#pool.forEach(cn => {
			if (has) return;
			if (!cn.equal(conn)) return;
			cn.addFilter(conn.filter);
			has = true;
		});
		if (!has) this.#pool.addMember(conn);
	}
	removeConn (conn) {
		if (String.is(conn)) conn = RichAddress.parse(conn);
		else if (!(conn instanceof RichAddress)) return;
		if (!conn) return;

		var target = this.#pool.filter(cn => cn.equal(conn));
		if (target.length === 0) return;
		target = target[0];
		this.#pool.removeMember(target);
	}
	forEach (cb) {
		this.#pool.forEach(cb);
	}
	addService (services) {
		if (services === 'all') {
			this.#services.clear();
			this.#services = 'all';
		}
		else if (String.is(services)) this.#services.add(services);
		else if (Array.is(services)) services.forEach(s => this.#services.add(s));
		else if (services instanceof Set) {
			for (let s of services) this.#services.add(s);
		}
	}
	removeService (service) {
		this.#services.delete(service);
	}
	resetServices () {
		if (this.#services instanceof Set) {
			this.#services.clear();
		}
		else {
			this.#services = new Set();
		}
	}
	suicide () {
		var task = 2;
		var cb = () => {
			task --;
			if (task > 0) return;

			this.name = '';
			if (this.#services instanceof Set) this.#services.clear();
			this.#services = undefined;
			this.#pool = undefined;
		};
		this.#pool.onDied(cb);
		this.onDied(cb);
		this.#pool.suicide();
		super.suicide();
	}
	get services () {
		if (this.state === DealerPool.State.DYING || this.state === DealerPool.State.DIED) return null;
		if (this.#services instanceof Set) return [...this.#services];
		return 'all';
	}
}
class UserPool extends DealerPool {
	waitingConns = [];
	constructor () {
		super(UserNode);
	}
	addConn (name, conn) {
		if (!conn) {
			conn = name;
			name = null;
		}
		if (!name) this.waitingConns.push(conn);
		else {
			let mem = this.waitingConns.filter(c => c.name === conn.name);
			if (mem.length > 0) {
				mem.forEach(m => this.waitingConns.remove(m));
			}
			mem = null;
			this.forEach(m => {
				if (m.name !== name) return;
				mem = m;
			});
			if (!mem) {
				mem = new UserNode(name);
				this.addMember(mem);
			}
			mem.addConn(conn);
		}
	}
	removeConn (conn) {
		if (this.waitingConns.includes(conn)) this.waitingConns.remove(conn);
		this.forEach(m => {
			m.removeConn(conn);
		});
	}
	getUser (name) {
		var user = null;
		this.forEach(u => {
			if (!!user) return;
			if (u.name === name) user = u;
		});
		return user;
	}
	shakehand (ip) {
		this.waitingConns.forEach(conn => {
			if (conn.available) return;
			if (!!ip && conn.host !== ip) return;
			connectNode(conn);
		});
		this.forEach(mem => {
			mem.forEach(conn => {
				if (conn.available) return;
				if (!!ip && conn.host !== ip) return;
				connectNode(conn);
			});
		});
	}
	hasHost (host) {
		var has = this.waitingConns.some(conn => conn.host === host);
		if (has) return true;
		this.forEach(node => {
			if (has) return;
			node.forEach(conn => {
				if (has || (conn.host !== host)) return;
				has = true;
			});
		});
		return has;
	}
}
const UserManager = new UserPool();

const setConfig = async (cfg, callback) => {
	ResponsorManager = require('./responser'); // 不可先加载，因为那次该模块还没初始化完毕
	if (!callback) callback = () => {};

	Config.prefix = cfg.api.url;
	if (!!cfg.api?.services) {
		Config.services.push(...cfg.api.services);
	}
	ResponsorManager.load(Path.join(__dirname, 'insider'), false);

	if (isSlaver) return callback();
	if (!cfg.node || !cfg.node.length || cfg.node.length <= 0) return callback();

	var nodes = {};
	cfg.node.forEach(node => {
		var temp = RichAddress.parse(node);
		if (!temp) return;
		var info = nodes[temp.name];
		if (!!info) {
			temp.filter.forEach(f => {
				if (info.filter.has(f)) return;
				info.filter.add(f);
			});
		}
		else {
			nodes[temp.name] = temp;
		}
	});
	for (let tag in nodes) {
		UserManager.waitingConns.push(nodes[tag]);
	}
	var local = new UserNode('local');
	UserManager.addMember(local);

	callback();
};

const reshakehand = ip => {
	var res = Reshakings.get(ip);
	if (!!res) {
		clearTimeout(res);
	}
	Reshakings.set(ip, setTimeout(() => {
		Reshakings.delete(ip);
		UserManager.shakehand(ip);
	}, 1000));
};
const checkRequester = ip => UserManager.hasHost(ip);
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

const addNode = async node => {
	var info = RichAddress.parse(node);
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
	var info = RichAddress.parse(node);
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

const getNodeInfo = () => {
	return global.PersonCard.toString();
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
	if (node.protocol === 'http') {
		connect = connectHTTP;
	}
	else if (node.protocol === 'tcp') {
		connect = connectTCP;
	}
	else if (node.protocol === 'udp') {
		connect = connectUDP;
	}
	else {
		Logger.warn('错误的节点协议: ', node.name);
		return res(new Errors.GalanetError.WrongProtocol());
	}
	connect(node, (data, err) => {
		if (!!err) {
			Logger.error('与节点 ' + node.name + ' 握手失败: ' + err.message);
			node.available = false;
			return res(err);
		}
		node.available = true;

		var info;
		try {
			info = Shakehand.fromString(data);
		}
		catch (err) {
			Logger.warn('获取握手数据解析错误：' + err.message);
			return res();
		}
		if (!info) return res();
		info = info[0];
		if (!info) return res();

		var check = false;
		try {
			check = Personel.check(info.pubkey, info.id);
		}
		catch (err) {
			Logger.warn('验证握手数据错误：' + err.message);
			return res();
		}
		if (!check) return res();

		UserManager.addConn(info.id, node);

		var user = UserManager.getUser(info.id);
		user.addService(info.services);
		user.pubkey = info.pubkey;
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
	shakehand: ip => UserManager.shakehand(ip),
	reshakehand,
	check: checkRequester,
	checkService,
	launch: launchTask,
	getUsage,
	getNodeInfo,
	shutdownAll,
	get availableServices () {
		return Config.services;
	},
	get isInGroup () {
		return Config.nodes.filter(n => n.available).length > 1;
	}
};