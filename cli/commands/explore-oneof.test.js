const { generateOneOfExplorerHtml } = require("../../explore-oneof");

describe("explore-oneof command html", () => {
  it("includes selected explorer features in the generated html", () => {
    const html = generateOneOfExplorerHtml({
      specTitle: "Explorer",
      totalOneOfCount: 0,
      oneOfUsages: [],
    });

    expect(html).toContain("data.totalOneOfCount");
    expect(html).toContain("data-copy-pointer");
    expect(html).toContain("window.location.hash");
    expect(html).toContain("Search oneOf usage");
    expect(html).toContain("data-compact");
    expect(html).toContain("usage-context");
  });
});
