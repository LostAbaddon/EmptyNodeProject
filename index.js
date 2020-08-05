const DefaultConfig = {
	page: './page',
	port: {
		http: 80,
		https: 443
	}
};

require("./core");
loadall("./core/commandline");
loadall("./kernel");

const webServer = require('./server');

const CLP = _('CL.CLP');
const setStyle = _('CL.SetStyle');

// 系统参数
const CSP_Name = "MondeVide";
const CSP_Version = "0.0.1";

// 配置命令行工具
const clp = CLP({
	mode: 'process',
	title: CSP_Name + " v" + CSP_Version,
})
.describe(setStyle(CSP_Name + " v" + CSP_Version, "bold"))
.addOption('--config -c <config> >> 指定配置文件')
.addOption('--port -p [port=' + DefaultConfig.port.http + '] >> 指定HTTP端口')
.addOption('--secure -s >> 指定HTTPS端口')
.on('command', async (param, command) => {
	var config = param.config;
	if (!!config) {
		config = require('path').join(process.cwd(), config);
		try {
			config = require(config);
			config = Object.assign(DefaultConfig.duplicate(), config);
		}
		catch {
			config = DefaultConfig.duplicate();
		}
	}
	if (Number.is(param.port)) config.port.http = param.port;
	if (Number.is(param.secure)) config.port.https = param.secure;

	webServer(config, (error) => {
		if (error instanceof Error) {
			console.error(setStyle('Vana Mundi: DESTRUI', 'bold red'));
			process.exit();
			return;
		}
		console.log(setStyle('Vana Mundi: VENI VIDI VICI', 'bold green'));
	});
})
;

clp.launch();