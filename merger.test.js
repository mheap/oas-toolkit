const {
  ensureNoComponentColissions,
  ensureNoPathColissions,
  ensureNoTagColissions,
  ensureNoSecurityColissions,
  ensureNoComplexObjectCollisions,
} = require("./merger");
const merger = require("./merger");

const FooSchema = { type: "string" };
const BarSchema = { type: "boolean" };

describe("#ensureNoTagColissions", () => {
  it("does not throw when there are no colissions", () => {
    expect(
      ensureNoTagColissions([
        { info: { title: "One" }, tags: [{ name: "Demo" }] },
        { info: { title: "Two" }, tags: [{ name: "Demo" }] },
      ])
    ).toBe(undefined);
  });

  it("throws with different descriptions", () => {
    expect(() => {
      ensureNoTagColissions([
        { info: { title: "One" }, tags: [{ name: "Demo", description: "Demo in One" }] },
        { info: { title: "Two" }, tags: [{ name: "Demo", description: "Demo in Two" }] },
      ])
    }).toThrow(new Error("Conflicting tags detected: Demo (One, Two)"))
  });

  it("respects overrides (x-bundled-name)", () => {
    expect(
      ensureNoTagColissions([
        { info: { title: "One" }, tags: [{ name: "Demo", description: "Demo in One", "x-bundled-name": "Demo One" }] },
        { info: { title: "Two" }, tags: [{ name: "Demo", description: "Demo in Two", "x-bundled-name": "Demo Two" }] },
      ])
    ).toBe(undefined);
  });

  it("respects overrides (x-name-override)", () => {
    expect(
      ensureNoTagColissions([
        { info: { title: "One" }, tags: [{ name: "Demo", description: "Demo in One", "x-name-override": "Demo One" }] },
        { info: { title: "Two" }, tags: [{ name: "Demo", description: "Demo in Two", "x-name-override": "Demo Two" }] },
      ])
    ).toBe(undefined);
  });

  it("throws when the override is the same", () => {
    expect(() => {
      ensureNoTagColissions([
        { info: { title: "One" }, tags: [{ name: "Demo One", description: "Demo in One", "x-bundled-name": "Demo" }] },
        { info: { title: "Two" }, tags: [{ name: "Demo Two", description: "Demo in Two", "x-bundled-name": "Demo" }] },
      ])
    }).toThrow(new Error("Conflicting tags detected: Demo (One, Two)"))
  });

  it("throws when there is a field in one tag but not in another", () => {
    expect(() => {
      ensureNoTagColissions([
        { info: { title: "One" }, tags: [{ name: "Demo" }] },
        {
          info: { title: "Two" },
          tags: [{ name: "Demo", description: "FOO" }],
        },
      ]);
    }).toThrow(new Error("Conflicting tags detected: Demo (One, Two)"));
  });

  it("throws when there is a difference in deeply nested fields", () => {
    expect(() => {
      ensureNoTagColissions([
        {
          info: { title: "One" },
          tags: [
            {
              name: "Demo",
              externalDocs: {
                description: "Hello",
                url: "https://example.com",
              },
            },
          ],
        },
        {
          info: { title: "Two" },
          tags: [
            {
              name: "Demo",
              externalDocs: {
                description: "Hello",
                url: "https://another.example.com",
              },
            },
          ],
        },
      ]);
    }).toThrow(new Error("Conflicting tags detected: Demo (One, Two)"));
  });
});

describe("#ensureNoSecurityColissions", () => {
  it("does not throw when there are no colissions", () => {
    expect(
      ensureNoSecurityColissions([
        { info: { title: "One" }, security: [{ appKey: [] }] },
        { info: { title: "Two" }, security: [{ appKey: [] }] },
      ])
    ).toBe(undefined);
  });

  it("throws when there is a field in one security but not in another", () => {
    expect(() => {
      ensureNoSecurityColissions([
        { info: { title: "One" }, security: [{ petstore_auth: [] }] },
        {
          info: { title: "Two" },
          security: [{ petstore_auth: ["pets:write"] }],
        },
      ]);
    }).toThrow(
      new Error("Conflicting security detected: petstore_auth (One, Two)")
    );
  });

  it("supports missing security", () => {
    expect(
      ensureNoSecurityColissions([
        { info: { title: "One" }, security: [{ appKey: [] }] },
        { info: { title: "Two" }, security: [{}] },
      ])
    ).toBe(undefined);
  });
});

describe("#ensureNoComponentColissions", () => {
  it("does not throw when schemas have different prefixes", () => {
    expect(
      ensureNoComponentColissions([
        { info: { title: "One" }, components: { schemas: { FooSchema } } },
        {
          info: { title: "Two" },
          components: { requestBodies: { FooSchema } },
        },
      ])
    ).toBe(undefined);
  });

  it("does not throw when schemas have different prefixes", () => {
    expect(
      ensureNoComponentColissions([
        { info: { title: "One" }, components: { schemas: { FooSchema } } },
        { info: { title: "Two" }, components: { schemas: { BarSchema } } },
      ])
    ).toBe(undefined);
  });

  it("does not throw when a conflicting schema is in the ignore list", () => {
    expect(
      ensureNoComponentColissions(
        [
          { info: { title: "One" }, components: { schemas: { FooSchema } } },
          { info: { title: "Two" }, components: { schemas: { FooSchema } } },
        ],
        { ignorePrefix: ["components.schemas"] }
      )
    ).toBe(undefined);
  });

  it("throws when two components have the same name", () => {
    expect(() => {
      ensureNoComponentColissions([
        { info: { title: "One" }, components: { schemas: { FooSchema } } },
        { info: { title: "Two" }, components: { schemas: { FooSchema } } },
      ]);
    }).toThrow(
      new Error(
        "Duplicate component detected: components.schemas.FooSchema (One, Two)"
      )
    );
  });

  it("throws when two components have the same name (multiple schemas)", () => {
    expect(() => {
      ensureNoComponentColissions([
        { info: { title: "One" }, components: { schemas: { BarSchema } } },
        {
          info: { title: "Two" },
          components: { schemas: { FooSchema, BarSchema } },
        },
      ]);
    }).toThrow(
      new Error(
        "Duplicate component detected: components.schemas.BarSchema (One, Two)"
      )
    );
  });
});

describe("#ensureNoComplexObjectCollisions", () => {
  it("throws when $ref is detected alongside other values", () => {
    expect(() => {
      ensureNoComplexObjectCollisions([
        {
          info: { title: "One" },
          components: {
            schemas: {
              DemoError: {
                type: "object",
                properties: {
                  code: {
                    type: "string",
                    example: "ERROR_ABC",
                  },
                },
              },
            },
          },
        },
        {
          info: { title: "Two" },
          components: {
            schemas: {
              DemoError: {
                $ref: "#/components/schemas/AnotherError",
              },
            },
          },
        },
      ]);
    }).toThrow(
      "Conflicting complex object detected: components.schemas.DemoError (One[properties], Two[$ref])"
    );
  });

  it("does not throw when refs point to the same component", () => {
    expect(() => {
      ensureNoComplexObjectCollisions([
        {
          info: { title: "One" },
          components: {
            schemas: {
              DemoError: {
                $ref: "#/components/schemas/AnotherError",
              },
            },
          },
        },
        {
          info: { title: "Two" },
          components: {
            schemas: {
              DemoError: {
                $ref: "#/components/schemas/AnotherError",
              },
            },
          },
        },
      ]);
    }).not.toThrow();
  });

  it("does not throw when oneOf point to the same component (order independent)", () => {
    expect(() => {
      ensureNoComplexObjectCollisions([
        {
          info: { title: "One" },
          components: {
            schemas: {
              DemoError: {
                oneOf: ["#/components/schemas/One", "#/components/schemas/Two"],
              },
            },
          },
        },
        {
          info: { title: "Two" },
          components: {
            schemas: {
              DemoError: {
                oneOf: ["#/components/schemas/Two", "#/components/schemas/One"],
              },
            },
          },
        },
      ]);
    }).not.toThrow();
  });

  it("throws when allOf values are provided in different orders", () => {
    expect(() => {
      ensureNoComplexObjectCollisions([
        {
          info: { title: "One" },
          components: {
            schemas: {
              DemoError: {
                allOf: ["#/components/schemas/One", "#/components/schemas/Two"],
              },
            },
          },
        },
        {
          info: { title: "Two" },
          components: {
            schemas: {
              DemoError: {
                allOf: ["#/components/schemas/Two", "#/components/schemas/One"],
              },
            },
          },
        },
      ]);
    }).toThrow(
      "Conflicting complex object detected: components.schemas.DemoError (One[allOf], Two[allOf])"
    );
  });

  it("throws when oneOf is detected alongside other values", () => {
    expect(() => {
      ensureNoComplexObjectCollisions([
        {
          info: { title: "One" },
          components: {
            schemas: {
              DemoError: {
                type: "object",
                properties: {
                  code: {
                    type: "string",
                    example: "ERROR_ABC",
                  },
                },
              },
            },
          },
        },
        {
          info: { title: "Two" },
          components: {
            schemas: {
              DemoError: {
                oneOf: ["#/components/schemas/AnotherError"],
              },
            },
          },
        },
      ]);
    }).toThrow(
      "Conflicting complex object detected: components.schemas.DemoError (One[properties], Two[oneOf])"
    );
  });
});

describe("path collisions", () => {
  it("does not throw with overlapping paths and different verbs", () => {
    expect(
      ensureNoPathColissions([
        { info: { title: "One" }, paths: { "/foo": { get: {} } } },
        { info: { title: "Two" }, paths: { "/foo": { post: {} } } },
      ])
    ).toBe(undefined);
  });

  it("throws when a path has multiple implementations for a verb (static)", () => {
    expect(() => {
      ensureNoPathColissions([
        { info: { title: "One" }, paths: { "/foo": { get: {} } } },
        { info: { title: "Two" }, paths: { "/foo": { get: {} } } },
      ]);
    }).toThrow(new Error("Duplicate path detected: GET /foo (One, Two)"));
  });

  it("throws when a path has multiple implementations for a verb (regex)", () => {
    expect(() => {
      ensureNoPathColissions([
        { info: { title: "One" }, paths: { "/users/{userId}": { get: {} } } },
        { info: { title: "Two" }, paths: { "/users/{id}": { get: {} } } },
      ]);
    }).toThrow(
      new Error("Duplicate path detected: GET /users/{VAR} (One, Two)")
    );
  });

  it("throws with multiple variables in the path", () => {
    expect(() => {
      ensureNoPathColissions([
        {
          info: { title: "One" },
          paths: { "/users/{userId}/purchases/{id}": { get: {} } },
        },
        {
          info: { title: "Two" },
          paths: {
            "/foo": { post: {} },
            "/users/{id}/purchases/{purchaseId}": { get: {} },
          },
        },
      ]);
    }).toThrow(
      new Error(
        "Duplicate path detected: GET /users/{VAR}/purchases/{VAR} (One, Two)"
      )
    );
  });
});

describe("uses the last provided value for:", () => {
  it("openapi", () => {
    expect(merger([{ openapi: "3.0.3" }, { openapi: "3.1.0" }])).toEqual({
      openapi: "3.1.0",
    });
  });

  it("info", () => {
    expect(
      merger([{ info: { title: "OAS One" } }, { info: { title: "OAS Two" } }])
    ).toEqual({ info: { title: "OAS Two" } });
  });

  it("servers", () => {
    expect(
      merger([
        {
          servers: [
            { url: "https://example.com", description: "My API Description" },
          ],
        },
        {
          servers: [
            {
              url: "https://api.example.com",
              description: "Overwritten value",
            },
          ],
        },
      ])
    ).toEqual({
      servers: [
        { url: "https://api.example.com", description: "Overwritten value" },
      ],
    });
  });
});

describe("concatenates values for:", () => {
  it("tags", () => {
    expect(
      merger([
        { tags: [{ name: "One", description: "Description one" }] },
        { tags: [{ name: "Two", description: "Description two" }] },
      ])
    ).toEqual({
      tags: [
        { name: "One", description: "Description one" },
        { name: "Two", description: "Description two" },
      ],
    });
  });

  it("paths", () => {
    expect(
      merger([
        {
          info: { title: "One" },
          paths: { "/users": { get: { operationId: "list-users" } } },
        },
        {
          info: { title: "Two" },
          paths: { "/users": { post: { operationId: "create-user" } } },
        },
      ])
    ).toMatchObject({
      paths: {
        "/users": {
          get: { operationId: "list-users" },
          post: { operationId: "create-user" },
        },
      },
    });
  });

  it("security", () => {
    expect(
      merger([
        { security: [{ basicAuth: { type: "http", scheme: "basic" } }] },
        {
          security: [
            {
              bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
              },
            },
          ],
        },
      ])
    ).toEqual({
      security: [
        { basicAuth: { type: "http", scheme: "basic" } },
        {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      ],
    });
  });
});

describe("returns unique items for:", () => {
  it("tags", () => {
    expect(
      merger([
        { tags: [{ name: "One", description: "Description one" }] },
        { tags: [{ name: "Two", description: "Description two" }] },
        { tags: [{ name: "One", description: "Description one" }] },
      ])
    ).toEqual({
      tags: [
        { name: "One", description: "Description one" },
        { name: "Two", description: "Description two" },
      ],
    });
  });

  it("security", () => {
    expect(
      merger([{ security: [{ appKey: [] }] }, { security: [{ appKey: [] }] }])
    ).toEqual({
      security: [{ appKey: [] }],
    });
  });

  it("handles keys that don't exist in both specs", () => {
    expect(
      merger([
        {
          openapi: "3.0.3",
          paths: {
            "/users": {
              get: {
                operationId: "list-users",
              },
            },
          },
        },
        {
          openapi: "3.0.2",
          info: {
            title: "Two",
          },
        },
      ])
    ).toEqual({
      openapi: "3.0.2",
      info: {
        title: "Two",
      },
      paths: {
        "/users": {
          get: {
            operationId: "list-users",
          },
        },
      },
    });
  });

  it("oneOf", () => {
    expect(
      merger([
        {
          components: {
            schemas: {
              DemoError: {
                oneOf: [
                  { $ref: "#/components/schemas/One" },
                  { $ref: "#/components/schemas/Two" },
                  { $ref: "#/components/schemas/Three" },
                ],
              },
            },
          },
        },
        {
          components: {
            schemas: {
              DemoError: {
                oneOf: [
                  { $ref: "#/components/schemas/One" },
                  { $ref: "#/components/schemas/Two" },
                  { $ref: "#/components/schemas/Four" },
                ],
              },
              AnotherError: {
                $ref: "#/components/schemas/One",
              },
            },
          },
        },
      ])
    ).toEqual({
      components: {
        schemas: {
          DemoError: {
            oneOf: [
              { $ref: "#/components/schemas/One" },
              { $ref: "#/components/schemas/Two" },
              { $ref: "#/components/schemas/Three" },
              { $ref: "#/components/schemas/Four" },
            ],
          },
          AnotherError: {
            $ref: "#/components/schemas/One",
          },
        },
      },
    });
  });

  it("allOf", () => {
    expect(
      merger([
        {
          components: {
            schemas: {
              DemoError: {
                allOf: [{ $ref: "#/components/schemas/One" }],
              },
            },
          },
        },
        {
          components: {
            schemas: {
              DemoError: {
                allOf: [{ $ref: "#/components/schemas/One" }],
              },
            },
          },
        },
      ])
    ).toEqual({
      components: {
        schemas: {
          DemoError: {
            allOf: [{ $ref: "#/components/schemas/One" }],
          },
        },
      },
    });
  });

  it("anyOf", () => {
    expect(
      merger([
        {
          components: {
            schemas: {
              DemoError: {
                allOf: [{ $ref: "#/components/schemas/One" }],
              },
            },
          },
        },
        {
          components: {
            schemas: {
              DemoError: {
                allOf: [{ $ref: "#/components/schemas/One" }],
              },
            },
          },
        },
      ])
    ).toEqual({
      components: {
        schemas: {
          DemoError: {
            allOf: [{ $ref: "#/components/schemas/One" }],
          },
        },
      },
    });
  });
});
