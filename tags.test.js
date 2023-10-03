const t = require("./tags");

const tags = [
  {
    name: "One",
    description: "Tag Number One",
  },
  {
    name: "Two",
    description: "Tag Number One",
  },
  {
    name: "Three",
    description: "Tag Number One",
  },
];

const oas = {
  info: { title: "One" },
  security: [{ personalAccessToken: {} }],
  paths: {
    "/foo": {
      post: {
        operationId: "create-foo",
        tags: ["One"],
        requestBody: {
          $ref: "#/components/requestBodies/CreateFoo",
        },
        responses: {
          201: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Foo",
                },
              },
            },
          },
        },
      },
    },
  },
  tags,
};

describe("#tags", () => {
  it("extracts referenced tags", () => {
    expect(t.getReferencedTags(oas)).toEqual(["One"]);
  });

  it("returns unused tags (without unused)", () => {
    expect(t.getUnusedTags(["One", "Two"], ["Two", "One"])).toEqual([]);
  });

  it("returns unused tags (with unused)", () => {
    expect(t.getUnusedTags(["One", "Two"], ["Two"])).toEqual(["One"]);
  });

  it("returns all defined tags", () => {
    expect(t.getDefinedTags(oas)).toEqual(["One", "Two", "Three"]);
  });

  it("removes unused tags", () => {
    expect(t.removeUnusedTags(oas)).toEqual({
      info: { title: "One" },
      security: [{ personalAccessToken: {} }],
      paths: {
        "/foo": {
          post: {
            operationId: "create-foo",
            tags: ["One"],
            requestBody: {
              $ref: "#/components/requestBodies/CreateFoo",
            },
            responses: {
              201: {
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/Foo",
                    },
                  },
                },
              },
            },
          },
        },
      },
      tags: [{ name: "One", description: "Tag Number One" }],
    });
  });
});
