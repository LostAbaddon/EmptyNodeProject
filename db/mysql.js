const MySQL = require('mysql');
const Logger = new (_("Utils.Logger"))('Responsor');

const newConnection = cfg => {};

_("Utils.MySQL.create", newConnection);
module.exports = {
	create: newConnection
};