const Path = require('path');
const Process = require('child_process');
const newLongID = _('Message.newLongID');
const SubProcessState = Symbol.setSymbols('IDLE', 'WAITING', 'WORKING', 'DIED');

global.isMultiNode = false;
global.isMultiProcess = false;
global.isSlaver = false;
global.ResponsorMap = {};
global.ResponsorList = [];

const Config = {
	process: 1
};
const Slavers = [];
const PendingTasks = [];

var MainProcessState = SubProcessState.WORKING;

const forkChildren = cfg => {
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
const launchWorkers = cfg => {
	for (let i = 0; i < Config.process; i ++) forkChildren(cfg);
};

const setConfig = cfg => {
	if (cfg.process === 'auto') {
		Config.process = require('os').cpus().length;
	}
	else if (Number.is(cfg.process)) {
		Config.process = cfg.process;
		if (Config.process < 1) Config.process = 1;
	}

	if (Config.process > 1) {
		isMultiNode = true;
		launchWorkers(cfg);
	}
};
const loadResponsors = async (path) => {
	var list = await _('Utils.getAllContents')(path);
	path = path.replace(/[\/\\]+$/, '') + Path.sep;
	list.forEach(filepath => {
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
	});
};
const matchResponsor = (url, method, source) => {
	var res = ResponsorMap[url], query = {}, didMatch = false;
	if (!!res) {
		if (res.sources === null || (!!res.sources.includes && res.sources.includes(source))) didMatch = true;
		if (didMatch) {
			didMatch = false;
			if (res.methods === null || (!!res.methods.includes && res.methods.includes(method))) didMatch = true;
			if (didMatch) return [res, query];
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
	return [res, query];
};
const launchResponsor = (responsor, param, query, url, data, method, source, ip, port) => new Promise(async res => {
	if (Config.process <= 1) {
		let result;
		try {
			result = await responsor(param, query, url, data, method, source, ip, port);
		}
		catch (err) {
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
		data: { param, query, url, data, method, source, ip, port },
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
	extinct: extinctSlavers
};