const fs = require("fs");
const yaml = require("js-yaml");

module.exports = function ({ argv }) {
  try {
    const oasFiles = argv._.slice(1);
    if (oasFiles.length < 2) {
      return;
    }

    const merger = require("../../merger");

    const oas = [];
    for (let f of oasFiles) {
      oas.push(yaml.load(fs.readFileSync(f)));
    }

    const combined = merger.apply(null, oas);
    console.log(yaml.dump(combined));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
