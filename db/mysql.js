const MySQL = require('mysql');
const newLongID = _('Message.newLongID');
const Logger = new (_("Utils.Logger"))('MySQL');

const Servers = new Map();

const newSQL = cfg => {
	if (Array.is(cfg)) return newCluster(cfg);
	if (Number.is(cfg.connectionLimit)) return newPool(cfg);
	return newConnection(cfg);
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
		sql.__query(clause, (err, results, fields) => {
			if (!!callback) callback(err, results, fields);
			if (!!err) rej(err);
			else res(results)
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
		sql.__query(clause, (err, results, fields) => {
			if (!!callback) callback(err, results, fields);
			if (!!err) rej(err);
			else res(results)
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
			conn.query(clause, (err, results, fields) => {
				if (!!callback) callback(err, results, fields);
				if (!!err) rej(err);
				else res(results);
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