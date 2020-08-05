const responsor = (param, query, url, data, method, source) => {
	console.log('========== /api', url);
	console.log(param);
	console.log(query);
	console.log(data);
	console.log(method, source);
};

module.exports = {
	responsor,
	methods: 'get',
	sources: 'all'
};