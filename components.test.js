const c = require("./components");

const components = {
  securitySchemes: {
    personalAccessToken: {
      type: "http",
      scheme: "bearer",
    },
  },
  schemas: {
    Foo: {
      type: "object",
      properties: {
        bar: { type: "string" },
        created_at: { type: "string" },
      },
    },
    Baz: {
      type: "object",
      properties: {
        bee: { type: "string" },
      },
    },
  },
  requestBodies: {
    CreateFoo: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              bar: { type: "string" },
            },
          },
        },
      },
    },
  },
};

const oas = {
  info: { title: "One" },
  security: [{ personalAccessToken: {} }],
  paths: {
    "/foo": {
      post: {
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
  components,
};

describe("#components", () => {
  it("extracts referenced components", () => {
    expect(c.getReferencedComponents(oas)).toEqual([
      "components.requestBodies.CreateFoo",
      "components.schemas.Foo",
      "components.securitySchemes.personalAccessToken",
    ]);
  });

  it("returns unused components (without unused)", () => {
    expect(
      c.getUnusedComponents(
        ["components.schemas.Foo", "components.schemas.Baz"],
        ["components.schemas.Baz", "components.schemas.Foo"]
      )
    ).toEqual([]);
  });

  it("returns unused components (with unused)", () => {
    expect(
      c.getUnusedComponents(
        ["components.schemas.Foo", "components.schemas.Baz"],
        ["components.schemas.Baz"]
      )
    ).toEqual(["components.schemas.Foo"]);
  });

  it("returns all defined components)", () => {
    expect(c.getDefinedComponents(oas)).toEqual([
      "components.securitySchemes.personalAccessToken",
      "components.schemas.Foo",
      "components.schemas.Baz",
      "components.requestBodies.CreateFoo",
    ]);
  });

  it("removed unused components including parent", () => {
    expect(
      c.removeSpecifiedComponents({ components }, [
        "components.requestBodies.CreateFoo",
      ])
    ).toEqual({
      components: {
        securitySchemes: {
          personalAccessToken: {
            type: "http",
            scheme: "bearer",
          },
        },
        schemas: {
          Foo: {
            properties: {
              bar: { type: "string" },
              created_at: { type: "string" },
            },
            type: "object",
          },
          Baz: {
            type: "object",
            properties: {
              bee: { type: "string" },
            },
          },
        },
      },
    });
  });

  it("removed unused components but leaves the parent", () => {
    expect(
      c.removeSpecifiedComponents({ components }, ["components.schemas.Foo"])
    ).toEqual({
      components: {
        securitySchemes: {
          personalAccessToken: {
            type: "http",
            scheme: "bearer",
          },
        },
        schemas: {
          Baz: {
            type: "object",
            properties: {
              bee: { type: "string" },
            },
          },
        },
        requestBodies: {
          CreateFoo: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    bar: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it("autodiscovers and removes unused components", () => {
    expect(c.removeUnusedComponents(oas)).toEqual({
      info: { title: "One" },
      security: [{ personalAccessToken: {} }],
      paths: {
        "/foo": {
          post: {
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
      components: {
        schemas: {
          Foo: {
            type: "object",
            properties: {
              bar: { type: "string" },
              created_at: { type: "string" },
            },
          },
        },
        securitySchemes: {
          personalAccessToken: {
            type: "http",
            scheme: "bearer",
          },
        },
        requestBodies: {
          CreateFoo: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    bar: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it("removes unused security schemes", () => {
    const securityOas = {
      info: { title: "One" },
      security: [{ personalAccessToken: {} }],
      components: {
        securitySchemes: {
          personalAccessToken: {
            type: "http",
            scheme: "bearer",
          },
          systemAccessToken: {
            type: "http",
            scheme: "bearer",
          },
        },
      },
    };

    expect(c.removeUnusedComponents(securityOas)).toEqual({
      info: { title: "One" },
      security: [{ personalAccessToken: {} }],
      components: {
        securitySchemes: {
          personalAccessToken: {
            type: "http",
            scheme: "bearer",
          },
        },
      },
    });
  });
});
