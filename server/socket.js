const Path = require('path');
const FS = require('fs');
const EventEmitter = require('events');
const IO = require('socket.io');

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
		socket.on('__message__', msg => {
			var event = msg.event, data = msg.data;
			if (!eventLoop.eventNames().includes(event)) {
				socket.emit('__message__', {
					event,
					err: 'No Responsor!'
				});
			}
			else {
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

const autoRegister = path => {
	var list = FS.readdirSync(path);
	list.forEach(name => {
		var p = Path.join(path, name);
		var stat = FS.statSync(p);
		if (stat.isFile()) {
			let match = name.match(/^.+\.js$/i);
			if (!match) return;
			let res = require(p);
			if (!res) return;
			if (Array.isArray(res)) {
				res.forEach(res => {
					register(res.event, res.callback, res.namespace || '');
				});
			}
			else {
				register(res.event, res.callback, res.namespace || '');
			}
		}
		else if (stat.isDirectory()) {
			autoRegister(p);
		}
	});
};

autoRegister(Path.join(__dirname, './sockets'));

module.exports = {
	init,
	register,
	unregister,
	broadcast,
	get io () {
		return io
	}
};