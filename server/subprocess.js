const Path = require('path');
const Galanet = require('./galanet');

require("../core");
loadall(__dirname, "../kernel");
const ResponsorManager = require('./responser');
const newLongID = _('Message.newLongID');

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
		result = await resp.responsor(data.param, data.query, data.url, data.data, data.method, data.source, data.ip, data.port);
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