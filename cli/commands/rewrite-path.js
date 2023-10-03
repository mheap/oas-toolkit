const fs = require("fs");
const yaml = require("js-yaml");

module.exports = async function (argv) {
  try {
    const p = require("../../rewrite-path");
    let oas = yaml.load(fs.readFileSync(argv.openapi));
    oas = p.regex(oas, argv.oldPath, argv.newPath);
    console.log(yaml.dump(oas));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
