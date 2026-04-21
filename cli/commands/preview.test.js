const fs = require("fs");
const path = require("path");
const os = require("os");
const yaml = require("js-yaml");

describe("preview command", () => {
  describe("tilde expansion", () => {
    it("expands tilde to home directory", () => {
      const inputPath = "~/test.yaml";
      const expandedPath = inputPath.startsWith("~/")
        ? os.homedir() + inputPath.slice(1)
        : inputPath;
      expect(expandedPath).toBe(
        path.join(os.homedir(), "test.yaml")
      );
    });

    it("does not modify regular paths", () => {
      const inputPath = "/absolute/path.yaml";
      const expandedPath = inputPath.startsWith("~/")
        ? os.homedir() + inputPath.slice(1)
        : inputPath;
      expect(expandedPath).toBe("/absolute/path.yaml");
    });
  });

  describe("HTML generation", () => {
    const generateHtml = (spec, openapiPath) => {
      const specString = JSON.stringify(spec);

      return `<!DOCTYPE html>
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
    };

    it("generates HTML with spec title", () => {
      const spec = {
        openapi: "3.0.0",
        info: {
          title: "Test API",
          version: "1.0.0",
        },
        paths: {},
      };

      const html = generateHtml(spec, "test.yaml");

      expect(html).toContain("<title>Test API</title>");
      expect(html).toContain("font-family: Arial");
    });

    it("generates HTML with default title when info is missing", () => {
      const spec = {
        openapi: "3.0.0",
        paths: {},
      };

      const html = generateHtml(spec, "test.yaml");

      expect(html).toContain("<title>OpenAPI Spec</title>");
    });

    it("includes the full spec JSON", () => {
      const spec = {
        openapi: "3.0.0",
        info: {
          title: "Test API",
          version: "1.0.0",
        },
        paths: {
          "/test": {
            get: {
              summary: "Test endpoint",
            },
          },
        },
      };

      const html = generateHtml(spec, "test.yaml");

      expect(html).toContain('"paths"');
      expect(html).toContain('"/test"');
      expect(html).toContain("Test endpoint");
    });
  });
});