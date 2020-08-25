const Logger = new (_("Utils.Logger"))('CacheDB');

/** 简单缓存表
 *  通过设置的索引键对内容进行缓存。
 *  longExpire 是影响过期时长，shortExpire 是软过期时长。
 *  前者是 Redis 强制过期，后者是每次访问时检验是否过期
 *  同时，修改数据表也会导致缓存更新。
 *  短时限超过后可以有一次读取，但读取的同时缓存会被删除；长时限是Redis自动删除。每次写入都会自动更新短时限。
 *  indexes 中的键名必须是唯一性的键名，否则缓存会出现问题
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
		args.push(Date.now() + this.#shortExp + Math.random() * this.#saltExp * 1000);
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

		if (Function.is(value) || (value === undefined && callback === undefined)) {
			callback = value;
			value = key;
			key = 'id';
		}

		var result = null;
		var shouldCache = this.#range.includes(key);
		// 读取Redis中缓存
		if (this.#range.includes(key)) {
			let id = this.#getCacheName(key, value);
			try {
				result = await this.#get(id);
				if (!!result) {
					result = [result];
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
			if (!Array.is(result)) result = [];
		}
		catch {
			result = [];
		}
		// 逐条更新Redis中缓存
		result.forEach(res => {
			// 更新同一条记录在各KEY值上的缓存
			this.#range.forEach(k => {
				var kvl = res[k];
				if (!kvl) return;
				var kid = this.#getCacheName(k, kvl);
				try {
					this.#set(kid, res);
				}
				catch (err) {
					Logger.error('SCT 设置对象 ' + kid + ' 失败： ' + err.message);
				}
			});
		});

		if (!!callback) callback(result);
		return result;
	}
	async all (callback) {
		var table;
		try {
			table = await this.#mysql.query('select * from ' + this.#table);
		}
		catch (err) {
			Logger.error("SCT 获取全部数据失败：" + err.message);
			table = [];
		}
		if (!!callback) callback(table);
		return table;
	}
	async set (key, value, data, callback) {
		// 规则：
		// 先判断指定的key是否是缓存的key，如果是则读取缓存内容
		// 如果没有缓存内容或者不是缓存的key，则从数据库读取数据

		if (Function.is(data) || (data === undefined && callback === undefined)) {
			callback = data;
			data = value;
			value = key;
			key = 'id';
		}

		// 获取Redis中缓存，因为缓存索引用的index要求唯一性，所以即便插数据库也只可能得到一条结果
		var noCache = true, caches;
		if (this.#range.includes(key)) {
			let id = this.#getCacheName(key, value);
			try {
				let cache = this.#redis.hgetall(id);
				if (!!cache && (cache[key] === value)) {
					caches = [cache];
					noCache = false;
				}
				else {
					noCache = true;
				}
			}
			catch {
				noCache = true;
			}
		}

		// 如果没有缓存，则从数据库中读取
		if (noCache) {
			try {
				let items = await this.#mysql.query("select * from " + this.#table + " where " + key + '="' + value + '"');
				if (Array.is(items)) caches = items;
			}
			catch (err) {
				Logger.log('SCT 修改值前读取原有值失败：' + err.message);
				if (!!callback) callback(false);
				return false;
			}
		}

		// 先更新MySQL中记录
		var sql = [];
		for (let key in data) {
			let value = data[key];
			sql.push(key + '=' + JSON.stringify(value)); 
		}
		sql = 'update ' + this.#table + ' set ' + sql.join(', ') + ' where ' + key + '=' + JSON.stringify(value);
		var changed = 0;
		try {
			let res = await this.#mysql.query(sql);
			if (!!res) changed = res.changedRows;
		} catch (err) {
			Logger.error("SCT 修改值失败：" + err.message);
		}

		// 如果没成功修改，则直接退出
		if (changed === 0) {
			if (!!callback) callback(false);
			return false;
		}

		// 如果修改条数和缓存条目数不同，则将缓存全部清除
		if (changed !== caches.length) {
			await Promise.all(caches.map(async cache => {
				await Promise.all(this.#range.map(async key => {
					var id = this.#getCacheName(key, cache[key]);
					await this.#redis.del(id);
				}));
			}));
		}
		// 否则，更新缓存记录
		else {
			await Promise.all(caches.map(async cache => {
				// 找出哪些要被删除，哪些只需要更新
				var dels = [];
				for (let key in data) {
					let oldV = cache[key], newV = data[key];
					if (oldV !== newV) {
						if (oldV !== null && oldV !== undefined) dels.push(this.#getCacheName(key, oldV));
					}
					cache[key] = data[key];
				}
				await Promise.all([...this.#range.map(async key => {
					var id = this.#getCacheName(key, cache[key]);
					await this.#set(id, cache);
				}), ...dels.map(async id => {
					await this.#redis.del(id);
				})])
			}));
		}
		if (!!callback) callback(true);
		return true;
	}
	async add (data, callback) {
		// 由于写入数据可能不全，比如自增id很可能就不包含在其中，所以不做缓存

		var names = [], values = [];
		for (let key in data) {
			let value = data[key];
			names.push(key);
			values.push(JSON.stringify(value));
		}
		sql = 'insert into ' + this.#table + ' (' + names.join(', ') + ') values (' + values.join(', ') + ')';
		var ok = true;
		try {
			await this.#mysql.query(sql);
		} catch (err) {
			Logger.error("SCT 添加值失败：" + err.message);
			ok = false;
		}
		if (!!callback) callback(ok);
		return ok;
	}
	async del (key, value, callback) {
		// 规则：
		// 先判断指定的key是否是缓存的key，如果是则读取缓存内容
		// 如果没有缓存内容或者不是缓存的key，则从数据库读取数据

		if (Function.is(value) || (value === undefined && callback === undefined)) {
			callback = value;
			value = key;
			key = 'id';
		}

		// 获取Redis中缓存，因为缓存索引用的index要求唯一性，所以即便插数据库也只可能得到一条结果
		var noCache = true, caches;
		if (this.#range.includes(key)) {
			let id = this.#getCacheName(key, value);
			try {
				let cache = this.#redis.hgetall(id);
				if (!!cache && (cache[key] === value)) {
					caches = [cache];
					noCache = false;
				}
				else {
					noCache = true;
				}
			}
			catch {
				noCache = true;
			}
		}

		// 如果没有缓存，则从数据库中读取
		if (noCache) {
			try {
				let items = await this.#mysql.query("select * from " + this.#table + " where " + key + '="' + value + '"');
				if (Array.is(items)) caches = items;
			}
			catch (err) {
				Logger.log('SCT 删除值前读取原有值失败：' + err.message);
				if (!!callback) callback(false);
				return false;
			}
		}

		// 从数据库删除目标值
		var sql = [];
		for (let key in data) {
			let value = data[key];
			sql.push(key + '=' + JSON.stringify(value)); 
		}
		sql = 'delete from ' + this.#table + ' where ' + key + '=' + JSON.stringify(value);
		try {
			await this.#mysql.query(sql);
		} catch (err) {
			Logger.error("SCT 修改值失败：" + err.message);
		}

		// 删除缓存
		await Promise.all(caches.map(async cache => {
			await Promise.all(this.#range.map(async key => {
				var id = this.#getCacheName(key, cache[key]);
				await this.#redis.del(id);
			}));
		}));

		if (!!callback) callback(true);
		return true;
	}
	async expire (key, value, callback) {
		if (Function.is(value) || (value === undefined && callback === undefined)) {
			callback = value;
			value = key;
			key = 'id';
		}

		var shouldCache = this.#range.includes(key);
		if (!shouldCache) {
			if (!!callback) callback(false);
			return false;
		}
		var id = this.#getCacheName(key, value);
		try {
			let num = await this.#redis.del(id);
			num = num > 0;
			if (!!callback) callback(num);
			return num;
		}
		catch (err) {
			Logger.error('SCT 删除 ' + id + ' 失败： ' + err.message);
			if (!!callback) callback(false);
			return false;
		}
	}
}

_("Utils.CachedDB.table", CachedTable);
module.exports = {
	CachedTable
};