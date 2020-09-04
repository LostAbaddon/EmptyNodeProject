const { Worker } = require('worker_threads');
const Logger = new (_("Utils.Logger"))('ThreadManager');

const runInThread = (responsor, param, query, url, data, method, source, ip, port) => new Promise(res => {
	Logger.log('开始执行一次性线程任务: ' + responsor._url + ' / ' + url);
	var targetJS = "const { Worker, workerData, parentPort } = require('worker_threads');";
	targetJS += 'var _fun_ =' + responsor.toString();
	targetJS += ';(async () => {var result = await _fun_(...workerData);parentPort.postMessage(result);})();';
	var target = {};
	for (let key in data) {
		let value = data[key];
		if (Object.isBasicType(value)) target[key] = value;
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

module.exports = {
	runInThread
};