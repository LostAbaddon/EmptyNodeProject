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
	methods: [ 'get', 'put', 'delete', 'post' ], // 如果要匹配所有方法，则可以省略该字段，或取值为 "all"
	source: [ 'web', 'tcp', 'udp', 'pipe', 'socket' ]      // 如果要匹配所有渠道，则可以省略该字段，或取值为 "all"
};