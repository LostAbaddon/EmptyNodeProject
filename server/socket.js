// WebSocket 事件的处理分两部分：
// 一部分是 Responsor 中注册的处理回调
// 另一部分是通过 Regiester 机制注册的监听者

const EventEmitter = require('events');
const IO = require('socket.io');
const ResponsorManager = require('./responser');

var io;
var eventLoop = new EventEmitter();
var sockets = [];

const init = (server) => {
	io = new IO(server);

	io.on('connection', socket => {
		sockets.push(socket);
		socket.on('disconnect', () => {
			var idx = sockets.indexOf(socket);
			if (idx >= 0) sockets.splice(idx, 1);
			eventLoop.emit('disconnected', null, socket);
		});
		socket.on('__message__', async msg => {
			var event = msg.event, data = msg.data, action = msg.action || 'get', done = false;
			var [res, query] = ResponsorManager.match(event, action, 'socket');
			if (!!res) {
				let result = null;
				try {
					result = await res(data, query, event, socket, action, 'socket');
					socket.send(event, result);
					done = true;
				}
				catch (err) {
					socket.send(event, null, err.message);
				}
			}

			if (!!eventLoop.eventNames().includes(event)) {
				eventLoop.emit(event, data, socket, msg);
			}
		});
		socket.send = (event, data, err) => {
			socket.emit('__message__', { event, data, err });
		};
		eventLoop.emit('connected', null, socket);
	});
};

const register = (event, responser) => {
	eventLoop.on(event, responser);
};
const unregister = (event, responser) => {
	eventLoop.off(event, responser);
};
const broadcast = (event, data) => {
	sockets.forEach(socket => {
		if (!socket) return;
		socket.send(event, data);
	});
};

module.exports = {
	init,
	register,
	unregister,
	broadcast,
	get io () {
		return io
	}
};