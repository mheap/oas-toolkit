const get = require("lodash.get");
function remove(oas, annotation) {
  oas = JSON.parse(JSON.stringify(oas)); // Prevent modification of original object
  let [key, value] = annotation.split("=");

  // Coerce booleans in value
  if (value === "true") {
    value = true;
  }
  if (value === "false") {
    value = false;
  }

  // Remove at a global level
  if (get(oas, key) === value) {
    delete oas.paths;
  }

  // Remove at an operation level
  for (let operation in oas.paths) {
    if (get(oas.paths[operation], key) === value) {
      delete oas.paths[operation];
    }

    // Remove at a path level
    for (let path in oas.paths[operation]) {
      if (get(oas.paths[operation][path], key) === value) {
        delete oas.paths[operation][path];
      }

      // If the operation is now empty, remove it
      if (Object.keys(oas.paths[operation]).length === 0) {
        delete oas.paths[operation];
      }
    }
  }

  return oas;
}

module.exports = {
  remove,
};
