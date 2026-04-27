const {
  buildOneOfExplorerModel,
  generateOneOfExplorerHtml,
} = require("./explore-oneof");

describe("explore-oneof", () => {
  it("detects oneOf usage throughout the spec and compares common and differing fields", async () => {
    const model = await buildOneOfExplorerModel({
      openapi: "3.0.0",
      info: {
        title: "Animals API",
      },
      paths: {
        "/pets": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/Cat" },
                      { $ref: "#/components/schemas/Dog" },
                    ],
                    discriminator: {
                      propertyName: "kind",
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          EventEnvelope: {
            oneOf: [
              {
                type: "object",
                properties: {
                  topic: { type: "string" },
                },
              },
              {
                type: "string",
                enum: ["heartbeat"],
              },
            ],
          },
          Cat: {
            type: "object",
            required: ["kind", "name"],
            properties: {
              kind: { type: "string", enum: ["cat"] },
              name: { type: "string" },
              age: { type: "integer" },
            },
          },
          Dog: {
            type: "object",
            required: ["kind"],
            properties: {
              kind: { type: "string", enum: ["dog"] },
              name: { type: "string" },
              barkVolume: { type: "integer" },
            },
          },
        },
      },
    });

    expect(model.specTitle).toBe("Animals API");
    expect(model.totalOneOfCount).toBe(2);

    const envelopeUsage = model.oneOfUsages.find((usage) => usage.path === "components.schemas.EventEnvelope");
    expect(envelopeUsage).toBeTruthy();
    expect(envelopeUsage.context.primaryLabel).toBe("EventEnvelope");
    expect(envelopeUsage.context.secondaryLabel).toBe("components.schemas");
    expect(envelopeUsage.fieldComparison.scope.skippedBranchLabels).toEqual(["heartbeat"]);

    const requestUsage = model.oneOfUsages.find((usage) => usage.path === 'paths["/pets"].post.requestBody.content["application/json"].schema');
    expect(requestUsage).toBeTruthy();
    expect(requestUsage.discriminator.propertyName).toBe("kind");
    expect(requestUsage.branchCount).toBe(2);
    expect(requestUsage.context.primaryLabel).toBe("POST /pets");
    expect(requestUsage.context.secondaryLabel).toBe("request body");
    expect(requestUsage.context.chips).toContain("application/json");

    expect(requestUsage.fieldComparison.sharedPaths.map((field) => field.path)).toEqual(["name"]);

    const catView = requestUsage.fieldComparison.branchViews.find((branch) => branch.label === "Cat");
    const dogView = requestUsage.fieldComparison.branchViews.find((branch) => branch.label === "Dog");

    expect(catView.uniqueSchema.map((entry) => entry.path)).toEqual(["kind"]);
    expect(catView.onlyHere.map((entry) => entry.path)).toEqual(["age"]);
    expect(catView.sharedWithSubset).toEqual([]);
    expect(dogView.uniqueSchema.map((entry) => entry.path)).toEqual(["kind"]);
    expect(dogView.onlyHere.map((entry) => entry.path)).toEqual(["barkVolume"]);
    expect(requestUsage.branches.map((branch) => branch.label)).toEqual(["Cat", "Dog"]);
  });

  it("groups shared schema variants inside differing fields", async () => {
    const model = await buildOneOfExplorerModel({
      openapi: "3.0.0",
      info: {
        title: "Providers API",
      },
      components: {
        schemas: {
          CreateProviderRequest: {
            oneOf: [
              { $ref: "#/components/schemas/Anthropic" },
              { $ref: "#/components/schemas/Azure" },
              { $ref: "#/components/schemas/Cerebras" },
            ],
          },
          Anthropic: {
            type: "object",
            required: ["config"],
            properties: {
              config: {
                type: "object",
                required: ["auth"],
                properties: {
                  auth: { type: "string" },
                },
              },
            },
          },
          Azure: {
            type: "object",
            required: ["config"],
            properties: {
              config: {
                type: "object",
                required: ["auth", "instance"],
                properties: {
                  auth: { type: "string" },
                  instance: { type: "string" },
                },
              },
            },
          },
          Cerebras: {
            type: "object",
            required: ["config"],
            properties: {
              config: {
                type: "object",
                required: ["auth"],
                properties: {
                  auth: { type: "string" },
                },
              },
            },
          },
        },
      },
    });

    const usage = model.oneOfUsages[0];
    const anthropicView = usage.fieldComparison.branchViews.find((branch) => branch.label === "Anthropic");
    const azureView = usage.fieldComparison.branchViews.find((branch) => branch.label === "Azure");

    expect(anthropicView.sharedWithSubset.map((entry) => entry.path)).toContain("config");
    expect(anthropicView.sharedWithSubset.find((entry) => entry.path === "config").peers).toEqual(["Cerebras"]);
    expect(azureView.uniqueSchema.map((entry) => entry.path)).toContain("config");
  });

  it("uses heuristic branch labels and disambiguates duplicates", async () => {
    const model = await buildOneOfExplorerModel({
      openapi: "3.0.0",
      info: {
        title: "Events API",
      },
      components: {
        schemas: {
          Event: {
            oneOf: [
              {
                type: "object",
                properties: {
                  type: { const: "created" },
                },
              },
              {
                type: "object",
                properties: {
                  type: { const: "created" },
                },
              },
            ],
          },
        },
      },
    });

    expect(model.oneOfUsages[0].branches.map((branch) => branch.label)).toEqual([
      "created",
      "created (2)",
    ]);
  });

  it("renders a self contained html explorer with search, layouts, and hash state", () => {
    const html = generateOneOfExplorerHtml({
      specTitle: "Pets",
      totalOneOfCount: 1,
      oneOfUsages: [
        {
          pointer: "#/components/schemas/Pet",
          id: "#/components/schemas/Pet",
          path: "components.schemas.Pet",
          context: {
            primaryLabel: "Pet",
            secondaryLabel: "components.schemas",
            chips: ["Schemas"],
          },
          branchCount: 2,
          discriminator: {
            propertyName: "kind",
            mappingCount: 0,
            mappingKeys: [],
          },
          fieldComparison: {
            scope: {
              totalBranches: 2,
              objectBranchCount: 2,
              skippedBranchLabels: [],
            },
            sharedPaths: [
              {
                path: "name",
                summary: { type: "string", propertyCount: 0 },
                requiredIn: ["Cat", "Dog"],
                optionalIn: [],
                branchSchemas: [],
                schema: { type: "string" },
              },
            ],
            branchViews: [
              {
                label: "Cat",
                totalPathCount: 2,
                onlyHere: [
                  {
                    path: "config.token",
                    summary: { type: "string", propertyCount: 0 },
                    required: true,
                    peers: [],
                    missingIn: ["Dog"],
                    schema: { type: "string" },
                  },
                ],
                uniqueSchema: [
                  {
                    path: "config",
                    summary: { type: "object", propertyCount: 1 },
                    required: true,
                    peers: [],
                    missingIn: [],
                    schema: { type: "object", properties: { token: { type: "string" } } },
                  },
                ],
                sharedWithSubset: [],
              },
              {
                label: "Dog",
                totalPathCount: 2,
                onlyHere: [
                  {
                    path: "config.instance",
                    summary: { type: "string", propertyCount: 0 },
                    required: true,
                    peers: [],
                    missingIn: ["Cat"],
                    schema: { type: "string" },
                  },
                ],
                uniqueSchema: [
                  {
                    path: "config",
                    summary: { type: "object", propertyCount: 2 },
                    required: true,
                    peers: [],
                    missingIn: [],
                    schema: { type: "object", properties: { token: { type: "string" }, instance: { type: "string" } } },
                  },
                ],
                sharedWithSubset: [],
              },
            ],
            nonSharedPathCount: 4,
          },
          branches: [
            {
              label: "Cat",
              ref: "#/components/schemas/Cat",
              summary: { type: "object", propertyCount: 2, oneOfCount: 0, allOfCount: 0, anyOfCount: 0 },
              isObjectLike: true,
              propertyCount: 2,
              requiredCount: 1,
              displaySchema: { type: "object" },
              rawDisplaySchema: { $ref: "#/components/schemas/Cat" },
            },
            {
              label: "Dog",
              ref: "#/components/schemas/Dog",
              summary: { type: "object", propertyCount: 2, oneOfCount: 0, allOfCount: 0, anyOfCount: 0 },
              isObjectLike: true,
              propertyCount: 2,
              requiredCount: 1,
              displaySchema: { type: "object" },
              rawDisplaySchema: { $ref: "#/components/schemas/Dog" },
            },
          ],
          rawOneOf: [{ $ref: "#/components/schemas/Cat" }, { $ref: "#/components/schemas/Dog" }],
        },
      ],
    });

    expect(html).toContain("Pets oneOf Explorer");
    expect(html).toContain("Search oneOf usage");
    expect(html).toContain("navigator.clipboard.writeText");
    expect(html).toContain("pointer");
    expect(html).toContain("layout");
    expect(html).toContain("compact");
    expect(html).toContain("Side by side");
    expect(html).toContain("Accordion");
    expect(html).toContain("Compact");
    expect(html).toContain("usage-context");
    expect(html).toContain("Show only unique variants");
    expect(html).toContain("Shared across all branches");
    expect(html).toContain("Only in");
    expect(html).toContain("config.instance");
    expect(html).toContain("variants");
    expect(html).toContain("[]");
  });
});
