const Koa = require('koa');
const KoaBody = require('koa-body');
const KoaStatic = require('koa-static');
const ResponsorManager = require('./responser');
const IO = require('./websocket');
const FS = require('fs');
const Path = require('path');

const DefaultType = 'application/json';

const app = new Koa();
const kb = KoaBody({
	multipart: true,
	parsedMethods: ['POST', 'PUT', 'PATCH', 'GET', 'HEAD', 'DELETE']
});

const getLocalIP = () => {
	var ips = [];
	var interfaces = require('os').networkInterfaces();
	for (let networks in interfaces) {
		networks = interfaces[networks];
		for (let addr of networks) {
			addr = addr.address;
			if (addr === '127.0.0.1' || addr === '::1') continue;
			if (!ips.includes(addr)) ips.push(addr);
		}
	}
	return ips;
};

module.exports = (options, callback) => {
	if (!options.port) {
		callback(new Errors.ConfigError.NoPorts());
		return;
	}

	// Load Responsors
	if (!options.api) {
		callback(new Errors.ConfigError.NoResponsor());
		return;
	}
	ResponsorManager.load(Path.join(process.cwd(), options.api.local), options.api.url);

	// Static Resources
	app.use(KoaStatic(Path.join(process.cwd(), options.page)));

	// For CORS
	app.use(async (ctx, next) => {
		ctx.set('Access-Control-Allow-Origin', '*');
		ctx.set('Access-Control-Allow-Headers', '*');
		ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');

		var method = ctx.method.toLowerCase();
		if (method === 'options') {
			ctx.body = '';
			ctx.type = 'text/plain';
			return;
		}

		await next();
	});

	// For FormData
	app.use(kb);

	// Transaction Dealers
	var apiPrefix = options.api.url;
	apiPrefix = '/' + apiPrefix.replace(/^\/+|\/+$/g, '') + '/';
	app.use(async ctx => {
		var method = ctx.method.toLowerCase(), path = ctx.path, params = {};

		console.log('===================================');
		console.log('  path:', path);
		if (path.indexOf(apiPrefix) !== 0) {
			ctx.type = DefaultType;
			ctx.body = {
				message: 'Non-API Request',
				code: 403,
				ok: false
			};
			console.error('result: Non-API Request');
			return;
		}
		path = path.replace(apiPrefix, '/');

		if (!!ctx.query) for (let key in ctx.query) params[key] = ctx.query[key];
		if (!!ctx.request.body) for (let key in ctx.request.body) params[key] = ctx.request.body[key];

		console.log('method:', method);
		console.log(' query:', JSON.stringify(params));

		var [responsor, query] = ResponsorManager.match(path, method, 'web');
		if (!responsor) {
			ctx.type = DefaultType;
			ctx.body = {
				message: 'No Responsor Found',
				code: 404,
				ok: false
			};
			console.error('result: Responsor Not Found');
			return;
		}

		ctx.type = DefaultType;
		var data = null;
		try {
			data = await responsor(params, query, path, ctx, method, 'web');
		}
		catch (err) {
			ctx.type = DefaultType;
			ctx.body = {
				message: err.message,
				code: 500,
				ok: false
			};
			console.error(' error: ' + err.message);
			return;
		}
		if (data === undefined || data === null) {
			ctx.type = DefaultType;
			ctx.body = {
				message: 'Empty Response',
				code: 500,
				ok: false
			};
			console.error(' error: Empty Response');
			return;
		}
		if (Number.is(data.code) && Boolean.is(data.ok)) {
			ctx.type = data.type || DefaultType;
			if (data.ok) {
				ctx.body = {
					data: data.data || data.message,
					code: data.code,
					ok: data.ok
				};
			}
			else {
				ctx.body = {
					message: data.message || data.data,
					code: data.code,
					ok: data.ok
				};
			}
		}
		else {
			ctx.type = ctx.type || DefaultType;
			ctx.body = {
				data,
				code: 200,
				ok: true
			}
		}

		console.log('result: JobDone');
	});

	var count = 0, success = 0, failed = 0, tasks = {};
	var cb = (task, err) => {
		if (tasks[task]) return;
		tasks[task] = true;

		count --;
		if (!!err) {
			failed ++;
			console.error(err.message);
		}
		else {
			success ++;
		}
		if (count > 0) return;

		if (success === 0) {
			callback(new Errors.ConfigError.NoWebServerAvailable());
		}
		else {
			callback();
		}
	};
	if (Number.is(options.port.https)) {
		let csrOption = {}, ok = false;
		try {
			csrOption.key = FS.readFileSync(Path.join(process.cwd(), options.certification.privateKey));
			csrOption.cert = FS.readFileSync(Path.join(process.cwd(), options.certification.certificate));
			ok = true;
		}
		catch {
			console.error('Missing CSR key-file.');
			ok = false;
		}
		if (ok) {
			tasks.https = false;
			let sServer = require('https').createServer(csrOption, app.callback());
			sServer.on('error', err => {
				cb('https', err);
			});
			IO.init(sServer); // socket.io
			count ++;
			try {
				sServer.listen(options.port.https, () => cb('https'));
			}
			catch (err) {
				cb('https', err);
			}
		}
	}
	if (Number.is(options.port.http)) {
		tasks.http = false;
		let nServer = require('http').createServer(app.callback());
		nServer.on('error', err => {
			cb('http', err);
		});
		IO.init(nServer); // socket.io
		count ++;
		try {
			nServer.listen(options.port.http, () => cb('http'));
		}
		catch (err) {
			cb('http', err);
		}
	}

	if (count === 0) {
		callback(new Errors.ConfigError.NoPorts());
	}
};