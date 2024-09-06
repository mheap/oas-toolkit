const fs = require("fs");
const yaml = require("js-yaml");

module.exports = async function (argv) {
  try {
    const expand = require("../../expand-allof");
    let oas = yaml.load(fs.readFileSync(argv.openapi));
    oas = await expand(oas);
    console.log(yaml.dump(oas));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
