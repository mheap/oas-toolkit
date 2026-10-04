const traverse = require("traverse");
const isEqual = require("lodash.isequal");
const uniqWith = require("lodash.uniqwith");

const arrayBehaviour = {
  openapi: "overwrite",
  info: "overwrite",
  servers: "overwrite",
  externalDocs: "overwrite",
};

function deepMergeWithSpread(obj1, obj2) {
  const result = { ...obj1 };

  for (let key in obj2) {
    if (obj2.hasOwnProperty(key)) {
      if (obj2[key] instanceof Array && result[key] instanceof Array) {
        let mode = "append";
        if (arrayBehaviour[key]) {
          mode = arrayBehaviour[key];
        }
        if (mode === "append" && result[key]) {
          result[key] = result[key].concat(obj2[key]);
          result[key] = uniqWith(result[key], isEqual);
        } else {
          result[key] = obj2[key];
        }
      } else if (obj2[key] instanceof Object && obj1[key] instanceof Object) {
        result[key] = deepMergeWithSpread(obj1[key], obj2[key]);
      } else {
        result[key] = obj2[key];
      }
    }
  }

  return result;
}

function merge(objects) {
  let combinedSpec = objects[0];

  for (let i = 1; i < objects.length; i++) {
    combinedSpec = deepMergeWithSpread(combinedSpec, objects[i]);
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
      this.update(uniqWith(this.node, isEqual));
    }
  });

  return combinedSpec;
}

function normalizeIgnorePrefix(options) {
  const ignorePrefix = options && options.ignorePrefix;
  if (!ignorePrefix) {
    return [];
  }
  return typeof ignorePrefix === "string" ? [ignorePrefix] : ignorePrefix;
}

// Returns components with multiple definitions across documents.
// Pass the same documents going to the merger. If bundled before merging, pass
// bundled versions so inlined components are visible. Returns { type, name, entries }.
// Options: ignorePrefix (skip paths), ignoreIdentical (drop if all defs identical).
function findComponentCollisions(objects, options) {
  options = options || {};
  const prefixes = normalizeIgnorePrefix(options);
  const ignoreIdentical = Boolean(options.ignoreIdentical);

  const registry = new Map();

  for (const object of objects || []) {
    if (!object || !object.components || typeof object.components !== "object") {
      continue;
    }
    const title = object.info ? object.info.title : undefined;

    for (const [type, definitions] of Object.entries(object.components)) {
      if (
        !definitions ||
        typeof definitions !== "object" ||
        Array.isArray(definitions)
      ) {
        continue;
      }

      for (const [originalName, definition] of Object.entries(definitions)) {
        const key = `components.${type}.${originalName}`;
        if (prefixes.some((prefix) => key.startsWith(prefix))) {
          continue;
        }

        if (!registry.has(key)) {
          registry.set(key, { type, name: originalName, entries: [] });
        }
        registry.get(key).entries.push({ title, originalName, definition });
      }
    }
  }

  const collisions = [];
  for (const { type, name, entries } of registry.values()) {
    if (entries.length < 2) {
      continue;
    }

    // With ignoreIdentical, drop collisions where every spec defines the component
    // the same way (key order is ignored by isEqual).
    const [first, ...rest] = entries;
    if (
      ignoreIdentical &&
      rest.every((entry) => isEqual(entry.definition, first.definition))
    ) {
      continue;
    }
    collisions.push({ type, name, entries });
  }

  return collisions;
}

function formatComponentCollisions(collisions) {
  return collisions
    .map((collision) => {
      const sources = collision.entries.map((entry) => entry.title);
      return `Duplicate component detected: components.${collision.type}.${
        collision.name
      } (${sources.join(", ")})`;
    })
    .join("\n");
}

function ensureNoComponentColissions(objects, options) {
  const collisions = findComponentCollisions(objects, options);
  if (collisions.length > 0) {
    throw new Error(formatComponentCollisions(collisions));
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
        // Only qualify the key with servers when they're set, so specs without
        // servers keep the original `VERB /path` message.
        const servers = object.servers ? object.servers.map((s) => s.url).join(",") : "";
        const k = `${verb.toUpperCase()} ${normalisedPath}${servers ? ` @ ${servers}` : ""}`;
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

function ensureListUniqueness(list, keys, objects) {
  let all = [];

  for (let object of objects) {
    all = all.concat(object[list] || []);
  }

  // Update the key based on overrides
  const key = keys[0];
  keys = keys.slice(1);
  all = all.map((s) => {
    if (keys.length) {
      const newKey = keys.find((k) => s[k]);
      if (newKey) {
        s[key] = s[newKey];
      }
    }
    return s;
  });

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
  ensureListUniqueness("tags", ["name", "x-bundled-name", "x-name-override"], objects);
}

function ensureNoSecurityColissions(objects) {
  let all = [];
  for (let object of objects) {
    all = all.concat(object.security || []);
  }

  all = all.map((s) => Object.entries(s)[0]).filter(Boolean);

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

function ensureNoComplexObjectCollisions(objects, options) {
  const prefixes = normalizeIgnorePrefix(options);
  const allPaths = {};
  for (let object of objects) {
    traverse(object).forEach(function () {
      if (
        ["oneOf", "allOf", "anyOf", "$ref", "properties"].includes(this.key)
      ) {
        const k = this.path.slice(0, -1).join(".");
        if (prefixes.some((prefix) => k.startsWith(prefix))) {
          return;
        }
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

        if (values.every((v) => isEqual(v, values[0]))) {
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
  findComponentCollisions,
  formatComponentCollisions,
  ensureNoComponentColissions,
  ensureNoPathColissions,
  ensureNoTagColissions,
  ensureNoSecurityColissions,
  ensureNoComplexObjectCollisions,
});
