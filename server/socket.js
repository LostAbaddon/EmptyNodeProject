const EventEmitter = require('events');
const ResponsorManager = require('./responser');
const tcpManager = require('./tcp');
const setStyle = _('CL.SetStyle');

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

	if (!!config.port.tcp) {
		count ++;
		tasks.tcp = false;

		tcpManager.server('/tmp/node.ipc', null, (svr, err) => {
		// tcpManager.server('127.0.0.1', config.port.tcp, (svr, err) => {
			if (!!err) {
				console.error(setStyle('Launch TCP-Server Failed.', 'bold red'));
				cb('tcp', false);
			}
			else {
				cb('tcp', true);
			}
		}, (msg, resp) => {
			eventLoop.emit('message', 'tcp', msg, resp);
		});
	}
	if (!!config.port.udp4 && 1 == 0) {
		count ++;
		tasks.udp4 = false;
		connServer.server('udp4', config.udp4, (svr, err) => {
			if (!!err) {
				console.error(setStyle('Launch UDP4-Server Failed.', 'bold red'));
				cb('udp4', false);
			}
			else {
				cb('udp4', true);
			}
		});
	}
	if (!!config.port.udp6 && 1 == 0) {
		count ++;
		tasks.udp6 = false;
		connServer.server('udp6', config.udp6, (svr, err) => {
			if (!!err) {
				console.error(setStyle('Launch UDP6-Server Failed.', 'bold red'));
				cb('udp6', false);
			}
			else {
				cb('udp6', true);
			}
		});
	}

	if (count === 0) {
		callback(new Errors.ConfigError.NoPorts());
	}
	else {
		eventLoop.on('message', async (protocol, msg, resp) => {
			if (!msg || !msg.event) {
				resp("ERROR:NOEVENT");
				return;
			}

			var event = msg.event, data = msg.data, action = msg.action || 'get';
			var [res, query] = ResponsorManager.match(event, action, protocol);
			if (!!res) {
				let result = null;
				try {
					result = await res(data, query, event, null, action, protocol);
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