const Path = require('path');

require("./core");
loadall(__dirname, "./core/commandline");
loadall(__dirname, "./kernel");
require('./server/center');
const webServer = require('./server/web');
const socketServer = require('./server/socket');
const ResponsorManager = require('./server/responser');

const CLP = _('CL.CLP');
const setStyle = _('CL.SetStyle');

const createServer = (config, options) => {
	// 配置命令行工具
	const clp = CLP({
		mode: 'process',
		title: config.name + " v" + config.version,
	}).describe(setStyle(config.name + " v" + config.version, "bold"))
	.addOption('--console [console] >> 启用控制台');

	options.forEach(opt => clp.addOption(opt));

	clp.on('command', async (param, command) => {
		var cfg = param.config || './config.json';
		if (!!cfg) {
			cfg = require('path').join(process.cwd(), cfg);
			try {
				cfg = require(cfg);
				cfg = Object.assign(config.config.duplicate(), cfg);
			}
			catch (err) {
				cfg = config.config.duplicate();
			}
		}
		if (Number.is(param.port)) cfg.port.http = param.port;
		if (Number.is(param.secure)) cfg.port.https = param.secure;
		if (Number.is(param.tcp)) cfg.port.tcp = param.tcp;
		if (Number.is(param.udp4)) cfg.port.udp4 = param.udp4;
		if (Number.is(param.udp6)) cfg.port.udp6 = param.udp6;
		if (Number.is(param.process) || param.process === 'auto') cfg.process = param.process;
		if (Boolean.is(param.console) || String.is(param.console)) cfg.console = param.console;
		console.log(param.console, cfg.console);
		return;

		// Load Responsors
		if (!cfg.api) {
			let err = new Errors.ConfigError.NoResponsor();
			console.error(err.message);
			console.error(setStyle(config.welcome.failed, 'bold red'));
			process.exit();
			return;
		}
		if (!!cfg.api.local) {
			cfg.isDelegator = false;
			ResponsorManager.load(Path.join(process.cwd(), cfg.api.local));
		}
		else {
			cfg.isDelegator = true;
		}

		var tasks = {}, count = 0, success = 0;
		var cb = (task, ok) => {
			if (tasks[task]) return;
			tasks[task] = true;
			count --;
			if (ok) success ++;
			if (count !== 0) return;
			if (success === 0) {
				console.error(setStyle(config.welcome.failed, 'bold red'));
				process.exit();
				return;
			}
			ResponsorManager.setConfig(cfg);
			console.log(setStyle(config.welcome.success, 'bold green'));
		};

		// 启动 Web 服务器
		count ++;
		tasks.web = false;
		webServer(cfg, (error) => {
			if (error instanceof Error) {
				console.error(setStyle('Launch Web-Server Failed.', 'bold red'));
				cb('web', false);
			}
			else {
				cb('web', true);
			}
		});

		// 启动 TCP / UDP 服务器
		count ++;
		tasks.socket = false;
		socketServer(cfg, (error) => {
			if (error instanceof Error) {
				console.error(setStyle('Launch Socket-Server Failed.', 'bold red'));
				cb('socket', false);
			}
			else {
				cb('socket', true);
			}
		});

		if (!!cfg.console) {

		}
	});

	return clp;
};
const createConsole = () => {};

// 输出
module.exports = {
	server: createServer,
	console: createConsole
};