#!/usr/bin/env node

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

yargs(hideBin(process.argv))
  .command(
    "merge <openapi.yaml> <...more.yaml>",
    "merge the provided OpenAPI files",
    require("./commands/merge")
  )
  .parse();
