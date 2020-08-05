const Koa = require('koa');
const KoaBody = require('koa-body');
const KoaStatic = require('koa-static');
const ResponserList = require('./responser');
const IO = require('./socket');
const DefaultType = 'application/json';
const FS = require('fs');

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
const matchRouter = (path, method) => {
	path = path.split(/[\\\/\.,|]/).filter(p => p.length > 0);
	var p = '/';
	path = path.map(q => {
		q = p + q;
		p = q + '/';
		return q;
	});
	path.reverse();

	var responser, subs = null;
	for (let p of path) {
		let res = ResponserList[p];
		if (!res) continue;
		if (!res[method]) continue;
		responser = res;
		subs = path[0].replace(p, '').split('/').filter(p => !!p && p.length > 0);
		break;
	}
	return [responser, subs];
};

// Deal Responsers
for (let url in ResponserList) {
	let res = ResponserList[url];
	let type = res.type || DefaultType;
	delete res.type
	if (typeof type === 'string') {
		let list = {};
		for (let method in res) {
			list[method] = type;
		}
		type = list;
	}
	else {
		for (let method in res) {
			if (!type[method]) type[method] = DefaultType;
		}
	}
	res._type = type;
}

// Static Resources
app.use(KoaStatic(require('path').join(process.cwd(), 'page')));

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
app.use(async ctx => {
	var method = ctx.method.toLowerCase(), path = ctx.path, params = {};
	if (!!ctx.query) for (let key in ctx.query) params[key] = ctx.query[key];
	if (!!ctx.request.body) for (let key in ctx.request.body) params[key] = ctx.request.body[key];

	console.log('===================================');
	console.log('  path:', path);
	console.log('method:', method);
	console.log(' query:', JSON.stringify(params));

	var [res, subs] = matchRouter(path, method);
	if (!res) {
		ctx.type = DefaultType;
		ctx.body = {
			message: 'No Responser Found',
			code: 404,
			ok: false
		};
		console.log('result: Responser Not Found');
		return;
	}

	var type = res._type[method] || DefaultType, data;
	res = res[method];
	try {
		data = await res(params, subs, path, ctx);
	}
	catch (e) {
		ctx.type = DefaultType;
		ctx.body = {
			message: e.message,
			code: 404,
			ok: false
		};
		console.error(' error: ' + e.message);
		return;
	}

	if (type !== "auto") {
		ctx.type = type;
		ctx.body = {
			data,
			code: 0,
			ok: true
		};
	}
	console.log('result: JobDone');
});

module.exports = (port=8001, securePort=8010, callback) => {
	port = port || 8001;

	var csrOption = {
		key: FS.readFileSync('./CSR/privatekey.pem'),
		cert: FS.readFileSync('./CSR/certificate.pem'),
	};

	var nServer = require('http').createServer(app.callback());
	IO.init(nServer); // socket.io
	nServer.listen(port, callback);

	var sServer = require('https').createServer(csrOption, app.callback());
	IO.init(sServer); // socket.io
	sServer.listen(securePort, callback);
};