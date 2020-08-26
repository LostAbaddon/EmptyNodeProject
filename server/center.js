const Responsor = require('./responser');
const Galanet = require('./galanet');
const Logger = new (_("Utils.Logger"))('EventCenter');

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
// 重启本地子进程
process.on('console::local::refresh', async (unuse, event, callback) => {
	var time = Date.now();
	await Responsor.refresh();
	time = Date.now() - time;
	callback(Responsor.processCount + ' 个工作进程已被更新，用时 ' + time + ' ms');
});
// 设置并发数
process.on('console::local::set::concurrence', async (data, event, callback) => {
	var ok = Responsor.setConcurrence(data);
	callback('设置并发数' + (ok ? '成功' : '失败'));
});
// 增加节点
process.on('console::network::addNode', async (node, event, callback) => {
	callback(...(await Galanet.addNode(node)));
});
// 移除节点
process.on('console::network::removeNode', (node, event, callback) => {
	callback(...Galanet.removeNode(node));
});
// 关闭系统
process.on('console::shutdown', async (isAll, event, callback) => {
	var msg = '';
	if (isAll) {
		let count = await Galanet.shutdownAll();
		msg = '已通知 ' + count + ' 个集群友机离线';
		Logger.log(msg);
		msg = '已离线，并' + msg;
	}
	else {
		msg = '已离线';
	}
	setTimeout(() => {
		if (isSlaver) {
			process.send({ event: 'extinct' });
		}
		else {
			Responsor.extinct();
		}
	}, 100);
	callback(msg);
});