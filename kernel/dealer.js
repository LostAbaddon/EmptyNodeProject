class Dealer {
	state = Dealer.State.IDLE;
	connected = true;
	total = 0;
	done = 0;
	timespent = 0;
	failed = 0;
	energy = 0;
	power = 0;
	#map = new Map();
	#deads = [];
	constructor () {
		this.energy = this.constructor.Initial;
		this.power = this.constructor.Initial;
	}
	start (task, callback) {
		if (this.state === Dealer.State.DYING || this.state === Dealer.State.DIED) {
			let err = new Errors.Dealer.DealerNotAvailable();
			if (!!callback) callback({
				ok: false,
				code: err.code,
				message: err.message
			});
			return;
		}
		this.state = Dealer.State.WORKING;

		var cb = this.#map.get(task);
		if (!!cb) {
			let ncb = result => {
				cb(result);
				if (!!callback) callback(result);
			}
			this.#map.set(task, ncb);
			return;
		}

		task._starttime = now();
		this.total ++;
		this.power = this.energy * (this.working + 1);
		this.#map.set(task, callback);
	}
	finish (task, result) {
		task._finishtime = now();
		var success;
		if (Boolean.is(result)) success = result;
		else if (!result) {
			success = false;
		}
		else if (Boolean.is(result.ok)) {
			success = result.ok;
		}
		else {
			success = !!result;
		}
		this.done ++;
		var timespent = 0;
		if (success) {
			timespent = task._finishtime - task._starttime;
			this.timespent += timespent;
		}
		else {
			this.failed ++;
		}
		if (this.done === this.failed) this.energy = this.constructor.Initial;
		else this.energy = this.timespent / (this.done - this.failed) * (this.total + this.failed) / this.total;
		if (success) this.energy = (this.energy * this.constructor.AveWeight + timespent * this.constructor.LastWeight) / (this.constructor.AveWeight + this.constructor.LastWeight);
		this.power = this.energy * (this.working + 1);
		this.#map.delete(task);
		if (this.working === 0) {
			if (this.state === Dealer.State.DYING) this.#suicide();
			else if (this.state !== Dealer.State.DIED) this.state = Dealer.State.IDLE;
		}

		var cb = this.#map.get(task);
		if (!!cb) cb(result);
	}
	onDied (cb) {
		if (this.state === Dealer.State.DIED) return cb();
		this.#deads.push(cb);
	}
	#suicide () {
		this.state == Dealer.State.DIED;
		var list = this.#deads.copy();
		this.#deads.clear();
		this.#deads = undefined;
		this.#map.clear();
		this.#map = undefined;;
		list.forEach(cb => cb());
	}
	suicide () {
		if (this.state === Dealer.State.DIED) return;
		if (this.working === 0) {
			this.#suicide();
		}
		else {
			this.state = Dealer.State.DYING;
		}
	}
	get working () {
		return this.total - this.done;
	}
	get available () {
		return this.constructor.Limit <= 0 || this.working <= this.constructor.Limit;
	}
	static Limit = 10;
	static Initial = 0;
	static AveWeight = 2;
	static LastWeight = 1;
}
Dealer.State = Symbol.set('IDLE', 'BUSY', 'DYING', 'DIED');

class DealerPool {
	#dealerClass = Dealer;
	#state = DealerPool.State.IDLE;
	#members = [];
	#pending = [];
	#deads = [];
	constructor (dealerClass) {
		this.#dealerClass = dealerClass;
	}
	addMember (...args) {
		if (this.#state === DealerPool.State.DYING || this.#state === DealerPool.State.DIED) return;

		var member;
		if ((args.length === 1) && (args[0] instanceof this.#dealerClass)) member = args[0];
		else member = new this.#dealerClass(...args);
		this.#members.push(member);
		return member;
	}
	removeMember (member) {
		if (this.#state === DealerPool.State.DYING || this.#state === DealerPool.State.DIED) return;

		member.suicide();
		this.#members.remove(member);
	}
	addTask (task, callback) {
		return new Promise(res => {
			if (this.#state === DealerPool.State.DYING || this.#state === DealerPool.State.DIED) {
				let err = new Errors.Dealer.DealerNotAvailable();
				let result = {
					ok: false,
					code: err.code,
					message: err.message
				};
				if (!!callback) callback(result);
				return res(result);
			}
			this.#state = DealerPool.State.BUSY;

			var finished = false;
			var scb = result => {
				if (!!callback) callback(result);
				res(result);
			};
			var cb = result => {
				if (finished) return;
				finished = true;

				scb(result);

				var available = this.#members.some(m => m.available);
				if (available) {
					this.addTask(...(this.#pending.shift()));
				}
				else {
					this.#state = DealerPool.State.IDLE;
				}
			};

			var members = this.#members.filter(m => m.available);
			if (members.length === 0) {
				this.#pending.push([task, scb]);
				return;
			}
			members.sort((ma, mb) => ma.power - mb.power);
			var member = members[0];

			member.start(task, cb);
		});
	}
	forEach (cb) {
		if (this.#state === DealerPool.State.DYING || this.#state === DealerPool.State.DIED) return;
		this.#members.forEach(m => cb(m));
	}
	onDied (cb) {
		if (this.state === DealerPool.State.DIED) return cb();
		this.#deads.push(cb);
	}
	suicide () {
		if (this.#state === DealerPool.State.DYING || this.#state === DealerPool.State.DIED) return;
		this.#state = DealerPool.State.DYING;

		var count = this.count;
		this.#members.forEach(m => {
			m.onDied(() => {
				count --;
				if (count === 0) {
					this.#state = DealerPool.State.DIED;
					let list = this.#deads.copy();
					this.#deads.clear();
					this.#deads = undefined;
					this.#members.clear();
					this.#members = undefined;
					this.#pending = undefined;
					list.forEach(cb => cb());
				}
			});
			m.suicide();
		});

		if (this.pending > 0) {
			let err = new Errors.Dealer.DealerDied();
			let result = {
				ok: false,
				code: err.code,
				message: err.message
			};
			this.#pending.forEach(d => d[1](result));
			this.#pending.clear();
		}
	}
	get state () {
		return this.#state;
	}
	get pending () {
		return this.#pending.length;
	}
	get count () {
		return this.#members.length;
	}
}
DealerPool.State = Symbol.set('IDLE', 'BUSY', 'DYING', 'DIED');

module.exports = {
	DealerPool,
	Dealer
};