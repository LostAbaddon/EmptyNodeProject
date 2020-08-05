require("./core");
loadall("./core/commandline");
loadall("./kernel");

const webServer = require('./server');

const CLP = _('CL.CLP');
const setStyle = _('CL.SetStyle');

// 输出
module.exports = (config, options) => {
	// 配置命令行工具
	const clp = CLP({
		mode: 'process',
		title: config.name + " v" + config.version,
	}).describe(setStyle(config.name + " v" + config.version, "bold"));

	options.forEach(option => {
		clp.addOption(option);
	});

	clp.on('command', async (param, command) => {
		var cfg = param.config || './config.json';
		if (!!cfg) {
			cfg = require('path').join(process.cwd(), cfg);
			try {
				cfg = require(cfg);
				cfg = Object.assign(config.config.duplicate(), cfg);
			}
			catch {
				cfg = config.config.duplicate();
			}
		}
		if (Number.is(param.port)) cfg.port.http = param.port;
		if (Number.is(param.secure)) cfg.port.https = param.secure;

		webServer(cfg, (error) => {
			if (error instanceof Error) {
				console.error(setStyle(config.welcome.failed, 'bold red'));
				process.exit();
				return;
			}
			console.log(setStyle(config.welcome.success, 'bold green'));
		});
	}).launch();
};
