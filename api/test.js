const responsor = (param, query, url, data, method, source) => {
	console.log('========== /api/test', url);
	console.log(param);
	console.log(query);
	console.log(data);
	console.log(method, source);
};

module.exports = {
	responsor,
	sources: 'web'
};