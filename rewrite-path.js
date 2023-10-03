function regex(oas, oldPrefix, newPrefix) {
  oldPrefix = new RegExp(oldPrefix);
  oas = JSON.parse(JSON.stringify(oas)); // Prevent modification of original object
  for (let path in oas.paths) {
    if (path.match(oldPrefix)) {
      const newPath = path.replace(oldPrefix, newPrefix);
      oas.paths[newPath] = oas.paths[path];
      delete oas.paths[path];
    }
  }
  return oas;
}

module.exports = {
  regex,
};
