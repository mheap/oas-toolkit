const path = require("path");
const os = require("os");

const { expandHomePath, loadOpenApiDocument } = require("./load-openapi");

describe("load-openapi", () => {
  it("expands tilde to the home directory", () => {
    expect(expandHomePath("~/test.yaml")).toBe(path.join(os.homedir(), "test.yaml"));
  });

  it("loads yaml openapi files", () => {
    const { spec } = loadOpenApiDocument(path.join(__dirname, "..", "commands", "__fixtures__", "sample-openapi.yaml"));

    expect(spec.info.title).toBe("Fixture API");
    expect(spec.paths["/pets"]).toBeTruthy();
  });

  it("loads json openapi files", () => {
    const { spec } = loadOpenApiDocument(path.join(__dirname, "..", "commands", "__fixtures__", "sample-openapi.json"));

    expect(spec.info.title).toBe("Fixture API JSON");
    expect(spec.components.schemas.Pet.type).toBe("object");
  });
});
