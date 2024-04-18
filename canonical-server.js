const isEqual = require("lodash.isequal");
const uniqWith = require("lodash.uniqwith");
const url = require("url");
function run(oas) {
  oas = JSON.parse(JSON.stringify(oas)); // Prevent modification of original object

  if (!oas.servers) {
    return oas;
  }

  // Extract the base path from servers
  const basePaths = uniqWith(
    oas.servers.map((server) => {
      const path = url.parse(server.url).pathname;
      if (path.slice(-1) === "/") {
        return path.slice(0, -1);
      }
      return path;
    }),
    isEqual
  );

  if (basePaths.length > 1) {
    throw new Error(
      `Base paths are different in the servers block. Found: ${basePaths.join(
        ", "
      )}`
    );
  }

  for (let path in oas.paths) {
    let newPath = basePaths[0] + path;
    oas.paths[newPath] = oas.paths[path];
    delete oas.paths[path];
  }

  // Remove paths from servers
  oas.servers = oas.servers.map((server) => {
    const u = url.parse(server.url);
    return {
      ...server,
      url: `${u.protocol}//${u.hostname}/`,
    };
  });

  return oas;
}

module.exports = {
  run,
};
