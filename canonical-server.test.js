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

function getOas(urls, variables) {
  const o = {
    paths: oas.paths,
  };

  if (urls.length > 0) {
    o.servers = urls.map((url) => {
      if (variables) {
        return {
          url,
          variables,
        };
      }

      return {
        url,
      };
    });
  }
  return o;
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

  it("ignores empty server blocks", () => {
    const o = getOas([]);
    expect(c.run(o)).toEqual({
      paths: {
        "/foo/hello": {},
        "/foo/world": {},
      },
    });
  });

  it("ignores variable based urls", () => {
    const vars = {
      hostname: {
        default: "localhost",
        description: "Hostname for Kong's Admin API",
      },
      path: {
        default: "/",
        description: "Base path for Kong's Admin API",
      },
      port: {
        default: "8001",
        description: "Port for Kong's Admin API",
      },
      protocol: {
        default: "http",
        description: "Protocol for requests to Kong's Admin API",
        enum: ["http", "https"],
      },
    };
    const o = getOas(["{protocol}://{hostname}:{port}{path}"], vars);
    expect(c.run(o).servers).toEqual([
      {
        url: "{protocol}://{hostname}:{port}{path}",
        variables: vars,
      },
    ]);
  });
});
