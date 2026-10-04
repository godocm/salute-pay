const Factory = artifacts.require('SaluteTronFactory');
module.exports = async function (deployer) { await deployer.deploy(Factory); };
