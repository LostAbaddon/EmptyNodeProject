const DefaultPort = 80;
const DefaultSecurePort = 443;

require("./core");
loadall("./core/commandline");
require("./common");

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
.addOption('--port -p [port=' + DefaultPort + '] >> 指定HTTP端口')
.addOption('--secure -s [port=' + DefaultSecurePort + '] >> 指定HTTPS端口')
.on('command', async (param, command) => {
	webServer(param.port || DefaultPort, param.secure || DefaultSecurePort, () => {
		console.log(setStyle('MondeVide', 'bold'));
	});
})
;

clp.launch();