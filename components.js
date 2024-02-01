const traverse = require("traverse");
const isEqual = require("lodash.isequal");
const difference = require("lodash.difference");
const intersection = require("lodash.intersection");

function removeUnusedComponents(oas) {
  const used = getReferencedComponents(oas);
  const defined = getDefinedComponents(oas);
  const unused = getUnusedComponents(defined, used, oas);

  const result = removeSpecifiedComponents(oas, unused);

  // If nothing was removed, we've removed all unused components
  // including those referenced by other components that were unused
  if (isEqual(oas, result)) {
    return result;
  }

  return removeUnusedComponents(result);
}

function getReferencesToComponent(oas, component) {
  return traverse(oas).reduce(function (acc, x) {
    if (
      this.isLeaf &&
      this.key == "$ref" &&
      x == `#/${component.replace(/\./g, "/")}`
    ) {
      acc.push(this.path.slice(0, 3).join("."));
    }

    return acc;
  }, []);
}

function removeSpecifiedComponents(oas, unused) {
  oas = traverse(oas).clone();
  return traverse(oas).forEach(function (x) {
    const path = this.path.join(".");
    if (unused.includes(path)) {
      this.remove();
      if (Object.keys(this.parent.node).length === 0) {
        this.parent.remove();
      }
    }
  });
}

function getReferencedComponents(oas) {
  const components = traverse(oas).reduce(function (acc, x) {
    if (this.isLeaf && this.key == "$ref") {
      acc.push(x.replace("#/", "").replace(/\//g, "."));
    }

    // Per-operation security schemes
    if (this.node && this.node["operationId"] && this.node["security"]) {
      for (let item of this.node["security"]) {
        for (let key of Object.keys(item)) {
          acc.push(`components.securitySchemes.${key}`);
        }
      }
    }
    return acc;
  }, []);

  // Add global security schemes
  if (oas.security) {
    for (let item of oas.security) {
      for (let key of Object.keys(item)) {
        components.push(`components.securitySchemes.${key}`);
      }
    }
  }

  return components;
}

function getDefinedComponents(oas) {
  return traverse(oas).reduce(function (acc, x) {
    if (this.path[0] !== "components") {
      return acc;
    }

    // We're at a schema definition
    if (this.path.length == 3) {
      acc.push(this.path.join("."));
    }

    return acc;
  }, []);
}

function getUnusedComponents(all, referenced, oas) {
  const unused = difference(all, referenced);

  // If we have a component that is only referenced by itself, it's unused
  const used = intersection(all, referenced);
  for (let component of used) {
    const references = getReferencesToComponent(oas, component);
    if (references.length == 1 && references[0] === component) {
      unused.push(component);
    }
  }
  return unused;
}

module.exports = {
  getReferencedComponents,
  getDefinedComponents,
  getUnusedComponents,
  removeSpecifiedComponents,
  removeUnusedComponents,
};
