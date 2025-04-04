const fs = require("fs");
const yaml = require("js-yaml");

module.exports = async function (argv) {
  try {
    const p = require("../../filter-annotation");
    let oas = yaml.load(fs.readFileSync(argv.openapi));
    oas = p.run(oas, { keep: argv.keep?.split(","), remove: argv.remove?.split(",") });
    console.log(yaml.dump(oas));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
