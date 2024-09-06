const traverse = require("traverse");
const mergician = require("mergician");
const { dereferenceSync } = require("dereference-json-schema");

module.exports = function (oas) {
  // We only want to dereference in oas.components
  const componentsOnly = {
    components: oas.components,
  };

  oas.components = dereferenceSync(componentsOnly).components;
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
