const fs = require("fs");
const yaml = require("js-yaml");

module.exports = async function (argv) {
  try {
    const p = require("../../canonical-server");
    let oas = yaml.load(fs.readFileSync(argv.openapi));
    oas = p.run(oas);
    console.log(yaml.dump(oas));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
