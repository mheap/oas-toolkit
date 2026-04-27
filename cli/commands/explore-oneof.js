const fs = require("fs");
const http = require("http");
const open = require("open");

const { loadOpenApiDocument } = require("../lib/load-openapi");
const {
  buildOneOfExplorerModel,
  generateOneOfExplorerHtml,
} = require("../../explore-oneof");

module.exports = async function (argv) {
  try {
    const { spec } = loadOpenApiDocument(argv.openapi);
    const model = await buildOneOfExplorerModel(spec);
    const html = generateOneOfExplorerHtml(model);

    if (argv.output) {
      fs.writeFileSync(argv.output, html);
      console.log(`HTML written to ${argv.output}`);

      if (argv.open) {
        open(argv.output).catch((error) => {
          console.error(`Failed to open: ${error.message}`);
        });
      }
      return;
    }

    if (!argv.open) {
      console.log(html);
      return;
    }

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    });

    server.listen(4568, () => {
      const url = "http://localhost:4568";

      console.log(`Serving oneOf explorer at ${url}`);
      open(url).catch((error) => {
        console.error(`Failed to open: ${error.message}`);
      });

      process.on("SIGINT", () => {
        server.close();
        process.exit(0);
      });
    });
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
};
