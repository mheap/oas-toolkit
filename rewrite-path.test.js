const p = require("./rewrite-path");

const hello = {
  post: {
    operationId: "create-hello",
    requestBody: {
      $ref: "#/components/requestBodies/CreateHello",
    },
    responses: {},
  },
  get: {
    operationId: "get-hello",
    responses: {},
  },
};

const world = {
  get: {
    operationId: "create-world",
    requestBody: {
      $ref: "#/components/requestBodies/CreateWorld",
    },
    responses: {},
  },
};

const oas = {
  paths: {
    "/v1/foo/hello": hello,
    "/v1/foo/world": world,
  },
};

describe("#rewrite-path", () => {
  it("rewrites a prefix", () => {
    expect(p.regex(oas, "^/v1", "/v2")).toEqual({
      paths: {
        "/v2/foo/hello": hello,
        "/v2/foo/world": world,
      },
    });
  });

  it("rewrites anywhere in the string", () => {
    expect(p.regex(oas, "/foo", "/bar")).toEqual({
      paths: {
        "/v1/bar/hello": hello,
        "/v1/bar/world": world,
      },
    });
  });

  it("does not rewrite non-matching regex", () => {
    expect(p.regex(oas, "^/foo", "/bar")).toEqual({
      paths: {
        "/v1/foo/hello": hello,
        "/v1/foo/world": world,
      },
    });
  });
});
