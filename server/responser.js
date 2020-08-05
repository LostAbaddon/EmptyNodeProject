const Path = require('path');

global.ResponsorMap = {};
global.ResponsorList = [];

const loadResponsors = async (path) => {
	var list = await _('Utils.getAllContents')(path);
	path = path.replace(/[\/\\]+$/, '') + Path.sep;
	list.forEach(filepath => {
		var url = filepath.replace(path, '');
		var parts = url.split(/[\/\\]+/).filter(f => f.length > 0);
		var last = parts.last;
		if (!!last.match(/\.js$/i)) {
			last = last.substr(0, last.length - 3);
			if (last === 'index') {
				parts.splice(parts.length - 1, 1);
			}
			else {
				parts[parts.length - 1] = last;
			}
		}
		url = '/' + parts.join('/');
		parts = parts.map(part => {
			if (!!part.match(/^\[.*\]$/)) {
				return {
					name: part.replace(/^\[+|\]+$/g, ''),
					dynamic: true
				};
			}
			else {
				return {
					name: part,
					dynamic: false
				};
			}
		});

		var res = require(filepath);
		if (!res || !res.responsor) return;

		if (!res.methods) {
			res.methods = null;
		}
		else if (String.is(res.methods)) {
			if (res.methods === '' || res.methods === 'all') res.methods = null;
			else res.methods = [res.methods];
		}
		else if (!Array.is(res.methods)) res.methods = null;

		if (!res.sources) {
			res.sources = null;
		}
		else if (String.is(res.sources)) {
			if (res.sources === '' || res.sources === 'all') res.sources = null;
			else res.sources = [res.sources];
		}
		else if (!Array.is(res.sources)) res.sources = null;

		res._queryList = parts;

		ResponsorMap[url] = res;
		ResponsorList.push(res);
	});
};
const matchResponsor = (url, method, source) => {
	var res = ResponsorMap[url], query = {}, didMatch = false;
	if (!!res) {
		if (res.sources === null || (!!res.sources.includes && res.sources.includes(source))) didMatch = true;
		if (didMatch) {
			didMatch = false;
			if (res.methods === null || (!!res.methods.includes && res.methods.includes(method))) didMatch = true;
			if (didMatch) return [res, query];
		}
	}

	url = url.split('/').filter(u => u.length > 0);
	res = null;
	var len = url.length;
	ResponsorList.some(r => {
		var q = r._queryList, qry = {};
		if (q.length !== len) return;
		for (let i = 0; i < len; i ++) {
			let qi = q[i];
			if (qi.dynamic) {
				qry[qi.name] = url[i];
			}
			else {
				if (url[i] !== qi.name) return;
			}
		}
		res = r.responsor;
		query = qry;
		return true;
	});
	return [res, query];
};

module.exports = {
	load: loadResponsors,
	match: matchResponsor
};