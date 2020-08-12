const Responsor = require('./responser');
const Galanet = require('./galanet');

process.on('command::request::shakehand', remoteIP => {
	Galanet.reshakehand(remoteIP);
});

// 各进程负载情况
process.on('console::stat::usage', (unuse, event, callback) => {
	callback(Responsor.getUsage());
});
// 各节点负载情况
process.on('console::stat::cluster', (unuse, event, callback) => {
	callback(Galanet.getUsage());
});