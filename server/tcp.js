// TCP 的收发两端

const OS = require('os');
const Net = require('net');
const newID = _('Message.newID');
const packageMessage = _('Message.packageMessage');
const unpackMessage = _('Message.unpackMessage');

const DefaultConfig = {
	chunkSize: 4000,
	expire: 1000 * 60,
	lifespan: 1000 * 60 * 10
};
const Pipes = {};

const setConfig = cfg => {
	if (!cfg) return;
	if (Number.is(cfg.chunkSize) && cfg.chunkSize > 100) DefaultConfig.chunkSize = cfg.chunkSize;
	if (Number.is(cfg.expire) && cfg.expire > 1000) DefaultConfig.expire = cfg.expire;
};

const onReceiveMessage = (msg, repo, callback) => {
	var now = Date.now();
	for (let id in repo) {
		let item = repo[id];
		if (now - item.stamp > DefaultConfig.expire) {
			delete repo[id];
		}
	}

	msg = unpackMessage(msg);
	repo[msg.id] = repo[msg.id] || {stamp: now, data: []};
	var r = repo[msg.id];
	r.data[msg.index] = msg.data;
	if (r.data.length < msg.count) return;
	if (r.data.filter(d => !!d).length < msg.count) return;

	var len = 0;
	r.data.forEach(d => len += d.byteLength);
	var data = Buffer.alloc(len);
	var offset = 0;
	r.data.forEach(d => {
		d.copy(data, offset);
		offset += d.byteLength;
	});
	delete repo[msg.id];
	callback(data, msg.id);
};

const createServer = (host, port, callback, onMessage, onError) => new Promise(res => {
	var isIP = !!host.match(/^(\d+\.\d+\.\d+\.\d+|[abcdef\d:]+[abcdef\d]+)$/);
	if (!Number.is(port) && isIP) {
		let err = new Errors.ServerError.UnavailablePort('TCP 端口指定错误！');
		if (!!callback) callback(null, err);
		res([null, err]);
		return;
	}

	var inited = false;
	var server = Net.createServer(socket => {
		// connected 事件
		var packages = [], repo = {};
		var timeoutter = null;
		var refresh = () => {
			cancel();
			timeoutter = setTimeout(() => {
				timeoutter = null;
				packages = null;
				repo = null;
				socket.destroy();
			}, DefaultConfig.lifespan);
		};
		var cancel = () => {
			if (!!timeoutter) {
				clearTimeout(timeoutter);
				timeoutter = null;
			}
		};

		socket
		.on('close', () => {
			repo = undefined;
			repo = null;
			packages = null;
			socket.destroy();
			cancel();
		})
		.on('error', (err) => {
			repo = undefined;
			repo = null;
			packages = null;
			socket.destroy();
			cancel();
			if (!!onError) onError(err);
		})
		.on('data', data => {
			refresh();
			onReceiveMessage(data, repo, (data, mid) => {
				var message = data.toString();
				try {
					let temp = JSON.parse(message);
					data = temp;
				}
				catch {
					data = message;
				}
				if (!!onMessage) onMessage(data, reply => {
					packages.push(...packageMessage(reply, DefaultConfig.chunkSize, mid));
					send();
				});
			});
		});

		var send = () => {
			var pack = packages.shift();
			if (!pack) { // 信息已经全部发送完毕
				return;
			}
			refresh();
			socket.write(pack, () => {
				send();
			});
		};
	});
	// 创建失败
	server.on('error', err => {
		if (inited) return;
		inited = true;

		var e = new Errors.ServerError.CreateServerFailed('TCP 服务端创建失败！\n' + err.message);
		if (!!callback) callback(e);
	});
	// 绑定监听端口
	var onInit = () => {
		if (inited) return;
		inited = true;
		if (!!callback) callback(server, null);
		res([server, null]);
	};
	if (isIP) server.listen(port, host, onInit);
	else {
		if (OS.platform() === 'win32') host = '\\\\?\\pipe\\' + host;
		server.listen(host, onInit);
	}
});

const createClient = (host, port, message, callback, persist=false) => new Promise(res => {
	var isIP = !!host.match(/^(\d+\.\d+\.\d+\.\d+|[abcdef\d:]+[abcdef\d]+)$/);
	var tag = host + ':' + port, mid = newID(), smid = mid.join('-');
	if (!!Pipes[tag]) {
		let pipe = Pipes[tag];
		pipe.cbs[smid] = (msg, err) => {
			if (!!callback) callback(msg, err);
			res([msg, err]);
		};
		pipe.sender(message, mid);
		return;
	}

	var packages = [], repo = {}, done;
	var timeoutter = null;
	var refresh = () => {
		cancel();
		if (persist) return;
		timeoutter = setTimeout(() => {
			timeoutter = null;
			packages = null;
			repo = null;
			socket.destroy();
		}, DefaultConfig.expire);
	};
	var cancel = () => {
		if (!!timeoutter) {
			clearTimeout(timeoutter);
			timeoutter = null;
		}
	};

	var socket;
	if (isIP) socket = Net.createConnection({ host, port });
	else {
		if (OS.platform() === 'win32') host = '\\\\?\\pipe\\' + host;
		socket = Net.createConnection(host);
	}
	socket
	.on('error', async err => {
		if (err.code === 'ECONNREFUSED') {
			let e = new Errors.ServerError.ConnectRemoteFailed('目标连接失败：' + host + ':' + port);
			if (persist) {
				let item = Pipes[tag];
				delete Pipes[tag];
				if (!!item && item.cbs) {
					for (let cb in item.cbs) {
						cb = item.cbs[cb];
						if (!!cb) cb(null, e);
					}
				}
			}
			else {
				if (!!callback) callback(null, e);
				res([null, e]);
			}
			return;
		}
		else if (err.code === 'ECONNRESET') {
			socket.destroy();
			return;
		}
		callback(null, err);
	})
	.on('connect', () => {
		sendData(message, mid);
	})
	.on('close', () => {
		if (!done) {
			let err = new Errors.ServerError.ConnectionBroken();
			if (persist) {
				let item = Pipes[tag];
				delete Pipes[tag];
				if (!!item && item.cbs) {
					for (let cb in item.cbs) {
						cb = item.cbs[cb];
						if (!!cb) cb(null, err);
					}
				}
			}
			else {
				if (!!callback) callback(null, err);
				res([null, err]);
			}
		}
		done = true;
		repo = null;
		packages = null;
		socket.destroy();
		cancel();
	})
	.on('data', data => {
		refresh();
		onReceiveMessage(data, repo, (data, mid) => {
			var message = data.toString();
			try {
				let temp = JSON.parse(message);
				data = temp;
			}
			catch {
				data = message;
			}
			if (persist) {
				let item = Pipes[tag];
				if (!!item && item.cbs) {
					let tid = mid.join('-');
					let cb = item.cbs[tid];
					delete item.cbs[tid];
					if (!!cb) cb(data, null);
				}
			}
			else {
				done = true;
				repo = null;
				packages = null;
				socket.destroy();
				cancel();
				if (!!callback) callback(data, null);
				res([data, null]);
			}
		});
	});

	var send = () => {
		var pack = packages.shift();
		if (!pack) { // 信息已经全部发送完毕
			return;
		}
		refresh();
		socket.write(pack, () => {
			send();
		});
	};
	var sendData = (message, mid) => {
		var should = (packages.length === 0);
		packages.push(...packageMessage(message, DefaultConfig.chunkSize, mid));
		if (should) send();
	};
	if (persist) {
		let item = {
			sender: sendData,
			cbs: {}
		};
		item.cbs[smid] = (msg, err) => {
			if (!!callback) callback(msg, err);
			res([msg, err]);
		};
		Pipes[tag] = item;
	}
});

module.exports = {
	config: setConfig,
	server: createServer,
	client: createClient
};