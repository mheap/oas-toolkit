const mergician = require("mergician");

function merge(...objects) {
  ensureNoComponentColissions(objects);
  ensureNoPathColissions(objects);

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

  return combinedSpec;
}

function mergeSection(spec, merger, objects, section) {
  return Object.assign(
    spec,
    merger.apply(
      null,
      objects
        .map((o) => {
          if (!o[section]) {
            return null;
          }
          const r = {};
          r[section] = o[section];
          return r;
        })
        .filter(Boolean)
    )
  );
}

function ensureNoComponentColissions(objects) {
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
    const value = componentList[component];
    if (value.length > 1) {
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

module.exports = Object.assign(merge, {
  ensureNoComponentColissions,
  ensureNoPathColissions,
});
