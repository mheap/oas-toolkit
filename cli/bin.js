#!/usr/bin/env node

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

yargs(hideBin(process.argv))
  .command(
    "merge <openapi.yaml> <...more.yaml>",
    "merge the provided OpenAPI files",
    require("./commands/merge")
  )
  .command(
    "check-conflicts <openapi.yaml> <...more.yaml>",
    "check for conflicting components, paths, tags, and security schemes",
    require("./commands/check-conflicts")
  )
  .command(
    "remove-unused-components <openapi.yaml>",
    "remove unused components from the provided OpenAPI file",
    require("./commands/remove-unused-components")
  )
  .command(
    "remove-unused-tags <openapi.yaml>",
    "remove unused tags from the provided OpenAPI file",
    require("./commands/remove-unused-tags")
  )
  .command(
    "rewrite-path <openapi.yaml> --oldPrefix '^/v1' --newPrefix '/v2'",
    "rewrite paths in the provided OpenAPI file",
    require("./commands/rewrite-path")
  )
  .parse();
