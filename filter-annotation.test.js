const c = require("./filter-annotation");

const oas = {
  servers: [
    {
      url: "https://api.example.com/v1",
    },
  ],
  paths: {
    "/foo/hello": {
      get: {
        "x-internal": true,
        description: "Hello world endpoint",
      },
      post: {
        description: "Create a hello world",
      },
    },
  },
};


describe("#run", () => {
  it("with keep", () => {
    expect(c.run(oas, { keep: ["x-internal"] }).paths).toEqual({
      "/foo/hello": {
        get: {
          "x-internal": true,
          description: "Hello world endpoint",
        },
      },
    });
  });

  it("with remove", () => {
    expect(c.run(oas, { remove: ["x-internal"] }).paths).toEqual({
      "/foo/hello": {
        post: {
          description: "Create a hello world",
        },
      },
    });
  });

  it("removes empty paths", () => {
    expect(c.run(oas, { keep: ["x-missing"] }).paths).toEqual({});
  });
});
