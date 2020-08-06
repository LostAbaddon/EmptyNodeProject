require("./core");
loadall("./core/commandline");
loadall("./kernel");

const webServer = require('./server/web');
const socketServer = require('./server/socket');

const CLP = _('CL.CLP');
const setStyle = _('CL.SetStyle');

// 输出
module.exports = (config, options) => {
	// 配置命令行工具
	const clp = CLP({
		mode: 'process',
		title: config.name + " v" + config.version,
	}).describe(setStyle(config.name + " v" + config.version, "bold"));

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
			}
			else {
				console.log(setStyle(config.welcome.success, 'bold green'));
			}
		};

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
	});

	return clp;
};
