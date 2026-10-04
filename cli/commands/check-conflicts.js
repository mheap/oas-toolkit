const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const merger = require("../../merger");
const {
  collectResolvedComponents,
  inlineComponentRefs,
} = require("../lib/resolve-component-refs");

module.exports = async function (argv) {
  try {
    const oasFiles = [argv.openapi, ...[].concat(argv.more || [])]
      .filter(Boolean)
      .map((f) => path.resolve(f));
    if (oasFiles.length < 2) {
      return;
    }

    const options = {
      ignorePrefix: argv.ignorePrefix,
      ignoreIdentical: argv.ignoreIdentical,
    };

    const oas = [];
    const inlinedOas = [];
    const resolvedObjects = [];
    const refCache = new Map();

    for (const file of oasFiles) {
      const document = yaml.load(fs.readFileSync(file, "utf8"));
      refCache.set(file, document);
      oas.push(document);
      inlinedOas.push(inlineComponentRefs(file, document, refCache));

      for (const { type, name, definition, source } of collectResolvedComponents(
        file,
        document,
        refCache
      )) {
        resolvedObjects.push({
          info: { title: `${path.relative(process.cwd(), file)} -> ${source}` },
          components: { [type]: { [name]: definition } },
        });
      }
    }

    // Strict mode: report all duplicates. If ignoreIdentical, compare inlined
    // definitions to avoid treating re-exports as divergent.
    const collisions = merger.findComponentCollisions(
      options.ignoreIdentical ? inlinedOas : oas,
      options
    );

    // External $refs only conflict if diverged. Inlines $ref-only components
    // first to catch renamed duplicates and prevent false collisions.
    if (resolvedObjects.length > 0) {
      const reported = new Set(
        collisions.map(({ type, name }) => `${type}.${name}`)
      );
      for (const collision of merger.findComponentCollisions(
        [...inlinedOas, ...resolvedObjects],
        { ...options, ignoreIdentical: true }
      )) {
        if (!reported.has(`${collision.type}.${collision.name}`)) {
          collisions.push(collision);
        }
      }
    }

    // Both passes are reported together so one run surfaces every collision.
    if (collisions.length > 0) {
      throw new Error(merger.formatComponentCollisions(collisions));
    }

    merger.ensureNoPathColissions(oas, argv);
    merger.ensureNoTagColissions(oas, argv);
    merger.ensureNoSecurityColissions(oas, argv);
    merger.ensureNoComplexObjectCollisions(inlinedOas, options);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
};
