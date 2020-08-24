const Logger = new (_("Utils.Logger"))('CacheDB');

/** 简单缓存表
 *  通过设置的索引键对内容进行缓存。
 *  longExpire 是影响过期时长，shortExpire 是软过期时长。
 *  前者是 Redis 强制过期，后者是每次访问时检验是否过期
 *  同时，修改数据表也会导致缓存更新。
 *  短时限超过后可以有一次读取，但读取的同时缓存会被删除；长时限是Redis自动删除。每次写入都会自动更新短时限。
 */
class CachedTable {
	#mysql = null;
	#redis = null;
	#table = "";
	#range = [];
	#names = {};
	#longExp = 0;
	#shortExp = 0;
	#saltExp = 0;
	constructor (mysql, redis, table, indexes, longExpire, shortExpire, saltRange=0) {
		this.#mysql = mysql;
		this.#redis = redis;
		this.#table = table;
		this.#longExp = longExpire;
		this.#shortExp = shortExpire * 1000;
		this.#saltExp = saltRange;
		if (!indexes || !(indexes.length > 0)) indexes = ['id'];
		this.#range = indexes.map(n => {
			this.#names[n] = 'sct::' + table + '::' + n + '::';
			return n;
		});
	}
	suicide () {
		this.#mysql = undefined;
		this.#redis = undefined;
		this.#table = undefined;
		this.#range = undefined;
		this.#names = undefined;
		this.#longExp = undefined;
		this.#shortExp = undefined;
		this.#saltExp = undefined;
	}
	get indexList () {
		return this.#range.copy();
	}
	#getCacheName (key, value='') {
		return (this.#names[key] || 'sct::' + this.#table + '::' + key + '::') + value;
	}
	async #get (id) {
		var data = await this.#redis.hgetall(id);
		if (!data) return null;
		var timestamp = data.__timestamp__ || 0;
		timestamp = timestamp * 1;
		if (isNaN(timestamp)) timestamp = 0;
		if (Date.now() > timestamp) {
			try {
				this.#redis.del(id);
			}
			catch (err) {
				Logger.error('SCT 删除 ' + id + ' 失败： ' + err.message);
			}
		}
		delete data.__timestamp__;
		return data;
	}
	async #set (id, data) {
		var args = [id];
		args.push("__timestamp__");
		args.push(Date.now() + this.#shortExp + Math.random() * this.#saltExp);
		for (let key in data) {
			args.push(key);
			args.push(JSON.stringify(data[key]));
		}
		await this.#redis.hmset(...args);
		await this.#redis.expire(id, this.#longExp + Math.random() * this.#saltExp);
	}
	async get (key, value, callback) {
		// 规则
		// 先读取Redis，如果有则返回，同时检查是否短超时，如果超了则删除缓存
		// 如果没有缓存则读取MySQL，如果有则更新Redis中各键值缓存，同时返回

		if (Function.is(value)) {
			callback = value;
			value = key;
			key = 'id';
		}

		var result = null;
		var shouldCache = this.#range.includes(key);
		// 读取Redis中缓存
		if (shouldCache) {
			let id = this.#getCacheName(key, value);
			try {
				result = await this.#get(id);
				if (!!result) {
					if (!!callback) callback(result);
					return result;
				}
			}
			catch (err) {
				Logger.error('SCT 读取对象 ' + id + ' 失败： ' + err.message);
				result = null;
			}
		}
		// 从数据库读取
		try {
			result = await this.#mysql.query("select * from " + this.#table + " where " + key + '="' + value + '"');
			if (!!result) result = result[0];
		}
		catch {
			result = null;
		}
		// 更新Redis中缓存
		if (shouldCache && !!result) {
			// 更新同一条记录在各KEY值上的缓存
			this.#range.forEach(k => {
				var kvl = result[k];
				if (!kvl) return;
				var kid = this.#getCacheName(k, kvl);
				try {
					this.#set(kid, result);
				}
				catch (err) {
					Logger.error('SCT 设置对象 ' + kid + ' 失败： ' + err.message);
				}
			});
		}

		if (!!callback) callback(result);
		return result;
	}
	async set (key, value, newValue, callback) {
	}
	async del (key, value, callback) {
	}
	async put (newValue, callback) {
	}
	async expire (key, value) {
		if (value === undefined) {
			value = key;
			key = 'id';
		}
		var shouldCache = this.#range.includes(key);
		if (!shouldCache) return false;
		var id = this.#getCacheName(key, value);
		try {
			let num = await this.#redis.del(id);
			return num > 0;
		}
		catch (err) {
			Logger.error('SCT 删除 ' + id + ' 失败： ' + err.message);
			return false;
		}
	}
}

_("Utils.CachedDB.table", CachedTable);
module.exports = {
	CachedTable
};