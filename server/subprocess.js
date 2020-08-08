const Path = require('path');

require("../core");
loadall(__dirname, "../kernel");
const ResponsorManager = require('./responser');
const newLongID = _('Message.newLongID');

const Config = {};

const setConfig = async cfg => {
	if (!!cfg.api?.local) {
		Config.path = cfg.api.local;
		await ResponsorManager.load(Path.join(process.cwd(), Config.path));
	}
	process.send({ event: 'ready' });
};
const doTask = async (tid, target, data) => {
	var resp = ResponsorMap[target];
	var result = await resp.responsor(data.param, data.query, data.url, data.data, data.method, data.source, data.ip, data.port);
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
	else {
		console.log('SubProcess(' + process.pid + ')::Message', msg);
	}
});

process.send({ event: 'online' });