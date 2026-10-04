const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");

const checkConflicts = require("./check-conflicts");

describe("check-conflicts command", () => {
  let dir;
  let exitSpy;
  let errorSpy;

  const write = (name, document) => {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, yaml.dump(document));
    return filePath;
  };

  const spec = (title, extra = {}) => ({
    openapi: "3.0.0",
    info: { title, version: "1.0.0" },
    paths: {},
    ...extra,
  });

  const errorOutput = () => errorSpy.mock.calls.map((c) => c[0]).join("\n");

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-conflicts-"));
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does nothing when fewer than two files are given", async () => {
    const a = write("a.yaml", spec("A"));

    await checkConflicts({ openapi: a });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("passes for specs with no conflicts", async () => {
    const a = write("a.yaml", spec("A", { components: { schemas: { Foo: { type: "object" } } } }));
    const b = write("b.yaml", spec("B", { components: { schemas: { Bar: { type: "object" } } } }));

    await checkConflicts({ openapi: a, more: [b] });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("accepts a single string for more", async () => {
    const a = write("a.yaml", spec("A"));
    const b = write("b.yaml", spec("B"));

    await checkConflicts({ openapi: a, more: b });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits with an error for duplicate components", async () => {
    const a = write("a.yaml", spec("A", { components: { schemas: { Foo: { type: "object" } } } }));
    const b = write("b.yaml", spec("B", { components: { schemas: { Foo: { type: "object" } } } }));

    await checkConflicts({ openapi: a, more: [b] });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("Duplicate component detected: components.schemas.Foo (A, B)");
  });

  it("ignores identical duplicates with ignoreIdentical", async () => {
    const a = write("a.yaml", spec("A", { components: { schemas: { Foo: { type: "object" } } } }));
    const b = write("b.yaml", spec("B", { components: { schemas: { Foo: { type: "object" } } } }));

    await checkConflicts({ openapi: a, more: [b], ignoreIdentical: true });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("still reports divergent duplicates with ignoreIdentical", async () => {
    const a = write("a.yaml", spec("A", { components: { schemas: { Foo: { type: "object" } } } }));
    const b = write("b.yaml", spec("B", { components: { schemas: { Foo: { type: "string" } } } }));

    await checkConflicts({ openapi: a, more: [b], ignoreIdentical: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("components.schemas.Foo");
  });

  it("skips components matching ignorePrefix", async () => {
    const a = write("a.yaml", spec("A", { components: { securitySchemes: { Auth: { type: "http", scheme: "bearer" } } } }));
    const b = write("b.yaml", spec("B", { components: { securitySchemes: { Auth: { type: "http", scheme: "bearer" } } } }));

    await checkConflicts({ openapi: a, more: [b], ignorePrefix: ["components.securitySchemes"] });

    expect(errorOutput()).not.toContain("components.securitySchemes.Auth");
  });

  it("exits with an error for duplicate paths", async () => {
    const a = write("a.yaml", spec("A", { paths: { "/pets": { get: {} } } }));
    const b = write("b.yaml", spec("B", { paths: { "/pets": { get: {} } } }));

    await checkConflicts({ openapi: a, more: [b] });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("/pets");
  });

  it("detects divergent definitions reached through external $refs", async () => {
    fs.writeFileSync(
      path.join(dir, "shared.yaml"),
      yaml.dump({ components: { schemas: { Pet: { type: "string" } } } })
    );
    const a = write(
      "a.yaml",
      spec("A", { paths: { "/a": { $ref: "./shared.yaml#/components/schemas/Pet" } } })
    );
    const b = write("b.yaml", spec("B", { components: { schemas: { Pet: { type: "object" } } } }));

    await checkConflicts({ openapi: a, more: [b] });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("components.schemas.Pet");
  });

  it("does not report external $refs that match the other spec's definition", async () => {
    fs.writeFileSync(
      path.join(dir, "shared.yaml"),
      yaml.dump({ components: { schemas: { Pet: { type: "object" } } } })
    );
    const a = write(
      "a.yaml",
      spec("A", { paths: { "/a": { $ref: "./shared.yaml#/components/schemas/Pet" } } })
    );
    const b = write("b.yaml", spec("B", { components: { schemas: { Pet: { type: "object" } } } }));

    await checkConflicts({ openapi: a, more: [b] });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits with an error when a file cannot be read", async () => {
    const a = write("a.yaml", spec("A"));

    await checkConflicts({ openapi: a, more: [path.join(dir, "missing.yaml")] });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("ERROR:");
  });
});
