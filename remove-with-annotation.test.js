const p = require("./remove-with-annotation");

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

describe("#remove-with-annotation", () => {
  describe("global", () => {
    it("removes a scalar global item", () => {
      const testOas = {
        "x-visibility": "internal",
        ...oas,
      };
      expect(p.remove(testOas, "x-visibility=internal")).toEqual({
        "x-visibility": "internal",
      });
    });

    it("removes a boolean global item", () => {
      const testOas = {
        "x-hidden": true,
        ...oas,
      };
      expect(p.remove(testOas, "x-hidden=true")).toEqual({
        "x-hidden": true,
      });
    });

    it("removes a nested global item", () => {
      const testOas = {
        "x-visibility": {
          publish: "INTERNAL",
        },
        ...oas,
      };
      expect(p.remove(testOas, "x-visibility.publish=INTERNAL")).toEqual({
        "x-visibility": {
          publish: "INTERNAL",
        },
      });
    });
  });

  describe("operation", () => {
    it("removes a nested operation item", () => {
      const testOas = {
        paths: {
          "/v1/foo/hello": {
            "x-visibility": {
              publish: "INTERNAL",
            },
            ...hello,
          },
          "/v1/foo/world": world,
        },
      };
      expect(p.remove(testOas, "x-visibility.publish=INTERNAL")).toEqual({
        paths: {
          "/v1/foo/world": world,
        },
      });
    });
  });

  describe("path", () => {
    it("removes a nested path item", () => {
      const testOas = {
        paths: {
          "/v1/foo/hello": {
            get: {
              "x-visibility": {
                publish: "INTERNAL",
              },
              ...hello.get,
            },
            post: hello.post,
          },
          "/v1/foo/world": world,
        },
      };
      expect(p.remove(testOas, "x-visibility.publish=INTERNAL")).toEqual({
        paths: {
          "/v1/foo/hello": {
            post: hello.post,
          },
          "/v1/foo/world": world,
        },
      });
    });
  });
});
