var IDSet = [Math.floor(Math.range(256)), Math.floor(Math.range(256)), Math.floor(Math.range(256))];
const newID = () => {
	var id = [...IDSet];
	IDSet[0] ++;
	if (IDSet[0] === 256) {
		IDSet[0] = 0;
		IDSet[1] ++;
		if (IDSet[1] === 256) {
			IDSet[1] = 0;
			IDSet[2] ++;
			if (IDSet[2] === 256) IDSet[2] = 0;
		}
	}
	return id;
};

const packageMessage = (msg, size) => {
	if (msg instanceof Uint8Array) {
		msg = Buffer.from(msg);
	}
	else if (!(msg instanceof Buffer)) {
		msg = JSON.stringify(msg);
		msg = Uint8Array.fromString(msg);
		msg = Buffer.from(msg);
	}
	var len = msg.byteLength;
	var count = Math.ceil(len / size);
	var packs = [];
	var id = newID();
	for (let i = 0; i < count; i ++) {
		let start = size * i;
		let end = start + size;
		if (end > len) end = len;
		let buf = Buffer.alloc(end - start + 10);
		buf[0] = id[0];
		buf[1] = id[1];
		buf[2] = id[2];
		buf.writeUInt16BE(count, 4);
		buf.writeUInt16BE(count, 7);
		msg.copy(buf, 10, start, end);
		packs.push(buf);
	}
	return packs;
};
const unpackMessage = msg => {
	var len = msg.byteLength;
	var fid = msg.subarray(0, 3);
	fid = [...fid].join('-');
	var count = msg.subarray(4, 6);
	count = count.readUInt16BE(0, 2);
	var index = msg.subarray(7, 9);
	index = index.readUInt16BE(0, 2);
	var data = Buffer.alloc(len - 10);
	msg.copy(data, 0, 10, len);
	return {
		id: fid,
		count, index,
		data
	}
};

_('Message.newID', newID);
_('Message.packageMessage', packageMessage);
_('Message.unpackMessage', unpackMessage);