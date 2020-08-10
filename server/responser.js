const Path = require('path');
const Process = require('child_process');
const Galanet = require('./galanet');
const Watcher = require('../kernel/watcher');
const setStyle = _('CL.SetStyle');
const newLongID = _('Message.newLongID');
const ModuleManager = _('Utils.ModuleManager');
const SubProcessState = Symbol.setSymbols('IDLE', 'WAITING', 'WORKING', 'DIED');

global.isDelegator = false;
global.isMultiNode = false;
global.isMultiProcess = false;
global.isSlaver = false;
global.ResponsorMap = {};
global.ResponsorList = [];

const Config = {
	process: 1,
	services: []
};
const Slavers = [];
const PendingTasks = [];

var MainProcessState = SubProcessState.WORKING;

const forkChildren = (cfg, callback) => {
	var worker = Process.fork(Path.join(__dirname, './subprocess.js'));
	worker.state = SubProcessState.IDLE;
	worker.taskQueue = {};
	worker.taskCount = 0;
	worker.taskDone = 0;
	worker.taskTimespent = 0;
	worker.taskEnergy = 1;
	worker.taskPower = 0;
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
		worker.send({ event: 'suicide' })
	};

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
			console.log('Slaver Ready: ' + worker.pid);
			callback();
		}
		else if (msg.event === 'jobdone') {
			if (worker.state === SubProcessState.DIED) return;
			let info = worker.taskQueue[msg.id];
			if (!info) return;
			let used = Date.now() - info.stamp;
			worker.taskDone ++;
			worker.taskTimespent += used;
			let average = worker.taskTimespent / worker.taskDone;
			worker.taskEnergy = (average * 2 + used) / 3;
			worker.taskPower = worker.taskEnergy * (1 + worker.taskCount - worker.taskDone);
			delete worker.taskQueue[msg.id];
			worker.state = SubProcessState.WAITING;
			console.log('Slaver-' + worker.pid + ' Job DONE! (' + worker.taskPower + ' | ' + worker.taskCount + ' / ' + worker.taskDone + ' / ' + worker.taskTimespent + ')');
			if (PendingTasks.length > 0) {
				let task = PendingTasks.shift();
				worker.launchTask(task);
			}
			info.callback(msg.result);
		}
		else if (msg.event === 'command') {
			process.emit(msg.action, msg.data);
		}
		else if (msg.event === 'extinct') {
			extinctSlavers();
		}
		else {
			console.log('MainProcess::Message', msg);
		}
	});
	worker.on('exit', code => {
		console.log('Slaver Died: ' + worker.pid);
		Slavers.remove(worker);

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
		if (!died) {
			forkChildren();
		}
		else if (MainProcessState === SubProcessState.DIED && Slavers.length === 0) {
			destroyMonde();
		}
	});

	Slavers.push(worker);
};
const launchWorkers = (cfg, callback) => {
	var total = Config.process, count = Config.process, init = false;
	for (let i = 0; i < total; i ++) {
		forkChildren(cfg, () => {
			if (init) return;
			count --;
			if (count > 0) return;
			init = true;
			callback();
		});
	}
};

const setConfig = cfg => {
	if (Boolean.is(cfg.isDelegator)) isDelegator = cfg.isDelegator;

	if (Array.is(cfg.api.services)) Config.services.push(...cfg.api.services);
	else if (String.is(cfg.api.services)) Config.services.push(cfg.api.services);

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
		Config.process = cfg.process;
		if (Config.process < 1) Config.process = 1;
	}

	if (Config.process > 1) {
		isMultiNode = true;
		launchWorkers(cfg, () => {
			Galanet.shakehand();
		});
	}

	Galanet.setConfig(cfg);
};
const loadResponseFile = (path, filepath) => {
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
	if (!res || !res.responsor) return;

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
				console.log(setStyle('新增API模块：' + filepath, 'green'));
				loadResponseFile(path, filepath);
			}
			else if (event === Watcher.EventType.ModifyFile) {
				console.log(setStyle('更新API模块：' + filepath, 'yellow'));
				unloadResponseFile(path, filepath);
				ModuleManager.dump(filepath);
				loadResponseFile(path, filepath);
			}
			else if (event === Watcher.EventType.DeleteFile) {
				console.log(setStyle('移除API模块：' + filepath, 'pink'));
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
	var result;
	if (isDelegator) { // 如果本节点是纯代理节点，则转发给集群友机
		if (url.indexOf('/galanet/') === 0) {
			result = await launchLocalResponsor(responsor, param, query, url, data, method, source, ip, port);
		}
		else {
			result = await Galanet.launch(responsor, param, query, url, data, method, source, ip, port);
		}
	}
	else if (param.isGalanet) { // 如果声称是集群请求
		if (Galanet.check(ip)) { // 如果是集群中友机的请求，则本地处理
			result = await launchLocalResponsor(responsor, param, query, url, data, method, source, ip, port);
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
		if (!Galanet.isInGroup || url.indexOf('/galanet/') === 0) { // 如果不在集群中，或者是集群指令，则本地处理
			result = await launchLocalResponsor(responsor, param, query, url, data, method, source, ip, port);
		}
		else { // 如果在集群中，且不是集群指令，则交给集群中心Galanet处理
			result = await Galanet.launch(responsor, param, query, url, data, method, source, ip, port);
		}
	}
	res(result);
});
const launchLocalResponsor = (responsor, param, query, url, data, method, source, ip, port) => new Promise(async res => {
	if (Config.process <= 1) {
		let result;
		try {
			result = await responsor(param, query, url, data, method, source, ip, port);
		}
		catch (err) {
			console.error(err);
			result = {
				ok: false,
				code: err.code || 500,
				message: err.message
			};
		}
		return res(result);
	}

	var task = {
		tid: newLongID(),
		responsor: responsor._url,
		data: { param, query, url, data: {}, method, source, ip, port },
		stamp: Date.now(),
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

module.exports = {
	setConfig,
	load: loadResponsors,
	match: matchResponsor,
	launch: launchResponsor,
	launchLocally: launchLocalResponsor,
	extinct: extinctSlavers
};