const pipeServer = require('../kernel/tcp');
const setStyle = _('CL.SetStyle');
const Logger = new (_("Utils.Logger"))('ConsoleManager');

const ConsoleEventTag = 'console::';
const ConsoleHelp = {
	stat: 'usage\t\t\t查看各子进程负载情况\ncluster\t\t\t查看 Galanet 中友节点'
};

const sockets = [];

// 服务端
const createServer = (host, ipc, callback) => {
	pipeServer.server(ipc, 0, (svr, err) => {
		if (!!err) {
			Logger.error('Create Console-Server Failed.');
			err = new Errors.ServerError.CreateConsoleFailed(err.message);
			callback(err);
		}
		else {
			svr.on('connection', socket => {
				socket.on('close', (...args) => {
					sockets.remove(socket);
				});
				if (!sockets.includes(socket)) sockets.push(socket);
			});
			host.onConsoleEvent = (event, callback) => onMessage(event, callback);
			host.onceConsoleEvent = (event, callback) => onceMessage(event, callback);
			host.offConsoleEvent = (event, callback) => offMessage(event, callback);
			callback();
		}
	}, (msg, socket, resp) => {
		if (!msg || !Array.is(msg) || msg.length === 0) {
			return resp({
				ok: false,
				code: 404,
				message: "无指令"
			});
		}

		var result = {}, count = 0, tasks = {};
		var events = process.eventNames();
		for (let cmd of msg) {
			let eventName = ConsoleEventTag + cmd.event;
			if (!events.includes(eventName)) {
				result[cmd.name] = {
					ok: false,
					code: 404,
					message: '无指令响应模块'
				};
				continue;
			}

			tasks[cmd.name] = false;
			count ++;
			let eventMsg = {
				event: cmd.name,
				pipe: socket,
				cancel: false
			};
			process.emit(ConsoleEventTag + cmd.event, cmd.data, eventMsg, (reply, err) => {
				if (tasks[cmd.name]) return;
				tasks[cmd.name] = true;
				count --;
				if (!!err) {
					result[cmd.name] = {
						ok: false,
						code: err.code,
						message: err.message
					};
				}
				else {
					result[cmd.name] = {
						ok: true,
						data: reply
					};
				}
				if (count === 0) {
					resp(result);
				}
			});
		}
		if (count === 0) {
			resp(result);
		}
	});
};

const onMessage = (event, callback) => {
	process.on(ConsoleEventTag + event, callback);
};
const onceMessage = (event, callback) => {
	process.once(ConsoleEventTag + event, callback);
};
const offMessage = (event, callback) => {
	process.off(ConsoleEventTag + event, callback);
};

const broadcast = msg => {
	sockets.forEach(socket => socket.sendData(msg));
};
const request = (ipc, commands, callback) => new Promise(res => {
	pipeServer.client(ipc, 0, commands, (reply, err) => {
		if (!!callback) callback(reply, err);
		res([reply, err]);
	});
});

// 客户端
const deal = async (param, config) => {
	var cmds = {}, req = [], cmdList = {};
	param.mission.forEach(m => {
		if (m.value?.list) {
			console.log(m.name + ' 可用参数：');
			console.log(ConsoleHelp[m.name] || '(无)');
		}
		else {
			cmds[m.name] = m.value;
		}
	});

	if (!!cmds.stat && !!cmds.stat.item) {
		cmdList.stat = cmds.stat.item;
		req.push({
			name: 'stat',
			target: cmds.stat.item,
			event: 'stat::' + cmds.stat.item,
		});
	}
	if (!!cmds.local && !!cmds.local.command) {
		cmdList.local = cmds.local.command;
		req.push({
			name: 'local',
			target: cmds.local,
			event: 'local::' + cmds.local.command
		});
	}
	if (!!cmds.network) {
		let action = null;
		if (cmds.network.add) action = 'addNode';
		else if (cmds.network.remove) action = 'removeNode';
		if (!!action) {
			cmdList.network = action;
			req.push({
				name: 'network',
				target: action,
				event: 'network::' + action,
				data: cmds.network.node
			});
		}
	}
	if (!!cmds.shutdown) {
		let isAll = !!cmds.shutdown.all;
		cmdList.shutdown = isAll;
		req.push({
			name: 'shutdown',
			target: 'shutdown',
			event: 'shutdown',
			data: isAll
		});
	}

	if (req.length === 0) return;
	var [reply, err] = await request(config.ipc, req);
	if (!!err) {
		console.error(err.message || err);
	}
	else if (!reply) {
		console.error('空回复');
	}
	else {
		for (let item in reply) {
			let msg = reply[item];
			if (item === 'stat') {
				if (cmdList[item] === 'usage') showStatUsage(msg);
				else if (cmdList[item] === 'cluster') showStatNetwork(msg);
			}
			else if (item === 'local') {
				if (msg.ok) {
					console.log(msg.data);
				}
				else {
					console.error(msg.message);
				}
			}
			else if (item === 'network') {
				let order = cmdList[item];
				if (order === 'addNode') {
					if (msg.ok) {
						console.log(msg.data);
					}
					else {
						console.error('添加节点失败（错误号 ' + msg.code + '）: ' + msg.message);
					}
				}
				else if (order === 'removeNode') {
					if (msg.ok) {
						console.log(msg.data);
					}
					else {
						console.error('移除节点失败（错误号 ' + msg.code + '）: ' + msg.message);
					}
				}
				else {
					console.log(cmdList[item] + ':', msg);
				}
			}
			else if (item === 'shutdown') {
				if (msg.ok) {
					console.log(msg.data);
				}
				else {
					console.error('关闭失败（错误号 ' + msg.code + '）：' + msg.message);
				}
			}
			else {
				console.error(item + '/' + cmdList[item] + ': ' + msg.message);
			}
		}
	}
};
const showStatUsage = data => {
	if (data.ok) {
		data = data.data;
		console.log('　　　代理网关：\t' + (data.isDelegator ? '是' : '否'));
		console.log('　　　集群节点：\t' + (data.isInGroup ? '是' : '否'));
		console.log('　　并行进程数：\t' + data.processCount);
		console.log('等待中的任务数：\t' + data.pending);
		data.workers.forEach((worker, i) => {
			let list = [];
			if (worker.alive) {
				list.push(setStyle('进程-' + (i + 1) + ':', 'bold'));
			}
			else {
				list.push(setStyle('进程-' + (i + 1) + '(宕):', 'bold yellow'));
			}
			list.push('　　　任务: ' + worker.done + ' / ' + worker.total);
			list.push('　　总耗时: ' + worker.spent + ' ms\t\t\t\t加权平均耗时: ' + (Math.round(worker.energy * 100) / 100) + ' ms');
			list.push('　负载指数: ' + (Math.round(worker.power * 100) / 100));
			console.log(list.join('\n'));
		});
	}
	else {
		console.error(setStyle(title, 'bold red') + '\n' + setStyle(data.message, 'red') + '\n');
	}
};
const showStatNetwork = data => {
	if (data.ok) {
		data = data.data;
		console.log('等待中的任务数：\t' + data.pending);
		let downed = [], active = [];
		data.nodes.forEach(node => {
			if (node.available) active.push(node);
			else downed.push(node);
		});
		active.forEach(node => {
			let list = [];
			list.push(setStyle('节点 ' + node.name, 'bold'));
			list.push('　连线失败: ' + node.failed);
			list.push('　可用服务: ' + (node.filter.length > 0 ? node.filter.join('; ') : '[ALL]'));
			list.push('　　　任务: ' + node.tasks.done + ' / ' + node.tasks.total);
			list.push('　　总耗时: ' + node.tasks.time + ' ms\t\t\t\t加权平均耗时: ' + (Math.round(node.tasks.energy * 100) / 100) + ' ms');
			list.push('　负载指数: ' + (Math.round(node.tasks.power * 100) / 100));
			console.log(list.join('\n'));
		});
		downed.forEach(node => {
			console.log(setStyle('节点 ' + node.name + ' 已离线', 'bold yellow'));
		});
	}
	else {
		console.error(setStyle(data.message, 'red') + '\n');
	}
};

module.exports = {
	create: createServer,
	on: onMessage,
	once: onceMessage,
	off: offMessage,
	broadcast,
	deal,
	request
};