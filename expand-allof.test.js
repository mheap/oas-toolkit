const expand = require("./expand-allof");

it("merges allOf in to a single entity", async () => {
  const result = await expand({
    components: {
      schemas: {
        User: {
          allOf: [
            {
              type: "object",
              properties: {
                name: {
                  type: "string",
                },
              },
            },
            {
              type: "object",
              properties: {
                age: {
                  type: "number",
                },
              },
            },
          ],
        },
      },
    },
  });
  expect(result).toEqual({
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
            age: {
              type: "number",
            },
          },
        },
      },
    },
  });
});

it("dereferences before merging allOf", async () => {
  const result = await expand({
    components: {
      schemas: {
        User: {
          allOf: [
            {
              $ref: "#/components/schemas/Name",
            },
            {
              type: "object",
              properties: {
                age: {
                  type: "number",
                },
              },
            },
          ],
        },
        Name: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
          },
        },
      },
    },
  });

  expect(result).toEqual({
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
            age: {
              type: "number",
            },
          },
        },
        Name: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
          },
        },
      },
    },
  });
});

it("allows for required field overrides", async () => {
  const result = await expand({
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
            age: {
              type: "number",
            },
          },
        },
        CreateUserRequest: {
          allOf: [
            {
              $ref: "#/components/schemas/User",
            },
            {
              required: ["name"],
            },
          ],
        },
        UserResponse: {
          allOf: [
            {
              $ref: "#/components/schemas/User",
            },
            {
              required: ["name", "age"],
            },
          ],
        },
      },
    },
  });

  expect(result).toEqual({
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
            age: {
              type: "number",
            },
          },
        },
        CreateUserRequest: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
            age: {
              type: "number",
            },
          },
          required: ["name"],
        },
        UserResponse: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
            age: {
              type: "number",
            },
          },
          required: ["name", "age"],
        },
      },
    },
  });
});
