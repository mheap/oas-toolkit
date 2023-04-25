const {
  ensureNoComponentColissions,
  ensureNoPathColissions,
} = require("./merger");
const merger = require("./merger");

const FooSchema = { type: "string" };
const BarSchema = { type: "boolean" };

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
