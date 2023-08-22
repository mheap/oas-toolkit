const mergician = require("mergician");
const traverse = require("traverse");
const isEqual = require("lodash.isequal");
const uniqWith = require("lodash.uniqwith");

function merge(objects, options) {
  // Do the merge
  let combinedSpec = {};

  // Values that should be overwritten
  const overwriteMerge = mergician({ dedupArrays: true });
  const overwriteSections = ["openapi", "info", "servers", "externalDocs"];
  for (let section of overwriteSections) {
    combinedSpec = mergeSection(combinedSpec, overwriteMerge, objects, section);
  }

  // Values that should be appended
  const appendMerge = mergician({ appendArrays: true, dedupArrays: true });
  const appendSections = ["paths", "components", "security", "tags"];
  for (let section of appendSections) {
    combinedSpec = mergeSection(combinedSpec, appendMerge, objects, section);
  }

  // Values that should be unique
  const uniqueSections = ["security", "tags"];
  for (let section of uniqueSections) {
    if (combinedSpec[section]) {
      combinedSpec[section] = uniqWith(combinedSpec[section], isEqual);
    }
  }

  // Unique values that are at a non-deterministic path
  combinedSpec = traverse(combinedSpec).map(function () {
    if (["oneOf", "allOf", "anyOf"].includes(this.key)) {
      this.node = uniqWith(this.node, isEqual);
    }
  });

  return combinedSpec;
}

function mergeSection(spec, merger, objects, section) {
  return Object.assign(
    spec,
    merger.apply(
      null,
      objects
        .map((o) => {
          const r = {};
          if (o[section]) {
            r[section] = o[section];
          }
          return r;
        })
        .filter(Boolean)
    )
  );
}

function ensureNoComponentColissions(objects, options) {
  options = options || {};
  const componentList = {};
  // Fetch the first two levels of components
  for (const object of objects) {
    if (object.components) {
      for (let type in object.components) {
        for (item in object.components[type]) {
          componentList[`components.${type}.${item}`] =
            componentList[`components.${type}.${item}`] || [];
          componentList[`components.${type}.${item}`].push(object.info.title);
        }
      }
    }
  }

  for (let component in componentList) {
    if (options.ignorePrefix) {
      if (typeof options.ignorePrefix == "string") {
        options.ignorePrefix = [options.ignorePrefix];
      }
      for (let prefix of options.ignorePrefix) {
        if (component.startsWith(prefix)) {
          delete componentList[component];
        }
      }
    }

    // Check if there are > 2
    const value = componentList[component];
    if (value && value.length > 1) {
      throw new Error(
        `Duplicate component detected: ${component} (${value.join(", ")})`
      );
    }
  }
}

function ensureNoPathColissions(objects) {
  const actionList = {};
  // Build a map of normalised paths to HTTP verb mapping
  for (const object of objects) {
    for (let path in object.paths) {
      // Normalise the path
      const normalisedPath = path.replace(/\{\w+\}/g, "{VAR}");
      for (let verb in object.paths[path]) {
        const k = `${verb.toUpperCase()} ${normalisedPath}`;
        actionList[k] = actionList[k] || [];
        actionList[k].push(object.info.title);
      }
    }
  }

  for (let action in actionList) {
    const value = actionList[action];
    if (value.length > 1) {
      throw new Error(
        `Duplicate path detected: ${action} (${value.join(", ")})`
      );
    }
  }
}

function ensureListUniqueness(list, key, objects) {
  let all = [];
  for (let object of objects) {
    all = all.concat(object[list] || []);
  }

  for (let c of all) {
    const d = all.filter((t) => {
      return t[key] == c[key] && !isEqual(c, t);
    });

    if (d.length > 0) {
      // Which files does this exist in?
      const sources = [];
      for (let object of objects) {
        if (!object[list]) {
          continue;
        }

        const match = object[list].filter((t) => t[key] == c[key]);
        if (match.length) {
          sources.push(object.info.title);
        }
      }

      throw new Error(
        `Conflicting ${list} detected: ${c[key]} (${sources.join(", ")})`
      );
    }
  }
}

function ensureNoTagColissions(objects) {
  ensureListUniqueness("tags", "name", objects);
}

function ensureNoSecurityColissions(objects) {
  let all = [];
  for (let object of objects) {
    all = all.concat(object.security || []);
  }

  all = all.map((s) => Object.entries(s)[0]);

  for (let c of all) {
    const d = all.filter((t) => {
      return t[0] == c[0] && !isEqual(c, t);
    });

    if (d.length > 0) {
      // Which files does this exist in?
      const sources = [];
      for (let object of objects) {
        if (!object.security) {
          continue;
        }

        const match = object.security.filter((t) => {
          const k = Object.keys(t)[0];
          return k == c[0];
        });

        if (match.length) {
          sources.push(object.info.title);
        }
      }

      throw new Error(
        `Conflicting security detected: ${c[0]} (${sources.join(", ")})`
      );
    }
  }
}

function ensureNoComplexObjectCollisions(objects) {
  const allPaths = {};
  for (let object of objects) {
    traverse(object).forEach(function () {
      if (
        ["oneOf", "allOf", "anyOf", "$ref", "properties"].includes(this.key)
      ) {
        const k = this.path.slice(0, -1).join(".");
        allPaths[k] = allPaths[k] || [];
        allPaths[k].push({
          key: this.key,
          file: object.info.title,
          value: this.node,
        });
      }
    });
  }

  for (let path in allPaths) {
    if (allPaths[path].length > 1) {
      const v = allPaths[path];

      // If all entries for this path use the same special key
      if (
        uniqWith(
          v.map((f) => f.key),
          isEqual
        ).length == 1
      ) {
        // Check if all the values are the same
        const values = v.map((f) => {
          // If it's a oneOf, order doesn't matter so sort for comparison
          if (f.key == "oneOf") {
            f.value.sort();
          }
          return f.value;
        });

        if (isEqual(...values)) {
          continue;
        }
      }

      throw new Error(
        `Conflicting complex object detected: ${path} (${v
          .map((f) => `${f.file}[${f.key}]`)
          .join(", ")})`
      );
    }
  }
}

module.exports = Object.assign(merge, {
  ensureNoComponentColissions,
  ensureNoPathColissions,
  ensureNoTagColissions,
  ensureNoSecurityColissions,
  ensureNoComplexObjectCollisions,
});
