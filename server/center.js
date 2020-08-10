const Galanet = require('./galanet');

process.on('command::request::shakehand', remoteIP => {
	Galanet.reshakehand(remoteIP);
});