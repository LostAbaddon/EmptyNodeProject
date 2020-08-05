const ModuleList = {};
global._ = (path, module) => {
	path = path.split(/[\/\\,\.\:;]/).map(p => p.trim()).filter(p => p.length > 0);
	if (path.length < 1) return global;
	path = path.join("/");
	if (!!module) {
		ModuleList[path] = module;
		return module
	}
	return ModuleList[path];
};

_('Utils', {});