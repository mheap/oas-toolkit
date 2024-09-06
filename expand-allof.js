const traverse = require("traverse");
const mergician = require("mergician");
const { default: $RefParser } = require("@apidevtools/json-schema-ref-parser");

module.exports = async function (oas, excludedPathMatcher) {
  if (!excludedPathMatcher) {
    excludedPathMatcher = function (path) {
      return (
        path != "#" &&
        path != "#/components" &&
        !path.startsWith("#/components/schemas")
      );
    };
  }

  oas = await $RefParser.dereference(oas, {
    dereference: {
      // We only want to dereference in oas.components.schemas
      excludedPathMatcher,
    },
  });

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
