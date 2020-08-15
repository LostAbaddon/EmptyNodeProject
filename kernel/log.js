const setStyle = _('CL.SetStyle');

class LogRecord {
	level = 0;
	stamp = 0;
	title = '';
	data = '';
	constructor (level, title, ...msgs) {
		this.level = level;
		this.title = title;
		this.stamp = new Date();
		var datas = [];
		msgs.forEach(msg => {
			if (Object.isBasicType(msg)) {
				datas.push(msg.toString());
			}
			else {
				let tmp;
				try {
					if (msg instanceof Error) {
						tmp = msg.stack || msg.message || msg.toString();
					}
					else if (Function.is(msg)) {
						tmp = msg.toString();
					}
					else {
						tmp = JSON.stringify(msg, null, '    ');
					}
				}
				catch {
					tmp = "{...}";
				}
				datas.push(tmp);
			}
		});
		this.data = datas;
	}
	toDateTime () {
		var date = this.stamp;
		var Y = date.getYear() + 1900;
		var M = date.getMonth() + 1;
		M = M + '';
		M = M.padStart(2, '0');
		var D = date.getDate();
		D = D + '';
		D = D.padStart(2, '0');
		var h = date.getHours();
		h = h + '';
		h = h.padStart(2, '0');
		var m = date.getMinutes();
		m = m + '';
		m = m.padStart(2, '0');
		var s = date.getSeconds();
		s = s + '';
		s = s.padStart(2, '0');
		return Y + '/' + M + '/' + D + ' ' + h + ':' + m + ':' + s;
	}
	toPlain () {
		var head = '[' + this.title + ' ' + LogRecord.levelName[this.level] + ' (' + this.toDateTime() + ')]';
		var body = this.data.join(' ');
		return head + ' ' + body;
	}
	toPrint () {
		var head = '[' + this.title + ' ' + LogRecord.levelName[this.level] + ' (' + this.toDateTime() + ')]';
		head = setStyle(head, LogRecord.levelColor[this.level]);
		var body = this.data.join(' ');
		return head + ' ' + body;
	}
}
LogRecord.levelName  = [ 'log',   'info',   'warn',    'error' ];
LogRecord.levelColor = [ 'green', 'yellow', 'magenta', 'red'   ];

class Logger {
	#mainTitle = 'MAIN-PRO';
	#subTitle = 'P-' + process.pid;
	#name = "";
	#limit = 0;
	#history = [];
	#timer = null;
	constructor (moduleName) {
		this.#name = moduleName;
	}
	info (...item) {
		if (Logger.LogLimit > 0) return;
		item = new LogRecord(0, this.#getFullTitle(), ...item);
		this.#record(item);
	}
	log (...item) {
		if (Logger.LogLimit > 1) return;
		item = new LogRecord(1, this.#getFullTitle(), ...item);
		this.#record(item);
	}
	warn (...item) {
		if (Logger.LogLimit > 2) return;
		item = new LogRecord(2, this.#getFullTitle(), ...item);
		this.#record(item);
	}
	error (...item) {
		if (Logger.LogLimit > 3) return;
		item = new LogRecord(3, this.#getFullTitle(), ...item);
		this.#record(item);
	}
	appendRecord (item) {
		var rec = new LogRecord(item.level, item.title, ...item.data);
		rec.stamp = new Date(item.stamp);
		this.#record(rec);
	}
	flush () {
		if (this.#history.length === 0) return;
		this.#history.sort((a, b) => a.stamp - b.stamp);
		var now = Date.now();
		var not = [], has = false;
		this.#history.forEach(log => {
			if (log.stamp.getTime() <= now) {
				console[LogRecord.levelName[log.level]](log.toPrint());
			}
			else {
				not.push(log);
				has = true;
			}
		});
		this.#history = not;
		if (has) this.#update();
	}
	#getFullTitle () {
		if (global.isSlaver) {
			return this.#subTitle + '::' + this.#name;
		}
		else {
			if (global.isMultiProcess) {
				return this.#mainTitle + '::' + this.#name;
			}
			else {
				return this.#name;
			}
		}
	}
	#update () {
		if (!!this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			this.flush();
		}, Logger.FlushDuration);
	}
	#record (item) {
		if (isSlaver) {
			process.send({
				event: 'log',
				data: item
			});
		}
		else {
			this.#history.push(item);
			this.#update();
		}
	}
}
Logger.LogLimit = 0;
Logger.FlushDuration = 100;

_("Utils.Logger", Logger);
module.exports = {
};