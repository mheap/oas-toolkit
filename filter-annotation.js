const isEqual = require("lodash.isequal");
const uniqWith = require("lodash.uniqwith");
const url = require("url");
function run(oas, opts = {}) {
  oas = JSON.parse(JSON.stringify(oas)); // Prevent modification of original object

  for (const p of Object.keys(oas.paths)) {
    const path = oas.paths[p];
    for (const verb in path) {
      if (verb == "parameters") {
        continue; // Skip parameters
      }

      if (opts.keep?.length > 0) {
        const hasAnyKeep = opts.keep.some((keep) => path[verb][keep] !== undefined);
        if (!hasAnyKeep) {
          delete path[verb];
        }
      }

      if (opts.remove?.length > 0 && path[verb]) {
        const hasAnyRemove = opts.remove.some((remove) => path[verb][remove]);
        if (hasAnyRemove) {
          delete path[verb];
        }
      }
    }

    // Remove empty paths
    if (Object.keys(path).length === 0) {
      delete oas.paths[p];
    }

    // Also remove if only parameters remain
    if (Object.keys(path).length === 1 && path['parameters']) {
      delete oas.paths[p];
    }

  }

  return oas;
}

module.exports = {
  run,
};
