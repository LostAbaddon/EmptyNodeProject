const Path = require('path');
const { Worker } = require('worker_threads');
const newLongID = _('Message.newLongID');
const Logger = new (_("Utils.Logger"))('ThreadManager');

const TxWPool = new Map();
const TxPool = new Map();
const TxPending = new Map();
var MaxWorkerLimit = require('os').cpus().length;
var TimeoutLimit = 30 * 1000;

const setConcurrence = con => {
	MaxWorkerLimit = con;
};
const setTimeoutValue = to => {
	TimeoutLimit = to;
};
const newWorker = (url, filepath) => {
	var timer = null;
	var tasks = [];
	var worker = new Worker(Path.join(__dirname, '../kernel/thread/tx_thread_pool.js'), {
		workerData: {
			isSlaver: global.isSlaver,
			isMultiProcess: global.isMultiProcess,
			jsPath: filepath
		}
	})
	.on('message', msg => {
		if (msg.event === 'log') {
			Logger.appendRecord(msg.data);
			return;
		}

		var res = TxPool.get(msg.id);
		if (!res) return;
		if (!!timer) clearTimeout(timer);
		tasks.remove(msg.id);
		TxPool.delete(msg.id);
		res(msg.result);

		if (worker.alive) {
			let workerList = TxWPool.get(url);
			workerList.working.remove(worker);
			if (!workerList.waiting.includes(worker)) workerList.waiting.push(worker);

			let taskList = TxPending.get(url);
			if (!taskList || taskList.length === 0) return;
			continueJob(taskList.shift());
		}
		else {
			worker.terminate();
		}
	});
	worker.alive = true;
	worker.launch = task => new Promise(res => {
		tasks.push(task.id);
		if (!!timer) clearTimeout(timer);
		timer = setTimeout(() => {
			Logger.log('事务处理线程响应超时: ' + task.id);
			TxWPool.get(url).working.remove(worker);
			TxWPool.get(url).waiting.remove(worker);
			timer = null;
			worker.alive = false;
			worker.terminate();
			var result = new Errors.RuntimeError.RequestTimeout();
			result = {
				ok: false,
				code: result.code,
				message: result.message
			};
			tasks.forEach(t => {
				var res = TxPool.get(t);
				if (!res) return;
				TxPool.delete(t);
				res(result);
			});
			newWorker(url, filepath);
		}, TimeoutLimit);
		worker.postMessage(task);
	});

	TxWPool.get(url).waiting.push(worker);

	var taskList = TxPending.get(url);
	if (!!taskList) {
		let task = taskList.shift();
		if (!!task) continueJob(task);
	}

	return worker;
};
const setupTxPool = (url, filepath) => {
	var workerList = TxWPool.get(url);
	if (!!workerList) {
		workerList.waiting.forEach(w => w.terminate());
		workerList.working.forEach(w => w.alive = false);
		workerList.waiting.clear();
		workerList.working.clear();
	}

	workerList = { waiting: [], working: [] };
	TxWPool.set(url, workerList);
	for (let i = 0; i < MaxWorkerLimit; i ++) newWorker(url, filepath);
};
const continueJob = async task => {
	var result = await runInTxThread(...task.task, true);
	task.res(result);
};

const runInThread = (responsor, param, query, url, data, method, source, ip, port) => new Promise(res => {
	Logger.log('开始执行OTE任务: ' + url + ' (' + responsor._url + ')');
	var targetJS = "const { Worker, workerData, parentPort } = require('worker_threads');";
	targetJS += 'var _fun_ =' + responsor.toString();
	targetJS += ';(async () => {var result = await _fun_(...workerData);parentPort.postMessage(result);})();';
	var target = {};
	data = data || {};
	if (Object.isBasicType(data)) {
		target = data;
	}
	else {
		for (let key in data) {
			let value = data[key];
			if (Object.isBasicType(value)) target[key] = value;
		}
	}
	try {
		var w = new Worker(targetJS, {
			eval: true,
			workerData: [param, query, url, target, method, source, ip, port]
		})
		.on('message', msg => {
			res(msg);
		})
		.on('error', err => {
			Logger.error('一次性线程执行出错: ' + err.message);
			res({
				ok: false,
				code: err.code,
				message: err.message
			});
		})
		.on('exit', () => {
			w.terminate();
			w = null;
		});
	}
	catch (err) {
		res({
			ok: false,
			code: err.code,
			message: err.message
		});
	}
});
const runInTxThread = (responsor, param, query, url, data, method, source, ip, port, inside=false) => new Promise(res => {
	var workerList = TxWPool.get(responsor._url);
	if (!workerList) {
		let err = new Errors.RuntimeError.NoRegisteredThread('请求业务: ' + url + ' (' + responsor._url + ')');
		return res({
			ok: false,
			code: err.code,
			message: err.message
		});
	}

	if (workerList.waiting.length === 0) {
		Logger.log('TTP任务入池: ' + url + ' (' + responsor._url + ')');
		let pending = TxPending.get(responsor._url);
		if (!pending) {
			pending = [];
			TxPending.set(responsor._url, pending);
		}
		let task = {
			task: [responsor, param, query, url, data, method, source, ip, port],
			res
		};
		if (inside) pending.unshift(task);
		else pending.push(task);
		return;
	}

	var worker = workerList.waiting.shift();
	workerList.working.push(worker);

	var tid = newLongID(16);
	Logger.log('开始执行TTP任务: ' + url + ' (' + responsor._url + '); TID: ' + tid);
	var target = {};
	data = data || {};
	TxPool.set(tid, res);
	if (Object.isBasicType(data)) {
		target = data;
	}
	else {
		for (let key in data) {
			let value = data[key];
			if (Object.isBasicType(value)) target[key] = value;
		}
	}
	worker.launch({id: tid, task: [param, query, url, target, method, source, ip, port]});
});

module.exports = {
	setConcurrence,
	setTimeout: setTimeoutValue,
	setupTxPool,
	runInThread,
	runInTxThread
};