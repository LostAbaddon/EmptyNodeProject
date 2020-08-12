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
// 增加节点
process.on('console::network::addNode', async (node, event, callback) => {
	callback(...(await Galanet.addNode(node)));
});
// 移除节点
process.on('console::network::removeNode', (node, event, callback) => {
	callback(...Galanet.removeNode(node));
});
