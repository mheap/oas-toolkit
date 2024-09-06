const traverse = require("traverse");
const mergician = require("mergician");
const { default: $RefParser } = require("@apidevtools/json-schema-ref-parser");

module.exports = async function (oas) {
  // We only want to dereference in oas.components.schemas
  const componentsOnly = {
    components: {
      schemas: oas.components.schemas,
    },
  };

  oas.components.schemas = (
    await $RefParser.dereference(componentsOnly)
  ).components.schemas;
  oas = traverse(oas).clone();

  oas = traverse(oas).map(function (x) {
    const path = this.path.join(".");
    if (!path.startsWith("components")) {
      return;
    }
    if (!this.node || !this.node["allOf"]) {
      return;
    }

    return mergician({}, ...this.node["allOf"]);
  });

  return oas;
};
