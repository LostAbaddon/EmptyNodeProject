global.noEventModules = true;

const Path = require('path');
require("./core");
loadall(__dirname, "./core/commandline");
loadall(__dirname, "./kernel", false);
loadall(__dirname, "./db", false);
require('./server/center');
const webServer = require('./server/web');
const socketServer = require('./server/socket');
const consoleServer = require('./server/console');
const ResponsorManager = require('./server/responser');
const CLP = _('CL.CLP');
const setStyle = _('CL.SetStyle');
const DefailtIPC = '/tmp/console.ipc';

global.ProcessStat = Symbol.set('IDLE', 'INIT', 'READY', 'DEAD');
global.processStat = global.ProcessStat.IDLE;

const createServer = (config, options) => {
	global.processStat = global.ProcessStat.INIT;

	var hooks = {
		start: [],
		ready: []
	};

	// 配置命令行工具
	const clp = CLP({
		mode: 'process',
		title: config.name + " v" + config.version,
	}).describe(setStyle(config.name + " v" + config.version, "bold"))
	.addOption('--config -c <config> >> 指定配置文件')
	.addOption('--process [process=auto] >> 指定进程数')
	.addOption('--console [console] >> 启用控制台')
	.addOption('--logLevel [logLevel=0] >> 日志输出等级')
	.addOption('--logFile <logFile> >> 日志输出目录')
	.addOption('--silence >> 不显示控制台日志');

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
		if (String.is(param.pipe)) cfg.port.pipe = param.pipe;
		if (Number.is(param.udp4)) cfg.port.udp4 = param.udp4;
		if (Number.is(param.udp6)) cfg.port.udp6 = param.udp6;
		if (Number.is(param.process) || param.process === 'auto') cfg.process = param.process;
		if (Number.is(param.concurrence)) cfg.concurrence = param.concurrence;
		if (Boolean.is(param.console) || String.is(param.console)) cfg.console = param.console;
		cfg.log = cfg.log || {};
		if (Number.is(param.logLevel)) cfg.log.level = param.logLevel;
		else cfg.log.level = 0;
		if (String.is(param.logFile)) cfg.log.output = param.logFile;
		if (Boolean.is(param.silence)) cfg.log.silence = param.silence;
		else if (!Boolean.is(cfg.log.silence)) cfg.log.silence = false;

		if (hooks.start.length > 0) hooks.start.forEach(cb => cb(param));
		delete hooks.start;

		// 设置日志相关
		var Logger = _("Utils.Logger");
		var logger = new Logger('Entrance');
		Logger.LogLimit = cfg.log.level;
		Logger.Silence = cfg.log.silence;

		// Load Responsors
		if (!cfg.api) {
			global.processStat = global.ProcessStat.DEAD;
			let err = new Errors.ConfigError.NoResponsor();
			logger.error(err.message);
			logger.error(config.welcome.failed);
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
				global.processStat = global.ProcessStat.DEAD;
				logger.error(config.welcome.failed);
				process.exit();
				return;
			}
			Logger.setOutput(cfg.log.output);
			ResponsorManager.setConfig(cfg, async () => {
				if (!isMultiProcess && !isDelegator) {
					// 如果在多线程模式，则数据库由各子进程来控制，主进程不用自己控制
					await Promise.all([
						_("Utils.Redis.create")(cfg.redis),
						_("Utils.MySQL.create")(cfg.mysql)
					]);
				}

				var list = hooks.ready.copy();
				delete hooks.ready;
				await Promise.all(list.map(async cb => await cb(param, cfg)));

				global.processStat = global.ProcessStat.READY;
				logger.log(config.welcome.success);
			});
		};

		// 启动 Web 服务器
		count ++;
		tasks.web = false;
		webServer(cfg, (error) => {
			if (error instanceof Error) {
				logger.error('Launch Web-Server Failed.');
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
				logger.error('Launch Socket-Server Failed.');
				cb('socket', false);
			}
			else {
				cb('socket', true);
			}
		});

		if (!!cfg.console) {
			count ++;
			tasks.console = false;
			let ipc = cfg.console;
			if (!String.is(ipc)) ipc = DefailtIPC;
			consoleServer.create(clp, ipc, err => {
				if (err instanceof Error) {
					logger.error(err.message);
					cb('console', false);
				}
				else {
					cb('console', true);
				}
			});
		}
	});

	clp.onStart = cb => hooks.start.push(cb);
	clp.onReady = cb => hooks.ready.push(cb);

	return clp;
};
const createConsole = (config) => {
	global.processStat = global.ProcessStat.INIT;

	const clp = CLP({
		mode: 'process',
		title: config.name + " v" + config.version,
	}).describe(setStyle(config.name + " v" + config.version, "bold"))
	.addOption('--ipc <ipc> >> 指定通讯通道')
	.add('stat >> 查看状态')
	.setParam('[item] >> 查看项')
	.addOption('--list -l >> 查看可用参数')
	.add('local >> 本地操作')
	.setParam('[...command] >> 操作项')
	.addOption('--list -l >> 查看可用参数')
	.add('network >> Galanet 集群操作')
	.addOption('--add <node> >> 添加集群友机节点')
	.addOption('--remove <node> >> 移除集群友机节点')
	.add('shutdown >> 关闭节点')
	.addOption('--all >> 通知集群节点关闭')
	.on('command', (param, command) => {
		if (String.is(param.ipc)) config.ipc = param.ipc;
		clp.socketPipe = config.ipc;
		global.processStat = global.ProcessStat.READY;
		consoleServer.deal(param, config);
	});

	clp.sendRequest = request => consoleServer.sendRequest(clp.socketPipe, request);

	return clp;
};

// 输出
module.exports = {
	server: createServer,
	console: createConsole
};