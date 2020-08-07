const EventEmitter = require('events');
const setStyle = _('CL.SetStyle');
const tcpManager = require('./tcp');
const udpManager = require('./udp');
const ResponsorManager = require('./responser');

const eventLoop = new EventEmitter();

const init = (config, callback) => {
	var tasks = {}, count = 0, success = 0;
	var cb = (task, ok) => {
		if (tasks[task]) return;
		tasks[task] = true;
		count --;
		if (ok) success ++;
		if (count !== 0) return;
		if (success === 0) {
			callback(new Errors.ConfigError.NoSocketServerAvailable());
		}
		else {
			callback();
		}
	};

	if (Number.is(config.port.tcp)) {
		count ++;
		tasks.tcp = false;

		tcpManager.server('127.0.0.1', config.port.tcp, (svr, err) => {
			if (!!err) {
				console.error(setStyle('Launch TCP-Server Failed.', 'bold red'));
				cb('tcp', false);
			}
			else {
				cb('tcp', true);
			}
		}, (msg, socket, resp) => {
			eventLoop.emit('message', 'tcp', msg, socket, resp);
		});
	}
	if (String.is(config.port.pipe)) {
		count ++;
		tasks.pipe = false;

		tcpManager.server(config.port.pipe, null, (svr, err) => {
			if (!!err) {
				console.error(setStyle('Launch Pipe-Server Failed.', 'bold red'));
				cb('pipe', false);
			}
			else {
				cb('pipe', true);
			}
		}, (msg, socket, resp) => {
			eventLoop.emit('message', 'pipe', msg, socket, resp);
		});
	}
	if (Number.is(config.port.udp4)) {
		count ++;
		tasks.udp4 = false;

		udpManager.server('127.0.0.1', config.port.udp4, (svr, err) => {
			if (!!err) {
				console.error(setStyle('Launch UDPv4-Server Failed.', 'bold red'));
				cb('udp4', false);
			}
			else {
				cb('udp4', true);
			}
		}, (msg, socket, resp) => {
			eventLoop.emit('message', 'udp4', msg, socket, resp);
		});
	}
	if (Number.is(config.port.udp6)) {
		count ++;
		tasks.udp6 = false;

		udpManager.server('127.0.0.1', config.port.udp6, (svr, err) => {
			if (!!err) {
				console.error(setStyle('Launch UDPv4-Server Failed.', 'bold red'));
				cb('udp6', false);
			}
			else {
				cb('udp6', true);
			}
		}, (msg, socket, resp) => {
			eventLoop.emit('message', 'udp6', msg, socket, resp);
		});
	}

	if (count === 0) {
		callback(new Errors.ConfigError.NoPorts());
	}
	else {
		eventLoop.on('message', async (protocol, msg, socket, resp) => {
			if (!msg || !msg.event) {
				resp("ERROR:NOEVENT");
				return;
			}

			var event = msg.event, data = msg.data, action = msg.action || 'get';
			var [res, query] = ResponsorManager.match(event, action, protocol);
			if (!!res) {
				let result = null;
				try {
					result = await res(data, query, event, socket, action, protocol);
					resp(result);
				}
				catch (err) {
					console.error(err.message);
					resp("ERROR:RESPONSEFAILED");
				}
			}
			else {
				resp("ERROR:NORESPONSOR");
			}
		});
	}
};

module.exports = init;