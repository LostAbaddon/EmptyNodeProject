const Path = require('path');
const FS = require('fs');

const ResponserList = {};
const RootPath = Path.join(__dirname, './response');

const getFileList = path => {
	var list = FS.readdirSync(path);
	list.forEach(name => {
		var p = Path.join(path, name);
		var stat = FS.statSync(p);
		if (stat.isFile()) {
			let match = name.match(/^.+\.js$/i);
			if (!match) return;
			let res = require(p);
			if (!res) return;
			let url;
			if (name.toLowerCase() === 'index.js') {
				url = path.replace(RootPath, '');
			} else {
				url = p.replace(RootPath, '');
				url = url.substring(0, url.length - 3);
			}
			url = url.replace(/\\/g, '/');
			ResponserList[url] = res;
		}
		else if (stat.isDirectory()) {
			getFileList(p);
		}
	});
};

getFileList(RootPath);

module.exports = ResponserList;