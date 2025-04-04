#!/usr/bin/env node

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

yargs(hideBin(process.argv))
  .command(
    "merge <openapi...>",
    "merge the provided OpenAPI files",
    (yargs) => {
      yargs.option("move-path-to-operation", {
        demandOption: false,
        type: "boolean",
      });
    },
    require("./commands/merge")
  )
  .command(
    "check-conflicts <openapi> <...more.yaml>",
    "check for conflicting components, paths, tags, and security schemes",
    require("./commands/check-conflicts")
  )
  .command(
    "filter-annotation <openapi>",
    "keep/remove all paths with a specific annotation",
    (yargs) => {
      yargs.option("keep", {
        demandOption: false,
      });
      yargs.option("remove", {
        demandOption: false
      });
      yargs.positional("openapi", {
        require: true,
        describe: "the OpenAPI file to rewrite",
        type: "string",
      });
    },
    require("./commands/filter-annotation")
  )
  .command(
    "remove-unused-components <openapi>",
    "remove unused components from the provided OpenAPI file",
    require("./commands/remove-unused-components")
  )
  .command(
    "remove-unused-tags <openapi>",
    "remove unused tags from the provided OpenAPI file",
    require("./commands/remove-unused-tags")
  )
  .command(
    "remove-with-annotation <openapi>",
    "remove all paths/select paths/operations with a specific annotation from the provided OpenAPI file",
    (yargs) => {
      yargs.option("annotation", {
        demandOption: true,
      });
      yargs.option("remove-unused", {
        demandOption: false,
        type: "boolean",
      });
      yargs.positional("openapi", {
        require: true,
        describe: "the OpenAPI file to rewrite",
        type: "string",
      });
    },
    require("./commands/remove-with-annotation")
  )
  .command(
    "rewrite-path <openapi>",
    "rewrite paths in the provided OpenAPI file",
    (yargs) => {
      yargs.option("oldPath", {
        demandOption: true,
      });
      yargs.option("newPath", {
        demandOption: true,
      });
      yargs.positional("openapi", {
        require: true,
        describe: "the OpenAPI file to rewrite",
        type: "string",
      });
    },
    require("./commands/rewrite-path")
  )
  .command(
    "canonical-server <openapi>",
    "move the path from the servers block in to /paths",
    (yargs) => {
      yargs.positional("openapi", {
        require: true,
        describe: "the OpenAPI file to rewrite",
        type: "string",
      });
    },
    require("./commands/canonical-server")
  )
  .command(
    "expand-allof <openapi>",
    "Remove allOf usage from components.schemas by merging them in to a single entity",
    (yargs) => {
      yargs.positional("openapi", {
        require: true,
        describe: "the OpenAPI file to rewrite",
        type: "string",
      });
    },
    require("./commands/expand-allof")
  )
  .parse();
