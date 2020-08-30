global.noEventModules = true;

const Path = require('path');
require("../core");
loadall(__dirname, "../kernel", false);
const ResponsorManager = require('./responser');
const Galanet = require('./galanet');
const Logger = new (_("Utils.Logger"))('SubProcess');

global.isSlaver = true;
const Config = { path: '' };

const setConfig = async cfg => {
	if (!!cfg.api?.local) {
		Config.path = cfg.api.local;
		await ResponsorManager.load(Path.join(process.cwd(), Config.path));
	}
	ResponsorManager.loadProcessor(cfg);
	await Galanet.setConfig(cfg);

	var Core = {
		responsor: ResponsorManager,
		galanet: Galanet
	};
	if (Array.is(cfg.init)) {
		cfg.init.forEach(path => {
			if (!String.is(path)) return;
			if (path.indexOf('.') === 0) path = Path.join(process.cwd(), path);
			let fun = require(path);
			if (Function.is(fun)) fun(Core);
		});
	}
	else if (String.is(cfg.init)) {
		let path = cfg.init;
		if (path.indexOf('.') === 0) path = Path.join(process.cwd(), path);
		let fun = require(path);
		if (Function.is(fun)) fun(Core);
	}

	process.send({ event: 'ready' });
};
const doTask = async (tid, target, data) => {
	var resp = ResponsorMap[target];
	var result;
	try {
		data.data = data.data || {};
		let resume = true;
		if (ResponsorManager.preprocessor.length > 0) {
			for (let pro of ResponsorManager.preprocessor) {
				let r = await pro(data.param, data.query, data.url, data.data, data.method, data.source, data.ip, data.port);
				if (!!r && !r.ok) {
					result = r;
					resume = false;
					break;
				}
			}
		}
		if (resume) {
			result = await resp.responsor(data.param, data.query, data.url, data.data, data.method, data.source, data.ip, data.port);
			if (ResponsorManager.postprocessor.length > 0) {
				for (let pro of ResponsorManager.postprocessor) {
					let r = await pro(result, data.param, data.query, data.url, data.data, data.method, data.source, data.ip, data.port);
					if (!!r) break;
				}
			}
		}
	}
	catch (err) {
		Logger.error(err);
		result = {
			ok: false,
			code: err.code,
			message: err.message
		};
	}
	process.send({
		event: 'jobdone',
		id: tid,
		result
	});
};

process.on('message', msg => {
	if (msg.event === 'initial') {
		global.Personel = msg.personel;
		setConfig(msg.data);
	}
	else if (msg.event === 'task') {
		doTask(msg.id, msg.responsor, msg.data);
	}
	else if (msg.event === 'suicide') {
		process.exit();
	}
	else if (msg.event === 'loadjs') {
		if (!msg.msg) return;

		let filepaths;
		if (Array.is(msg.msg)) {
			filepaths = msg.msg.filter(f => String.is(f));
		}
		else if (String.is(msg.msg)) {
			filepaths = [msg.msg];
		}
		else if (Array.is(msg.msg.path)) {
			filepaths = msg.msg.path.filter(f => String.is(f));
		}
		else if (String.is(msg.msg.path)) {
			filepaths = [msg.msg.path];
		}
		else {
			return;
		}
		filepaths.forEach(filepath => {
			if (filepath.indexOf('.') === 0) filepath = Path.join(process.cwd(), filepath);
			try {
				require(filepath);
			}
			catch (err) {
				Logger.error('载入文件 ' + filepath + ' 失败：' + err.message);
			}
		});
	}
	else {
		// Logger.info('SubProcess(' + process.pid + ')::Message', msg);
	}
});

process.send({ event: 'online' });