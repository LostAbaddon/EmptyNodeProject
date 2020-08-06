// TCP 的收发两端

const Net = require('net');
const packageMessage = _('Message.packageMessage');
const unpackMessage = _('Message.unpackMessage');

const DefaultConfig = {
	chunkSize: 4000,
	expire: 1000 * 60
};

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
	callback(data);
};

const createServer = (port, callback, onMessage, onError) => new Promise(res => {
	if (!Number.is(port)) {
		let err = new Errors.ConfigError.UnavailablePort('TCP 端口指定错误！');
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
			}, DefaultConfig.expire);
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
			onReceiveMessage(data, repo, data => {
				var message = data.toString();
				try {
					let temp = JSON.parse(message);
					data = temp;
				}
				catch {
					data = message;
				}
				if (!!onMessage) onMessage(data, reply => {
					packages.push(...packageMessage(reply, DefaultConfig.chunkSize));
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

		var e = new Errors.ConfigError.CreateServerFailed('TCP 服务端创建失败！\n' + err.message);
		if (!!callback) callback(e);
	});
	// 绑定监听端口
	server.listen(port, () => {
		if (inited) return;
		inited = true;
		if (!!callback) callback(server, null);
		res([server, null]);
	});
});

const createClient = (host, port, message, callback) => new Promise(res => {
	var packages = [], repo = {};
	var timeoutter = null;
	var refresh = () => {
		cancel();
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

	var socket = Net.createConnection({ host, port })
	.on('error', async err => {
		if (err.code === 'ECONNREFUSED') {
			let e = new Errors.ConfigError.ConnectRemoteFailed('目标连接失败：' + host + ':' + port);
			callback(null, e);
			return;
		}
		else if (err.code === 'ECONNRESET') {
			repo = null;
			packages = null;
			socket.destroy();
			cancel();
			return;
		}
		callback(null, err);
	})
	.on('connect', () => {
		packages.push(...packageMessage(message, DefaultConfig.chunkSize));
		send();
	})
	.on('close', () => {
		repo = null;
		packages = null;
		socket.destroy();
		cancel();
	})
	.on('data', data => {
		refresh();
		onReceiveMessage(data, repo, data => {
			var message = data.toString();
			try {
				let temp = JSON.parse(message);
				data = temp;
			}
			catch {
				data = message;
			}
			repo = null;
			packages = null;
			socket.destroy();
			cancel();
			if (!!callback) callback(data, null);
			res([data, null]);
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

module.exports = {
	config: setConfig,
	server: createServer,
	client: createClient
};