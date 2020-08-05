const responsor = (param, query, url, data, method, source) => {
	console.log('========== /api/demo1/[id]/test', url);
	console.log(param);
	console.log(query);
	console.log(data);
	console.log(method, source);
	return '';
};

module.exports = {
	responsor,
	methods: 'all',
};