const { Worker } = require('worker_threads');
const newLongID = _('Message.newLongID');
const Logger = new (_("Utils.Logger"))('ThreadManager');

const TxWPool = new Map();
const TxPool = new Map();
const TxPending = [];
var MaxWorkerLimit = require('os').cpus().length;

const setConcurrence = con => {
	MaxWorkerLimit = con;
};
const newWorker = filepath => {
	var worker = new Worker('../kernel/thread/tx_thread_pool.js', {
		workerData: {
			isSlaver: global.isSlaver,
			isMultiProcess: global.isMultiProcess,
			jsPath: filepath
		}
	})
	.on('message', async msg => {
		worker.working = false;
		var res = TxPool.get(msg.id);
		if (!res) return;
		TxPool.delete(msg.id);
		res(msg.result);

		var task = TxPending.shift();
		if (!task) return;
		var result = await runInTxThread(...task.task);
		task.res(result);
	});
	worker.working = false;
	return worker;
};
const setupTxPool = (url, filepath) => {
	var workerList = TxWPool.get(url);
	if (!!workerList) {
		workerList.forEach(worker => worker.terminate());
	}

	workerList = [];
	for (let i = 0; i < MaxWorkerLimit; i ++) {
		workerList.push(newWorker(filepath));
	}

	TxWPool.set(url, workerList);
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
const runInTxThread = (responsor, param, query, url, data, method, source, ip, port) => new Promise(res => {
	var workerList = TxWPool.get(responsor._url);
	if (!workerList) {
		let err = new Errors.RuntimeError.NoRegisteredThread('请求业务: ' + url + ' (' + responsor._url + ')');
		return res({
			ok: false,
			code: err.code,
			message: err.message
		});
	}

	var worker = null;
	workerList.some(w => {
		if (w.working) return;
		worker = w;
		return true;
	});

	if (!worker) {
		Logger.log('TTP任务入池: ' + url + ' (' + responsor._url + '); TID: ' + tid);
		TxPending.push({
			task: [responsor, param, query, url, data, method, source, ip, port],
			res
		});
		return;
	}

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
	worker.working = true;
	worker.postMessage({id: tid, task: [param, query, url, target, method, source, ip, port]});
});

module.exports = {
	setupTxPool,
	setConcurrence,
	runInThread,
	runInTxThread
};