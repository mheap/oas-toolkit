const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const yaml = require("js-yaml");
const open = require("open");

module.exports = function (argv) {
  try {
    let openapiPath = argv.openapi;

    if (openapiPath.startsWith("~/")) {
      openapiPath = require("os").homedir() + openapiPath.slice(1);
    }
    const outputPath = argv.output;

    let spec;
    const fileContent = fs.readFileSync(openapiPath, "utf8");

    if (openapiPath.endsWith(".json")) {
      spec = JSON.parse(fileContent);
    } else {
      spec = yaml.load(fileContent);
    }

    const specString = JSON.stringify(spec);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: Arial, sans-serif; }
  </style>
  <title>${spec.info?.title || "OpenAPI Spec"}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kong/spec-renderer@^1/dist/spec-renderer.css" />
  <script type="module">
    import { registerKongSpecRenderer } from 'https://cdn.jsdelivr.net/npm/@kong/spec-renderer@^1/dist/kong-spec-renderer.web-component.es.js';
    registerKongSpecRenderer();
    const spec = ${specString};
    document.querySelector('kong-spec-renderer').spec = spec;
  </script>
</head>
<body>
  <kong-spec-renderer show-powered-by="true"></kong-spec-renderer>
</body>
</html>`;

    if (outputPath) {
      fs.writeFileSync(outputPath, html);
      console.log(`HTML written to ${outputPath}`);

      if (argv.open) {
        open(outputPath).catch((e) => {
          console.error(`Failed to open: ${e.message}`);
        });
      }
      return;
    }

    if (argv.open) {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });

      server.listen(4567, () => {
        const port = 4567;
        const url = `http://localhost:${port}`;
        console.log(`Serving preview at ${url}`);
        open(url).catch((e) => {
          console.error(`Failed to open: ${e.message}`);
        });

        process.on("SIGINT", () => {
          server.close();
          process.exit(0);
        });
      });
    } else {
      console.log(html);
    }
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};