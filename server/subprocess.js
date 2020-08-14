const Path = require('path');

require("../core");
loadall(__dirname, "../kernel");
const ResponsorManager = require('./responser');
const newLongID = _('Message.newLongID');
const Galanet = require('./galanet');

global.isSlaver = true;
const Config = { path: '' };

const setConfig = async cfg => {
	if (!!cfg.api?.local) {
		Config.path = cfg.api.local;
		await ResponsorManager.load(Path.join(process.cwd(), Config.path));
	}
	Galanet.setConfig(cfg);
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
		setConfig(msg.data);
	}
	else if (msg.event === 'task') {
		doTask(msg.id, msg.responsor, msg.data);
	}
	else if (msg.event === 'suicide') {
		process.exit();
	}
	else {
		console.log('SubProcess(' + process.pid + ')::Message', msg);
	}
});

process.send({ event: 'online' });