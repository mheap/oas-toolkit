const isEqual = require("lodash.isequal");
const uniqWith = require("lodash.uniqwith");
const url = require("url");
function run(oas, opts = {}) {
  oas = JSON.parse(JSON.stringify(oas)); // Prevent modification of original object

  for (const p of Object.keys(oas.paths)) {
    const path = oas.paths[p];
    for (const verb in path) {
      if (opts.keep?.length > 0) {
        for (const keep of opts.keep) {
          if (path[verb][keep] === undefined) {
            delete path[verb];
          }
        }
      }

      if (opts.remove?.length > 0) {
        for (const remove of opts.remove) {
          if (path[verb][remove]) {
            delete path[verb];
          }
        }
      }
    }

    // Remove empty paths
    if (Object.keys(path).length === 0) {
      delete oas.paths[p];
    }
  }

  return oas;
}

module.exports = {
  run,
};
