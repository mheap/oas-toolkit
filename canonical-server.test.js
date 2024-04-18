const c = require("./canonical-server");

const oas = {
  servers: [
    {
      url: "https://api.example.com/v1",
    },
  ],
  paths: {
    "/foo/hello": {},
    "/foo/world": {},
  },
};

function getOas(urls) {
  return {
    servers: urls.map((url) => {
      return {
        url,
      };
    }),
    paths: oas.paths,
  };
}

describe("#run", () => {
  it("prefixes all routes", () => {
    const o = getOas(["https://api.example.com/v1"]);
    expect(c.run(o).paths).toEqual({
      "/v1/foo/hello": {},
      "/v1/foo/world": {},
    });
  });

  it("handles multiple servers", () => {
    const o = getOas([
      "https://api.example.com/v1",
      "https://stagingapi.example.com/v1",
    ]);
    expect(c.run(o).paths).toEqual({
      "/v1/foo/hello": {},
      "/v1/foo/world": {},
    });
  });

  it("handles trailing slashes", () => {
    const o = getOas([
      "https://api.example.com/v1/",
      "https://stagingapi.example.com/v1/",
    ]);
    expect(c.run(o).paths).toEqual({
      "/v1/foo/hello": {},
      "/v1/foo/world": {},
    });
  });

  it("throws if the paths are different in a single OAS", () => {
    const o = getOas([
      "https://api.example.com/v1",
      "https://api.example.com/v2",
    ]);
    expect(() => c.run(o).paths).toThrow(
      "Base paths are different in the servers block. Found: /v1, /v2"
    );
  });

  it("rewrites the servers", () => {
    const o = getOas([
      "https://api.example.com/v1",
      "https://stagingapi.example.com/v1",
    ]);
    expect(c.run(o).servers).toEqual([
      { url: "https://api.example.com/" },
      { url: "https://stagingapi.example.com/" },
    ]);
  });
});
