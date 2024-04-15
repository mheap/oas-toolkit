const fs = require("fs");
const yaml = require("js-yaml");
const { removeUnusedComponents } = require("../../components");
const { removeUnusedTags } = require("../../tags");

module.exports = async function (argv) {
  try {
    const p = require("../../remove-with-annotation");
    let oas = yaml.load(fs.readFileSync(argv.openapi));
    oas = p.remove(oas, argv.annotation);

    if (argv["remove-unused"]) {
      oas = removeUnusedComponents(oas);
      oas = removeUnusedTags(oas);
    }

    console.log(yaml.dump(oas));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
