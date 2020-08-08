const responsor = (param, query, url, data, method, source, ip, port) => {
	if (Math.random() > 0.5) {
		return {
			ok: true,
			data: 'success'
		};
	}
	else {
		return {
			ok: false,
			code: 500,
			message: 'some error'
		}
	}
};

module.exports = {
	responsor,
	methods: [ 'get', 'put', 'delete', 'post' ],
	source: [ 'web', 'tcp', 'udp', 'pipe' ]
};