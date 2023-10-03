const traverse = require("traverse");
const difference = require("lodash.difference");

function removeUnusedTags(oas) {
  const used = getReferencedTags(oas);
  const defined = getDefinedTags(oas);
  const unused = getUnusedTags(defined, used);

  return removeSpecifiedTags(oas, unused);
}

function removeSpecifiedTags(oas, unused) {
  oas = { ...oas }; // Prevent modification of original object
  oas.tags = oas.tags.filter((t) => !unused.includes(t.name));
  return oas;
}

function getReferencedTags(oas) {
  return traverse(oas).reduce(function (acc, x) {
    if (this.node && this.node["operationId"] && this.node["tags"]) {
      acc = acc.concat(this.node["tags"]);
    }
    return acc;
  }, []);
}

function getDefinedTags(oas) {
  return oas.tags.map((t) => t.name);
}

function getUnusedTags(all, referenced) {
  return difference(all, referenced);
}

module.exports = {
  getReferencedTags,
  getDefinedTags,
  getUnusedTags,
  removeSpecifiedTags,
  removeUnusedTags,
};
