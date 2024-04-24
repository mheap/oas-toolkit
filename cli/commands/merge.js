const fs = require("fs");
const yaml = require("js-yaml");

module.exports = function (argv, b, c) {
  try {
    const oasFiles = argv.openapi;

    const merger = require("../../merger");
    const canonical = require("../../canonical-server");

    let oas = [];
    for (let f of oasFiles) {
      oas.push(yaml.load(fs.readFileSync(f)));
    }

    if (argv.movePathToOperation) {
      oas = oas.map((o) => canonical.run(o));
    }

    const combined = merger(oas, argv);
    console.log(yaml.dump(combined));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
