const Redis = require('redis');
const newLongID = _('Message.newLongID');
const Logger = new (_("Utils.Logger"))('Redis');
const AsyncFunctions = [
	'set', 'setnx', 'setex', 'psetex', 'get', 'mset', 'msetnx', 'mget', 'append', 'incr', 'incrby', 'decr', 'decrby', 'del', 'strlen',
	'hset', 'hsetnx', 'hget', 'hexists', 'hdel', 'hlen', 'hstrlen', 'hincrby', 'hmset', 'hmget', 'hkeys', 'hgetall',
	'expire', 'expireat', 'pexpire', 'pexpireat'
];

const Servers = new Map();

const prepareRedis = redis => {
	AsyncFunctions.forEach(fun => {
		var FUN = fun.toUpperCase();
		redis[fun] = (...args) => new Promise((res, rej) => {
			var cb = args.last, callback;
			if (Function.is(cb)) {
				args.pop();
				callback = (err, ...args) => {
					cb(err, ...args);
					if (!!err) return rej(err);
					if (args.length <= 1) return res(args[0]);
					res(args);
				};
			}
			else {
				callback = (err, ...args) => {
					if (!!err) return rej(err);
					if (args.length <= 1) return res(args[0]);
					res(args);
				};
			}
			args.push(callback);
			redis[FUN](...args);
		});
	});
};
const newRedis = cfg => new Promise((res) => {
	cfg.id = cfg.id || newLongID();
	var id = cfg.id;
	var redis = Servers.get(cfg.id);
	while (!!redis) {
		cfg.id = id + '-' + newLongID();
		redis = Servers.get(cfg.id);
	}
	id = cfg.id;
	redis = Redis.createClient(cfg);
	redis.on("error", err => {
		Logger.error("Redis(" + id + ") Error(" + err.code + "): " + err.message);
		res(null);
	});
	redis.on("connect", async () => {
		prepareRedis(redis);
		Servers.set(id, redis);
		res(redis);
	});
	redis.on("end", err => {
		Servers.delete(id);
	});
});
const getRedis = id => Servers.get(id);
const allRedis = () => [...Servers.keys()];

_("Utils.Redis.create", newRedis);
_("Utils.Redis.get", getRedis);
_("Utils.Redis.all", allRedis);
module.exports = {
	create: newRedis,
	get: getRedis,
	all: allRedis
};