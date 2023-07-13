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

    const used = components.getReferencedComponents(oas);
    const defined = components.getDefinedComponents(oas);
    const unused = components.getUnusedComponents(defined, used);

    oas = components.removeComponents(oas, unused);

    fs.writeFileSync(oasFiles[0], oas);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
