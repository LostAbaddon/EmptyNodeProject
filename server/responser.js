const Path = require('path');
const Process = require('child_process');
const Galanet = require('./galanet');
const Watcher = require('../kernel/watcher');
const newLongID = _('Message.newLongID');
const ModuleManager = _('Utils.ModuleManager');
const Logger = new (_("Utils.Logger"))('Responsor');
const SubProcessState = Symbol.setSymbols('IDLE', 'WAITING', 'WORKING', 'DYING', 'DIED');
const HotfixModuleExtName = [ 'js', 'mjs', 'cjs', 'json' ];
const NonAPIModulePrefix = '_';

global.isDelegator = false;
global.isMultiProcess = false;
global.isSlaver = false;
global.ResponsorMap = {};
global.ResponsorList = [];

const Config = {
	process: 1,
	services: [],
	preprocessor: [],
	postprocessor: [],
	options: null
};
const TaskInfo = {
	total: 0,
	done: 0,
	spent: 0,
	energy: 0,
	power: 0
};
const Slavers = [];
const PendingTasks = [];

var MainProcessState = SubProcessState.WORKING;

HotfixModuleExtName.forEach((ext, i) => HotfixModuleExtName[i] = '.' + HotfixModuleExtName[i]);

const forkChildren = (cfg, callback) => {
	var worker = Process.fork(Path.join(__dirname, './subprocess.js'));
	worker.state = SubProcessState.IDLE;
	worker.taskQueue = {};
	worker.taskCount = 0;
	worker.taskDone = 0;
	worker.taskTimespent = 0;
	worker.taskEnergy = 1;
	worker.taskPower = 0;
	worker.dyingMessagers = [];
	worker.launchTask = task => {
		worker.state = SubProcessState.WORKING;
		worker.taskQueue[task.tid] = task;
		worker.taskCount ++;
		worker.taskPower = worker.taskEnergy * (1 + worker.taskCount - worker.taskDone);
		worker.send({
			event: 'task',
			id: task.tid,
			responsor: task.responsor,
			data: task.data
		});
	};
	worker.suicide = () => {
		worker.state = SubProcessState.DIED;
		worker.send({ event: 'suicide' });
	};
	worker.dying = () => new Promise(res => {
		if (worker.state === SubProcessState.IDLE || worker.state === SubProcessState.WAITING) {
			worker.state = SubProcessState.DYING;
			worker.dyingMessagers.push(res);
			worker.send({ event: 'suicide' });
		}
		else if (worker.state === SubProcessState.WORKING) {
			worker.state = SubProcessState.DYING;
			worker.dyingMessagers.push(res);
		}
		else {
			res();
		}
	});

	worker.on('message', msg => {
		if (msg.event === 'online') {
			worker.send({
				event: 'initial',
				data: cfg
			});
		}
		else if (msg.event === 'ready') {
			worker.state = SubProcessState.WAITING;
			if (PendingTasks.length > 0) {
				let task = PendingTasks.shift();
				worker.launchTask(task);
			}
			Logger.log('Slaver Ready: ' + worker.pid);
			callback();
		}
		else if (msg.event === 'jobdone') {
			if (worker.state === SubProcessState.DIED) return;
			let info = worker.taskQueue[msg.id];
			if (!info) return;
			let used = now() - info.stamp;
			worker.taskDone ++;
			worker.taskTimespent += used;
			let average = worker.taskTimespent / worker.taskDone;
			worker.taskEnergy = (average * 2 + used) / 3;
			worker.taskPower = worker.taskEnergy * (1 + worker.taskCount - worker.taskDone);
			delete worker.taskQueue[msg.id];

			if (worker.state !== SubProcessState.DYING) {
				worker.state = SubProcessState.WAITING;
			}
			Logger.log('Slaver-' + worker.pid + ' Job DONE! (' + worker.taskPower + ' | ' + worker.taskCount + ' / ' + worker.taskDone + ' / ' + worker.taskTimespent + ')');
			if (PendingTasks.length > 0) {
				let task = PendingTasks.shift();
				worker.launchTask(task);
			}
			info.callback(msg.result);
			if (worker.state === SubProcessState.DYING) {
				worker.send({ event: 'suicide' });
			}
		}
		else if (msg.event === 'command') {
			process.emit(msg.action, msg.data);
		}
		else if (msg.event === 'log') {
			Logger.appendRecord(msg.data);
		}
		else if (msg.event === 'extinct') {
			extinctSlavers();
		}
		else {
			Logger.log('MainProcess::Message', msg);
		}
	});
	worker.on('exit', code => {
		Logger.log('Slaver Died: ' + worker.pid);
		Slavers.remove(worker);

		var dying = worker.state === SubProcessState.DYING;
		var died = worker.state === SubProcessState.DIED;
		worker.state = SubProcessState.DIED;
		var err = new Errors.RuntimeError.SubProcessBrokenDown();
		for (let task in worker.taskQueue) {
			task = worker.taskQueue[task];
			if (!task) continue;
			task.callback({
				ok: false,
				code: err.code,
				message: err.message
			});
		}
		delete worker.taskQueue;
		delete worker.taskCount;
		delete worker.taskDone;
		delete worker.taskTimespent;
		delete worker.taskPower;

		if (dying) {
			worker.dyingMessagers.forEach(res => res());
			delete worker.dyingMessagers;
		}
		else {
			if (!died) {
				forkChildren();
			}
			else if (MainProcessState === SubProcessState.DIED && Slavers.length === 0) {
				destroyMonde();
			}
		}
	});

	Slavers.push(worker);
};
const launchWorkers = (cfg, callback) => new Promise(res => {
	var total = Config.process, count = Config.process, init = false;
	if (total < 1) {
		if (!!callback) callback();
		res();
		return;
	}
	for (let i = 0; i < total; i ++) {
		forkChildren(cfg, () => {
			if (init) return;
			count --;
			if (count > 0) return;
			init = true;
			if (!!callback) callback();
			res();
		});
	}
});
const restartWorkers = async () => {
	if (!isMultiProcess) return;
	processStat = ProcessStat.INIT;
	var workers = Slavers.map(w => w);
	Slavers.splice(0, Slavers.length);
	workers = workers.map(worker => worker.dying());
	workers.push(launchWorkers(Config.options));
	await Promise.all(workers);
	processStat = ProcessStat.READY;
};
const loadProcessor = (list, modules) => {
	modules.forEach(filepath => {
		filepath = Path.join(process.cwd(), filepath);
		var processor;
		try {
			processor = require(filepath);
		} catch {
			Logger.error('模块 ' + filepath + ' 加载失败');
		}
		if (!!processor && Function.is(processor)) list.push(processor);
		Watcher.watchFile(filepath, () => {
			list.remove(processor);
			try {
				ModuleManager.dump(filepath);
				processor = require(filepath);
			} catch {}
			if (!!processor && Function.is(processor)) list.push(processor);
		});
	});
};

const setConfig = (cfg, callback) => {
	if (Boolean.is(cfg.isDelegator)) isDelegator = cfg.isDelegator;

	if (Array.is(cfg.api.services)) Config.services.push(...cfg.api.services);
	else if (String.is(cfg.api.services)) Config.services.push(cfg.api.services);
	Config.options = cfg;

	loadPrePostWidget(cfg);

	if (isDelegator) {
		Config.process = 1;
		launchWorkers(cfg, () => {
			Galanet.shakehand();
		});
	}
	else if (cfg.process === 'auto') {
		Config.process = require('os').cpus().length;
	}
	else if (Number.is(cfg.process)) {
		Config.process = Math.floor(cfg.process);
		if (Config.process < 0) Config.process = 0;
	}

	if (Config.process > 0 && !isDelegator) {
		isMultiProcess = true;
		launchWorkers(cfg, () => {
			Galanet.shakehand();
		});
	}
	else {
		setTimeout(() => Galanet.shakehand(), 0);
	}

	Galanet.setConfig(cfg, callback);
};
const loadPrePostWidget = cfg => {
	if (!!cfg.api?.preprocessor) {
		loadProcessor(Config.preprocessor, cfg.api.preprocessor);
	}
	if (!!cfg.api?.postprocessor) {
		loadProcessor(Config.postprocessor, cfg.api.postprocessor);
	}
};
const loadResponseFile = (path, filepath) => {
	var low = filepath.toLowerCase();
	if (!HotfixModuleExtName.some(ext => low.substring(low.length - ext.length, low.length) === ext)) return;

	var url = filepath.replace(path, '');
	var parts = url.split(/[\/\\]+/).filter(f => f.length > 0);
	var last = parts.last;
	if (!!last.match(/\.js$/i)) {
		last = last.substr(0, last.length - 3);
		if (last === 'index') {
			parts.splice(parts.length - 1, 1);
		}
		else {
			parts[parts.length - 1] = last;
		}
	}
	url = '/' + parts.join('/');
	parts = parts.map(part => {
		if (!!part.match(/^\[.*\]$/)) {
			return {
				name: part.replace(/^\[+|\]+$/g, ''),
				dynamic: true
			};
		}
		else {
			return {
				name: part,
				dynamic: false
			};
		}
	});

	var res = require(filepath);
	if (!res || !res.responsor || (filepath.indexOf(NonAPIModulePrefix) === 0)) return;

	if (!res.methods) {
		res.methods = null;
	}
	else if (String.is(res.methods)) {
		if (res.methods === '' || res.methods === 'all') res.methods = null;
		else res.methods = [res.methods];
	}
	else if (!Array.is(res.methods)) res.methods = null;

	if (!res.sources) {
		res.sources = null;
	}
	else if (String.is(res.sources)) {
		if (res.sources === '' || res.sources === 'all') res.sources = null;
		else res.sources = [res.sources];
	}
	else if (!Array.is(res.sources)) res.sources = null;

	res._queryList = parts;
	res.responsor._url = url;

	ResponsorMap[url] = res;
	ResponsorList.push(res);
};
const unloadResponseFile = (path, filepath) => {
	ModuleManager.dump(filepath); // 从require的内部库中移除JS模块

	var url = filepath.replace(path, '');
	var parts = url.split(/[\/\\]+/).filter(f => f.length > 0);
	var last = parts.last;
	if (!!last.match(/\.js$/i)) {
		last = last.substr(0, last.length - 3);
		if (last === 'index') {
			parts.splice(parts.length - 1, 1);
		}
		else {
			parts[parts.length - 1] = last;
		}
	}
	url = '/' + parts.join('/');

	var res = ResponsorMap[url];
	ResponsorList.remove(res);
	delete ResponsorMap[url];
};
const loadResponsors = async (path, monitor=true) => {
	path = path.replace(/[\/\\]+$/, '') + Path.sep;

	var list;
	// 监视目标路径的更新情况
	if (monitor) {
		list = await Watcher.add(path, (event, filepath) => {
			if (event === Watcher.EventType.NewFile) {
				Logger.log('新增API模块：' + filepath);
				loadResponseFile(path, filepath);
			}
			else if (event === Watcher.EventType.ModifyFile) {
				Logger.log('更新API模块：' + filepath);
				unloadResponseFile(path, filepath);
				loadResponseFile(path, filepath);
			}
			else if (event === Watcher.EventType.DeleteFile) {
				Logger.log('移除API模块：' + filepath);
				unloadResponseFile(path, filepath);
			}
		});
	}
	else {
		list = await _('Utils.getAllContents')(path);
	}

	list.forEach(filepath => loadResponseFile(path, filepath));
};
const matchResponsor = (url, method, source) => {
	var res = ResponsorMap[url], query = {}, didMatch = false;
	if (!!res) {
		if (res.sources === null || (!!res.sources.includes && res.sources.includes(source))) didMatch = true;
		if (didMatch) {
			didMatch = false;
			if (res.methods === null || (!!res.methods.includes && res.methods.includes(method))) didMatch = true;
			if (didMatch) return [res.responsor, query];
		}
	}

	url = url.split('/').filter(u => u.length > 0);
	res = null;
	var len = url.length;
	ResponsorList.some(r => {
		var q = r._queryList, qry = {};
		if (q.length !== len) return;
		for (let i = 0; i < len; i ++) {
			let qi = q[i];
			if (qi.dynamic) {
				qry[qi.name] = url[i];
			}
			else {
				if (url[i] !== qi.name) return;
			}
		}
		res = r.responsor;
		query = qry;
		return true;
	});

	if (isDelegator) {
		res = res || {_url: url};
	}

	return [res, query];
};
const launchResponsor = (responsor, param, query, url, data, method, source, ip, port) => new Promise(async res => {
	if (processStat !== ProcessStat.READY) return;

	var result;
	if (url.substr(0, 1) !== '/') url = '/' + url;
	if (url.indexOf('/galanet/') === 0) {
		if (Galanet.check(ip)) {
			result = await launchLocalResponsor(responsor, param, query, url, data, method, source, ip, port);
		}
		else {
			let err = new Errors.GalanetError.Unauthorized();
			result = {
				ok: false,
				code: err.code,
				message: err.message
			};
		}
	}
	else {
		if (isDelegator) { // 如果本节点是纯代理节点，则转发给集群友机
			result = await Galanet.launch(responsor, param, query, url, data, method, source, ip, port);
		}
		else if (!!param && param.isGalanet) { // 如果声称是集群请求
			if (Galanet.check(ip)) { // 如果是集群中友机的请求，则本地处理
				if (Galanet.checkService(url)) { // 如果是本地注册的请求，则本地处理
					result = await launchLocalResponsor(responsor, param, query, url, data, method, source, ip, port);
				}
				else { // 如果不是本地注册的请求，则不做处理
					let err = new Errors.GalanetError.CannotService(url + '不是可服务请求类型');
					result = {
						ok: false,
						code: err.code,
						message: err.message
					};
				}
			}
			else { // 不是集群中友机请求，则不作处理
				let err = new Errors.GalanetError.NotFriendNode(ip + '不是集群友机');
				result = {
					ok: false,
					code: err.code,
					message: err.message
				};
			}
		}
		else { // 如果没声称是集群请求
			if (!Galanet.isInGroup) {
				result = await launchLocalResponsor(responsor, param, query, url, data, method, source, ip, port);
			}
			else { // 如果在集群中，且不是集群指令，则交给集群中心Galanet处理
				result = await Galanet.launch(responsor, param, query, url, data, method, source, ip, port);
			}
		}
	}
	res(result);
});
const launchLocalResponsor = (responsor, param, query, url, data, method, source, ip, port) => new Promise(async res => {
	if (Config.process < 1) {
		let result;
		TaskInfo.total ++;
		let time = now();
		try {
			let resume = true;
			data = data || {};
			if (Config.preprocessor.length > 0) {
				for (let pro of Config.preprocessor) {
					let r = await pro(param, query, url, data, method, source, ip, port);
					if (!!r && !r.ok) {
						result = r;
						resume = false;
						break;
					}
				}
			}
			if (resume) {
				result = await responsor(param, query, url, data, method, source, ip, port);
				if (Config.postprocessor.length > 0) {
					for (let pro of Config.postprocessor) {
						let r = await pro(result, param, query, url, data, method, source, ip, port);
						if (!!r) break;
					}
				}
			}
		}
		catch (err) {
			Logger.error(err);
			result = {
				ok: false,
				code: err.code || 500,
				message: err.message
			};
		}
		TaskInfo.done ++;
		time = now() - time;
		TaskInfo.spent += time;
		TaskInfo.energy = TaskInfo.spent / TaskInfo.done;
		TaskInfo.power = (TaskInfo.energy * 2 + time) / 3;
		return res(result);
	}

	var task = {
		tid: newLongID(),
		responsor: responsor._url,
		data: { param, query, url, data: {}, method, source, ip, port },
		stamp: now(),
		callback: res
	};

	// 选进程
	var worker = Slavers.filter(slaver => {
		if (slaver.state === SubProcessState.WAITING) return true;
		if (slaver.state === SubProcessState.WORKING) return true;
		return false;
	});
	if (worker.length === 0) {
		return PendingTasks.push(task);
	}
	worker.sort((pa, pb) => pa.taskPower - pb.taskPower);
	worker = worker[0];
	worker.launchTask(task);
});
const extinctSlavers = () => {
	if (isSlaver) return;

	if (MainProcessState !== SubProcessState.DIED) {
		MainProcessState = SubProcessState.DIED;
		if (Config.process <= 1) {
			destroyMonde();
		}
		else {
			Slavers.forEach(worker => worker.suicide());
		}
	}
};
const destroyMonde = () => {
	if (PendingTasks.length > 0) {
		let err = new Errors.RuntimeError.MainProcessExited();
		PendingTasks.forEach(task => {
			task.callback({
				ok: false,
				code: err.code,
				message: err.message
			});
		});
	}
	process.exit();
};
const getUsage = () => {
	var result = {};
	result.isDelegator = global.isDelegator;
	result.isInGroup = Galanet.isInGroup;
	result.processCount = Config.process < 1 ? 1 : Config.process;
	result.pending = PendingTasks.length;
	result.workers = [];
	if (isMultiProcess) {
		Slavers.forEach(worker => {
			var info = {
				alive: !worker.killed,
				total: worker.taskCount,
				done: worker.taskDone,
				spent: worker.taskTimespent,
				energy: worker.taskEnergy,
				power: worker.taskPower
			};
			result.workers.push(info);
		});
	}
	else {
		let info = {
			alive: true,
			total: TaskInfo.total,
			done: TaskInfo.done,
			spent: TaskInfo.spent,
			energy: TaskInfo.energy,
			power: TaskInfo.power
		};
		result.workers.push(info);
	}
	return result;
};

module.exports = {
	setConfig,
	loadProcessor: loadPrePostWidget,
	load: loadResponsors,
	match: matchResponsor,
	launch: launchResponsor,
	launchLocally: launchLocalResponsor,
	extinct: extinctSlavers,
	getUsage,
	refresh: restartWorkers,
	get processCount () {
		return Slavers.length;
	},
	get preprocessor () {
		return Config.preprocessor;
	},
	get postprocessor () {
		return Config.postprocessor;
	}
};