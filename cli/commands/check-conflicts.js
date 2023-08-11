const fs = require("fs");
const yaml = require("js-yaml");

module.exports = async function ({ argv }) {
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

    merger.ensureNoComponentColissions(oas, argv);
    merger.ensureNoPathColissions(oas, argv);
    merger.ensureNoTagColissions(oas, argv);
    merger.ensureNoSecurityColissions(oas, argv);
    merger.ensureNoComplexObjectCollisions(oas, argv);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
