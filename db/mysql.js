const MySQL = require('mysql');
const newLongID = _('Message.newLongID');
const Logger = new (_("Utils.Logger"))('MySQL');

const Servers = new Map();

const getConnTypeName = sql => sql.isConnection ? 'connection' : (sql.isPool ? 'pool' : 'cluster');
const getClauseAction = clause => clause.match(/\b(insert|update|delete|alter|change|drop column)\b/i);
const beforeQuery = (sql, clause) => {
	var type = getConnTypeName(sql);
	var action = getClauseAction(clause);
	sql.emit('sql::query', type, clause);
	if (!!action) {
		action = action[0].toLowerCase().split(' ')[0];
		sql.emit('sql::' + action, type, clause);
	}
	return action;
};
const afterQueryFailed = (sql, action, clause, err) => {
	var type = getConnTypeName(sql);
	sql.emit('sql::query::error', type, clause, err);
	if (!!action) {
		sql.emit('sql::' + action + '::error', type, clause, err);
	}
};
const afterQuerySuccess = (sql, action, clause, result) => {
	var type = getConnTypeName(sql);
	sql.emit('sql::query::success', type, clause, result);
	if (!!action) {
		sql.emit('sql::' + action + '::success', type, clause, result);
	}
};

const newSQL = cfg => {
	var sql;
	if (Array.is(cfg)) sql = newCluster(cfg);
	else if (Number.is(cfg.connectionLimit)) sql = newPool(cfg);
	else sql = newConnection(cfg);

	return sql;
};
const newConnection = cfg => {
	cfg.id = cfg.id || newLongID();
	var id = cfg.id;
	var sql = Servers.get(cfg.id);
	while (!!sql) {
		cfg.id = id + '-' + newLongID();
		sql = Servers.get(cfg.id);
	}
	sql = MySQL.createConnection(cfg);
	id = cfg.id;
	sql.on('end', () => {
		Servers.delete(id);
	});
	sql.__end = sql.end;
	sql.end = cb => {
		Logger.info("Connection (" + id + ') Offline...');
		Servers.delete(id);
		sql.__end(cb);
	};
	sql.__query = sql.query;
	sql.query = (clause, callback) => new Promise((res, rej) => {
		var action = beforeQuery(sql, clause);
		sql.__query(clause, (err, results, fields) => {
			if (!!callback) callback(err, results, fields);
			if (!!err) {
				rej(err);
				afterQueryFailed(sql, action, clause, err);
			}
			else {
				res(results)
				afterQuerySuccess(sql, action, clause, results);
			}
		});
	});
	sql.isConnection = true;
	sql.isPool = false;
	sql.isCluster = false;
	Servers.set(id, sql);
	return sql;
};
const newPool = cfg => {
	if (!(cfg.connectionLimit >= 1)) cfg.connectionLimit = 1;
	cfg.id = cfg.id || newLongID();
	var id = cfg.id;
	var sql = Servers.get(cfg.id);
	while (!!sql) {
		cfg.id = id + '-' + newLongID();
		sql = Servers.get(cfg.id);
	}
	sql = MySQL.createPool(cfg);
	id = cfg.id;
	sql.__end = sql.end;
	sql.end = cb => {
		Logger.info("Pool (" + id + ') Closed...');
		Servers.delete(id);
		sql.__end(cb);
	};
	sql.__query = sql.query;
	sql.query = (clause, callback) => new Promise((res, rej) => {
		var action = beforeQuery(sql, clause);
		sql.__query(clause, (err, results, fields) => {
			if (!!callback) callback(err, results, fields);
			if (!!err) {
				rej(err);
				afterQueryFailed(sql, action, clause, err);
			}
			else {
				res(results)
				afterQuerySuccess(sql, action, clause, results);
			}
		});
	});
	sql.isConnection = false;
	sql.isPool = true;
	sql.isCluster = false;
	Servers.set(id, sql);
	return sql;
};
const newCluster = cfg => {
	if (!Array.is(cfg)) cfg = [cfg];
	cfg[0].id = cfg[0].id || newLongID();
	var id = cfg[0].id;
	var sql = Servers.get(cfg[0].id);
	while (!!sql) {
		cfg[0].id = id + '-' + newLongID();
		sql = Servers.get(cfg[0].id);
	}
	sql = MySQL.createPoolCluster();
	cfg.forEach(conf => {
		sql.add(conf);
	});
	id = cfg[0].id;
	sql.__end = sql.end;
	sql.end = cb => {
		Logger.info("Cluster (" + id + ') Shutdowned...');
		Servers.delete(id);
		sql.__end(cb);
	};
	sql.__query = sql.query;
	sql.query = (clause, callback) => new Promise((res, rej) => {
		sql.getConnection((err, conn) => {
			if (!!err) return rej(err);
			var action = beforeQuery(sql, clause);
			conn.query(clause, (err, results, fields) => {
				if (!!callback) callback(err, results, fields);
				if (!!err) {
					rej(err);
					afterQueryFailed(sql, action, clause, err);
				}
				else {
					res(results)
					afterQuerySuccess(sql, action, clause, results);
				}
			});
		});
	});
	sql.isConnection = false;
	sql.isPool = false;
	sql.isCluster = true;
	Servers.set(id, sql);
	return sql;
};
const getSQL = id => Servers.get(id);
const allSQL = () => [...Servers.keys()];

_("Utils.MySQL.create", newSQL);
_("Utils.MySQL.createConnection", newConnection);
_("Utils.MySQL.createPool", newPool);
_("Utils.MySQL.createCluster", newCluster);
_("Utils.MySQL.get", getSQL);
_("Utils.MySQL.all", allSQL);
module.exports = {
	create: newSQL,
	connection: newConnection,
	pool: newPool,
	cluster: newCluster,
	get: getSQL,
	all: allSQL,
};