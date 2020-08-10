const FS = require('fs');

const WatchList = {};

class Watcher {
	#folderpath = '';
	#filemap = {};
	#onChange = null;
	constructor (path, files, callback) {
		this.#folderpath = path;
		this.#onChange = callback;

		FS.watch(path, (event, filename) => {
			console.log('FUCK!!!', filename);
		});

		this.updateFileInfo(files);
	}
	async updateFileInfo (files) {
		if (!files || !Array.is(files)) {
			files = await _('Utils.getAllContents')(path);
		}
		files.forEach(filepath => {
			this.#filemap[filepath] = 0;
		});
		console.log(this.#filemap);
	}
}

const addWatch = (folderPath, files, callback) => {
	if (!!WatchList[folderPath]) return;
	WatchList[folderPath] = new Watcher(folderPath, files, callback);
};

_('Utils.Watcher', Watcher);
_('Utils.watchFolder', addWatch);
module.exports = {
	add: addWatch
};