const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");

const {
  collectResolvedComponents,
  inlineComponentRefs,
  resolveJsonPointer,
} = require("./resolve-component-refs");

describe("resolve-component-refs", () => {
  let dir;

  const write = (name, document) => {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, yaml.dump(document));
    return filePath;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-component-refs-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("#resolveJsonPointer", () => {
    const document = {
      components: {
        schemas: { Pet: { type: "object" } },
        "a/b": { "c~d": 1 },
      },
    };

    it("returns the whole document for an empty pointer", () => {
      expect(resolveJsonPointer(document, "")).toBe(document);
      expect(resolveJsonPointer(document, "/")).toBe(document);
    });

    it("resolves nested pointers", () => {
      expect(resolveJsonPointer(document, "/components/schemas/Pet")).toEqual({
        type: "object",
      });
    });

    it("unescapes ~1 and ~0 segments", () => {
      expect(resolveJsonPointer(document, "/components/a~1b/c~0d")).toBe(1);
    });

    it("returns undefined for missing paths", () => {
      expect(resolveJsonPointer(document, "/components/missing/Pet")).toBe(undefined);
    });
  });

  describe("#collectResolvedComponents", () => {
    it("resolves external component refs", () => {
      write("shared.yaml", {
        components: { schemas: { Pet: { type: "object" } } },
      });
      const document = {
        paths: {
          "/pets": { get: { responses: { 200: { $ref: "./shared.yaml#/components/schemas/Pet" } } } },
        },
      };

      expect(collectResolvedComponents(path.join(dir, "root.yaml"), document)).toEqual([
        {
          type: "schemas",
          name: "Pet",
          definition: { type: "object" },
          source: "./shared.yaml#/components/schemas/Pet",
        },
      ]);
    });

    it("ignores internal refs in the root document", () => {
      const document = {
        paths: { "/pets": { $ref: "#/components/schemas/Pet" } },
        components: { schemas: { Pet: { type: "object" } } },
      };

      expect(collectResolvedComponents(path.join(dir, "root.yaml"), document)).toEqual([]);
    });

    it("ignores refs that do not point at a component", () => {
      write("shared.yaml", { paths: { "/pets": { get: {} } } });
      const document = { paths: { "/pets": { $ref: "./shared.yaml#/paths/~1pets" } } };

      expect(collectResolvedComponents(path.join(dir, "root.yaml"), document)).toEqual([]);
    });

    it("follows internal refs inside loaded definitions", () => {
      write("shared.yaml", {
        components: {
          schemas: {
            Pet: { type: "object", properties: { tag: { $ref: "#/components/schemas/Tag" } } },
            Tag: { type: "string" },
          },
        },
      });
      const document = { paths: { "/pets": { $ref: "./shared.yaml#/components/schemas/Pet" } } };

      const resolved = collectResolvedComponents(path.join(dir, "root.yaml"), document);

      expect(resolved.map(({ name }) => name)).toEqual(["Pet", "Tag"]);
      expect(resolved[1].definition).toEqual({ type: "string" });
    });

    it("follows chains of ref-only definitions", () => {
      write("a.yaml", { components: { schemas: { Pet: { $ref: "./b.yaml#/components/schemas/Pet" } } } });
      write("b.yaml", { components: { schemas: { Pet: { type: "object" } } } });
      const document = { paths: { "/pets": { $ref: "./a.yaml#/components/schemas/Pet" } } };

      const resolved = collectResolvedComponents(path.join(dir, "root.yaml"), document);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].definition).toEqual({ type: "object" });
    });

    it("resolves nested refs relative to the file they live in", () => {
      write("nested/a.yaml", {
        components: {
          schemas: { Pet: { properties: { tag: { $ref: "./b.yaml#/components/schemas/Tag" } } } },
        },
      });
      write("nested/b.yaml", { components: { schemas: { Tag: { type: "string" } } } });
      const document = { paths: { "/pets": { $ref: "./nested/a.yaml#/components/schemas/Pet" } } };

      const resolved = collectResolvedComponents(path.join(dir, "root.yaml"), document);

      expect(resolved.map(({ name }) => name)).toEqual(["Pet", "Tag"]);
    });

    it("skips refs to missing files", () => {
      const document = { paths: { "/pets": { $ref: "./missing.yaml#/components/schemas/Pet" } } };

      expect(collectResolvedComponents(path.join(dir, "root.yaml"), document)).toEqual([]);
    });

    it("does not loop forever on circular ref chains", () => {
      write("a.yaml", { components: { schemas: { Pet: { $ref: "./b.yaml#/components/schemas/Pet" } } } });
      write("b.yaml", { components: { schemas: { Pet: { $ref: "./a.yaml#/components/schemas/Pet" } } } });
      const document = { paths: { "/pets": { $ref: "./a.yaml#/components/schemas/Pet" } } };

      expect(collectResolvedComponents(path.join(dir, "root.yaml"), document)).toEqual([]);
    });

    it("reports each referenced component once", () => {
      write("shared.yaml", { components: { schemas: { Pet: { type: "object" } } } });
      const document = {
        paths: {
          "/pets": { $ref: "./shared.yaml#/components/schemas/Pet" },
          "/dogs": { $ref: "./shared.yaml#/components/schemas/Pet" },
        },
      };

      expect(collectResolvedComponents(path.join(dir, "root.yaml"), document)).toHaveLength(1);
    });
  });

  describe("#inlineComponentRefs", () => {
    it("returns the document unchanged when it has no components", () => {
      const document = { paths: {} };

      expect(inlineComponentRefs(path.join(dir, "root.yaml"), document)).toBe(document);
    });

    it("replaces ref-only components with their external definitions", () => {
      write("shared.yaml", { components: { schemas: { Pet: { type: "object" } } } });
      const document = {
        components: { schemas: { Pet: { $ref: "./shared.yaml#/components/schemas/Pet" } } },
      };

      const inlined = inlineComponentRefs(path.join(dir, "root.yaml"), document);

      expect(inlined.components.schemas.Pet).toEqual({ type: "object" });
    });

    it("replaces ref-only components with internal definitions", () => {
      const document = {
        components: {
          schemas: {
            Pet: { type: "object" },
            Animal: { $ref: "#/components/schemas/Pet" },
          },
        },
      };

      const inlined = inlineComponentRefs(path.join(dir, "root.yaml"), document);

      expect(inlined.components.schemas.Animal).toEqual({ type: "object" });
    });

    it("leaves components with sibling keys alongside $ref untouched", () => {
      const definition = { $ref: "#/components/schemas/Pet", description: "A pet" };
      const document = {
        components: { schemas: { Pet: { type: "object" }, Animal: definition } },
      };

      const inlined = inlineComponentRefs(path.join(dir, "root.yaml"), document);

      expect(inlined.components.schemas.Animal).toBe(definition);
    });

    it("leaves unresolvable refs untouched", () => {
      const definition = { $ref: "./missing.yaml#/components/schemas/Pet" };
      const document = { components: { schemas: { Pet: definition } } };

      const inlined = inlineComponentRefs(path.join(dir, "root.yaml"), document);

      expect(inlined.components.schemas.Pet).toBe(definition);
    });

    it("does not mutate the input document", () => {
      write("shared.yaml", { components: { schemas: { Pet: { type: "object" } } } });
      const document = {
        components: { schemas: { Pet: { $ref: "./shared.yaml#/components/schemas/Pet" } } },
      };

      inlineComponentRefs(path.join(dir, "root.yaml"), document);

      expect(document.components.schemas.Pet).toEqual({
        $ref: "./shared.yaml#/components/schemas/Pet",
      });
    });
  });
});
