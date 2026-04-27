const fs = require("fs");
const os = require("os");
const yaml = require("js-yaml");

function expandHomePath(inputPath) {
  if (inputPath.startsWith("~/")) {
    return os.homedir() + inputPath.slice(1);
  }

  return inputPath;
}

function loadOpenApiDocument(openapiPath) {
  const resolvedPath = expandHomePath(openapiPath);
  const fileContent = fs.readFileSync(resolvedPath, "utf8");

  return {
    openapiPath: resolvedPath,
    spec: resolvedPath.endsWith(".json")
      ? JSON.parse(fileContent)
      : yaml.load(fileContent),
  };
}

module.exports = {
  expandHomePath,
  loadOpenApiDocument,
};
