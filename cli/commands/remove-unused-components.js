const fs = require("fs");
const yaml = require("js-yaml");

module.exports = async function ({ argv }) {
  try {
    const oasFiles = argv._.slice(1);
    if (oasFiles.length !== 1) {
      return;
    }

    const components = require("../../components");
    let oas = yaml.load(fs.readFileSync(oasFiles[0]));
    oas = components.removeUnusedComponents(oas);
    console.log(yaml.dump(oas));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
