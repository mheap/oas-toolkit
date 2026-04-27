const traverse = require("traverse");
const { default: $RefParser } = require("@apidevtools/json-schema-ref-parser");

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "patch", "options", "head", "trace"]);

async function buildOneOfExplorerModel(oas) {
  const dereferenced = await $RefParser.dereference(traverse(oas).clone(), {
    dereference: {
      circular: "ignore",
    },
  });

  const usages = [];

  traverse(oas).forEach(function () {
    if (!this.node || typeof this.node !== "object" || !Array.isArray(this.node.oneOf)) {
      return;
    }

    usages.push(analyzeOneOfUsage(oas, dereferenced, this.path));
  });

  usages.sort((left, right) => left.path.localeCompare(right.path));

  return {
    specTitle: oas.info && oas.info.title ? oas.info.title : "OpenAPI Spec",
    totalOneOfCount: usages.length,
    oneOfUsages: usages,
  };
}

function analyzeOneOfUsage(rawSpec, dereferencedSpec, path) {
  const rawNode = getAtPath(rawSpec, path) || {};
  const dereferencedNode = getAtPath(dereferencedSpec, path) || rawNode;
  const rawBranches = Array.isArray(rawNode.oneOf) ? rawNode.oneOf : [];
  const dereferencedBranches = Array.isArray(dereferencedNode.oneOf)
    ? dereferencedNode.oneOf
    : rawBranches;

  const internalBranches = ensureUniqueBranchLabels(rawBranches.map((rawBranch, index) => {
    const resolvedBranch = dereferencedBranches[index] || rawBranch;
    const label = getBranchLabel(
      rawBranch,
      resolvedBranch,
      index,
      rawNode.discriminator || dereferencedNode.discriminator
    );

    return {
      index,
      label,
      ref: rawBranch && rawBranch.$ref ? rawBranch.$ref : null,
      summary: summarizeSchema(resolvedBranch),
      isObjectLike: isObjectLikeSchema(resolvedBranch),
      propertyCount: Object.keys((resolvedBranch && resolvedBranch.properties) || {}).length,
      requiredCount: Array.isArray(resolvedBranch && resolvedBranch.required)
        ? resolvedBranch.required.length
        : 0,
      schema: resolvedBranch,
      requiredSet: new Set(Array.isArray(resolvedBranch && resolvedBranch.required) ? resolvedBranch.required : []),
      displaySchema: sanitizeForJson(resolvedBranch),
      rawDisplaySchema: sanitizeForJson(rawBranch),
    };
  }));

  return {
    id: pathToPointer(path),
    pointer: pathToPointer(path),
    path: formatPath(path),
    context: buildUsageContext(path),
    branchCount: internalBranches.length,
    discriminator: summarizeDiscriminator(rawNode.discriminator || dereferencedNode.discriminator),
    branches: internalBranches.map(({ schema, requiredSet, ...branch }) => branch),
    fieldComparison: buildFieldComparison(
      internalBranches,
      rawNode.discriminator || dereferencedNode.discriminator
    ),
    rawOneOf: sanitizeForJson(rawBranches),
  };
}

function ensureUniqueBranchLabels(branches) {
  const seen = new Map();

  return branches.map((branch) => {
    const count = seen.get(branch.label) || 0;
    seen.set(branch.label, count + 1);

    if (count === 0) {
      return branch;
    }

    return {
      ...branch,
      label: `${branch.label} (${count + 1})`,
    };
  });
}

function buildFieldComparison(branches, discriminator) {
  const objectBranches = branches.filter((branch) => branch.isObjectLike);
  const skippedBranchLabels = branches
    .filter((branch) => !branch.isObjectLike)
    .map((branch) => branch.label);

  if (objectBranches.length === 0) {
    return {
      scope: {
        totalBranches: branches.length,
        objectBranchCount: 0,
        skippedBranchLabels,
      },
      commonFields: [],
      differingFields: [],
    };
  }

  const comparison = compareObjectBranches(objectBranches, discriminator);

  return {
    scope: {
      totalBranches: branches.length,
      objectBranchCount: objectBranches.length,
      skippedBranchLabels,
    },
    sharedPaths: comparison.sharedPaths,
    branchViews: comparison.branchViews,
    nonSharedPathCount: comparison.nonSharedPathCount,
  };
}

function compareObjectBranches(branches, discriminator) {
  const flattenedBranches = branches.map((branch) => ({
    label: branch.label,
    paths: flattenSchemaPaths(branch.schema),
  }));
  const allPaths = new Set();

  for (const branch of flattenedBranches) {
    for (const path of Object.keys(branch.paths)) {
      allPaths.add(path);
    }
  }

  const sharedPaths = [];
  const branchViews = branches.map((branch) => ({
    label: branch.label,
    onlyHere: [],
    uniqueSchema: [],
    sharedWithSubset: [],
  }));
  const branchViewMap = new Map(branchViews.map((branchView) => [branchView.label, branchView]));

  for (const path of Array.from(allPaths).sort()) {
    const branchSchemas = flattenedBranches.map((branch) => {
      const entry = branch.paths[path];

      return {
        label: branch.label,
        present: Boolean(entry),
        required: entry ? entry.required : false,
        schemaSummary: entry ? entry.summary : null,
        schema: entry ? entry.schema : null,
      };
    });

    const presentSchemas = branchSchemas.filter((entry) => entry.present);
    if (presentSchemas.length === 0) {
      continue;
    }

    const schemaFingerprints = presentSchemas.map((entry) => JSON.stringify(normalizeSchemaForComparison(
      path,
      entry.schema,
      discriminator
    )));
    const schemaMatchesWherePresent = schemaFingerprints.length <= 1
      || schemaFingerprints.every((fingerprint) => fingerprint === schemaFingerprints[0]);
    const schemaVariants = buildSchemaVariants(presentSchemas);
    const presentIn = presentSchemas.map((entry) => entry.label);
    const missingIn = branchSchemas.filter((entry) => !entry.present).map((entry) => entry.label);
    const requiredIn = branchSchemas.filter((entry) => entry.required).map((entry) => entry.label);
    const optionalIn = branchSchemas.filter((entry) => entry.present && !entry.required).map((entry) => entry.label);

    if (presentSchemas.length === branches.length && schemaMatchesWherePresent) {
      sharedPaths.push({
        path,
        summary: presentSchemas[0].schemaSummary,
        requiredIn,
        optionalIn,
        branchSchemas,
      });
      continue;
    }

    for (const entry of presentSchemas) {
      const variant = schemaVariants.find((candidate) => candidate.members.includes(entry.label));
      const category = presentSchemas.length === 1
        ? "onlyHere"
        : variant && variant.memberCount === 1
          ? "uniqueSchema"
          : "sharedWithSubset";

      branchViewMap.get(entry.label)[category].push({
        path,
        summary: entry.schemaSummary,
        required: entry.required,
        presentIn,
        missingIn,
        peers: variant ? variant.members.filter((member) => member !== entry.label) : [],
        schemaVariantCount: schemaVariants.length,
        schema: entry.schema,
      });
    }
  }

  for (const branchView of branchViews) {
    branchView.onlyHere.sort(sortPathEntries);
    branchView.uniqueSchema.sort(sortPathEntries);
    branchView.sharedWithSubset = compactSharedEntries(
      branchView.sharedWithSubset.sort(sortPathEntries),
      (entry) => entry.presentIn.slice().sort().join("|")
    );
    branchView.totalPathCount = branchView.onlyHere.length + branchView.uniqueSchema.length + branchView.sharedWithSubset.length;
  }

  return {
    sharedPaths: compactSharedEntries(sharedPaths.sort(sortPathEntries), () => "all"),
    branchViews,
    nonSharedPathCount: Array.from(branchViews).reduce((total, branchView) => total + branchView.totalPathCount, 0),
  };
}

function flattenSchemaPaths(schema) {
  const entries = {};

  visitSchemaPaths(schema, "", false, [], entries);

  return entries;
}

function visitSchemaPaths(schema, path, required, ancestors, entries) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return;
  }

  if (path && !schema.items) {
    entries[path] = {
      required,
      summary: summarizeSchema(schema),
      schema: sanitizeForJson(schema),
    };
  }

  if (ancestors.includes(schema)) {
    return;
  }

  const nextAncestors = ancestors.concat(schema);

  if (schema.properties) {
    const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
      const propertyPath = path ? `${path}.${propertyName}` : propertyName;
      visitSchemaPaths(propertySchema, propertyPath, requiredSet.has(propertyName), nextAncestors, entries);
    }
  }

  if (schema.items) {
    const itemsPath = path ? `${path}[]` : "[]";
    visitSchemaPaths(schema.items, itemsPath, false, nextAncestors, entries);
  }
}

function sortPathEntries(left, right) {
  return left.path.localeCompare(right.path);
}

function compactSharedEntries(entries, getGroupKey) {
  const kept = [];

  for (const entry of entries) {
    const groupKey = getGroupKey(entry);
    const hasAncestor = kept.some((candidate) => (
      getGroupKey(candidate) === groupKey
      && isDescendantPath(entry.path, candidate.path)
    ));

    if (!hasAncestor) {
      kept.push(entry);
    }
  }

  return kept;
}

function isDescendantPath(path, ancestorPath) {
  return path.startsWith(`${ancestorPath}.`) || path.startsWith(`${ancestorPath}[`);
}

function normalizeSchemaForComparison(path, schema, discriminator) {
  if (!discriminator || !discriminator.propertyName || !schema || typeof schema !== "object") {
    return schema;
  }

  if (path !== discriminator.propertyName) {
    return schema;
  }

  const normalized = { ...schema };

  if (Object.prototype.hasOwnProperty.call(normalized, "const")) {
    normalized.const = "__discriminator__";
  }

  if (Array.isArray(normalized.enum)) {
    normalized.enum = ["__discriminator__"];
  }

  return normalized;
}

function buildSchemaVariants(presentSchemas) {
  const variants = new Map();

  for (const entry of presentSchemas) {
    const fingerprint = JSON.stringify(entry.schema);
    if (!variants.has(fingerprint)) {
      variants.set(fingerprint, {
        fingerprint,
        summary: entry.schemaSummary,
        schema: entry.schema,
        members: [],
        requiredIn: [],
        optionalIn: [],
      });
    }

    const variant = variants.get(fingerprint);
    variant.members.push(entry.label);
    if (entry.required) {
      variant.requiredIn.push(entry.label);
    } else {
      variant.optionalIn.push(entry.label);
    }
  }

  return Array.from(variants.values())
    .map((variant) => ({
      fingerprint: variant.fingerprint,
      summary: variant.summary,
      schema: variant.schema,
      members: variant.members,
      memberCount: variant.members.length,
      requiredIn: variant.requiredIn,
      optionalIn: variant.optionalIn,
    }))
    .sort((left, right) => {
      if (right.memberCount !== left.memberCount) {
        return right.memberCount - left.memberCount;
      }

      return left.members.join(", ").localeCompare(right.members.join(", "));
    });
}

function summarizeSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return {
      type: typeof schema,
      title: null,
      format: null,
      nullable: false,
      enumValues: null,
      constValue: null,
      propertyCount: 0,
      oneOfCount: 0,
      allOfCount: 0,
      anyOfCount: 0,
    };
  }

  return {
    type: inferSchemaType(schema),
    title: schema.title || null,
    format: schema.format || null,
    nullable: Boolean(schema.nullable),
    enumValues: Array.isArray(schema.enum) ? schema.enum.slice(0, 5) : null,
    constValue: Object.prototype.hasOwnProperty.call(schema, "const") ? schema.const : null,
    propertyCount: Object.keys(schema.properties || {}).length,
    oneOfCount: Array.isArray(schema.oneOf) ? schema.oneOf.length : 0,
    allOfCount: Array.isArray(schema.allOf) ? schema.allOf.length : 0,
    anyOfCount: Array.isArray(schema.anyOf) ? schema.anyOf.length : 0,
  };
}

function summarizeDiscriminator(discriminator) {
  if (!discriminator) {
    return null;
  }

  const mappingKeys = discriminator.mapping ? Object.keys(discriminator.mapping).sort() : [];

  return {
    propertyName: discriminator.propertyName || null,
    mappingCount: mappingKeys.length,
    mappingKeys,
  };
}

function getBranchLabel(rawBranch, resolvedBranch, index, discriminator) {
  const refLabel = rawBranch && rawBranch.$ref ? rawBranch.$ref.split("/").pop() : null;
  const titleLabel = resolvedBranch && resolvedBranch.title ? resolvedBranch.title : null;
  const discriminatorLabel = getDiscriminatorLabel(resolvedBranch, discriminator);
  const heuristicLabel = getHeuristicBranchLabel(resolvedBranch);

  if (refLabel && discriminatorLabel && normalizeLabel(refLabel) !== normalizeLabel(discriminatorLabel)) {
    return `${refLabel} (${discriminatorLabel})`;
  }

  if (refLabel) {
    return refLabel;
  }

  if (titleLabel && discriminatorLabel && normalizeLabel(titleLabel) !== normalizeLabel(discriminatorLabel)) {
    return `${titleLabel} (${discriminatorLabel})`;
  }

  if (titleLabel) {
    return titleLabel;
  }

  if (discriminatorLabel) {
    return discriminatorLabel;
  }

  if (heuristicLabel) {
    return heuristicLabel;
  }

  return `Option ${index + 1}`;
}

function getDiscriminatorLabel(schema, discriminator) {
  if (!schema || !discriminator || !discriminator.propertyName) {
    return null;
  }

  return getPropertyValueLabel(schema, discriminator.propertyName);
}

function getHeuristicBranchLabel(schema) {
  if (!schema || typeof schema !== "object") {
    return null;
  }

  if (schema.const !== undefined) {
    return String(schema.const);
  }

  if (Array.isArray(schema.enum) && schema.enum.length === 1) {
    return String(schema.enum[0]);
  }

  const preferredPropertyKeys = [
    "kind",
    "type",
    "eventType",
    "resourceType",
    "objectType",
    "action",
    "status",
    "name",
  ];

  for (const key of preferredPropertyKeys) {
    const label = getPropertyValueLabel(schema, key);
    if (label) {
      return label;
    }
  }

  if (schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      const label = getPropertyValueLabel(schema, key);
      if (label) {
        return `${key}=${label}`;
      }
    }
  }

  return null;
}

function getPropertyValueLabel(schema, propertyName) {
  if (!schema || !schema.properties || !schema.properties[propertyName]) {
    return null;
  }

  const propertySchema = schema.properties[propertyName];

  if (propertySchema.const !== undefined) {
    return String(propertySchema.const);
  }

  if (Array.isArray(propertySchema.enum) && propertySchema.enum.length === 1) {
    return String(propertySchema.enum[0]);
  }

  return null;
}

function normalizeLabel(value) {
  return String(value).trim().toLowerCase();
}

function buildUsageContext(path) {
  if (!path.length) {
    return {
      kind: "root",
      primaryLabel: "Document root",
      secondaryLabel: null,
      chips: [],
    };
  }

  if (path[0] === "components" && path.length >= 3) {
    return {
      kind: "component",
      primaryLabel: String(path[2]),
      secondaryLabel: `components.${path[1]}`,
      chips: [humanizeSegment(path[1])],
    };
  }

  if (path[0] === "paths" && path.length >= 2) {
    const route = String(path[1]);
    const methodIndex = path.findIndex((segment, index) => index > 1 && HTTP_METHODS.has(segment));
    const method = methodIndex === -1 ? null : String(path[methodIndex]).toUpperCase();
    const contentIndex = path.indexOf("content");
    const mediaType = contentIndex !== -1 ? String(path[contentIndex + 1]) : null;
    const responsesIndex = path.indexOf("responses");
    const statusCode = responsesIndex !== -1 ? String(path[responsesIndex + 1]) : null;
    const chips = [];

    if (mediaType) {
      chips.push(mediaType);
    }
    if (statusCode) {
      chips.push(`HTTP ${statusCode}`);
    }

    if (path.includes("requestBody")) {
      return {
        kind: "requestBody",
        primaryLabel: method ? `${method} ${route}` : route,
        secondaryLabel: "request body",
        chips,
      };
    }

    if (responsesIndex !== -1) {
      return {
        kind: "response",
        primaryLabel: method ? `${method} ${route}` : route,
        secondaryLabel: statusCode ? `response ${statusCode}` : "response",
        chips,
      };
    }

    if (path.includes("parameters")) {
      return {
        kind: "parameter",
        primaryLabel: method ? `${method} ${route}` : route,
        secondaryLabel: "parameter schema",
        chips,
      };
    }

    return {
      kind: method ? "operation" : "path",
      primaryLabel: method ? `${method} ${route}` : route,
      secondaryLabel: method ? "operation schema" : "path schema",
      chips,
    };
  }

  return {
    kind: "generic",
    primaryLabel: formatPath(path),
    secondaryLabel: null,
    chips: [],
  };
}

function humanizeSegment(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function inferSchemaType(schema) {
  if (!schema || typeof schema !== "object") {
    return typeof schema;
  }

  if (schema.type) {
    return Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
  }

  if (schema.properties) {
    return "object";
  }

  if (schema.items) {
    return "array";
  }

  if (schema.enum) {
    return "enum";
  }

  if (schema.oneOf) {
    return "oneOf";
  }

  if (schema.allOf) {
    return "allOf";
  }

  if (schema.anyOf) {
    return "anyOf";
  }

  return "unknown";
}

function isObjectLikeSchema(schema) {
  return Boolean(
    schema
    && typeof schema === "object"
    && !Array.isArray(schema)
    && (schema.type === "object" || schema.properties)
  );
}

function sanitizeForJson(value, seen, currentPath) {
  const localSeen = seen || new WeakMap();
  const path = currentPath || "#";

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (localSeen.has(value)) {
    return {
      $circularRef: localSeen.get(value),
    };
  }

  localSeen.set(value, path);

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeForJson(item, localSeen, `${path}/${index}`));
  }

  const result = {};

  for (const key of Object.keys(value).sort()) {
    const sanitized = sanitizeForJson(value[key], localSeen, `${path}/${escapePointerSegment(key)}`);

    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }

  return result;
}

function getAtPath(value, path) {
  return path.reduce((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    return current[segment];
  }, value);
}

function pathToPointer(path) {
  if (!path.length) {
    return "#";
  }

  return "#/" + path.map(escapePointerSegment).join("/");
}

function formatPath(path) {
  if (!path.length) {
    return "(root)";
  }

  let output = "";

  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];

    if (typeof segment === "number") {
      output += `[${segment}]`;
      continue;
    }

    const isIdentifier = /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(segment);
    if (!output) {
      output = isIdentifier ? segment : `[${JSON.stringify(segment)}]`;
      continue;
    }

    output += isIdentifier ? `.${segment}` : `[${JSON.stringify(segment)}]`;
  }

  return output;
}

function escapePointerSegment(segment) {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function generateOneOfExplorerHtml(model) {
  const title = `${model.specTitle} oneOf Explorer`;
  const payload = serializeForScript(model);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --panel-alt: #f8fafc;
      --text: #14213d;
      --muted: #5c6b80;
      --border: #d8e0ec;
      --accent: #4f46e5;
      --accent-soft: #eef2ff;
      --danger: #b42318;
      --danger-soft: #fef3f2;
      --success: #027a48;
      --success-soft: #ecfdf3;
      --shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
      --radius: 18px;
      --mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: linear-gradient(180deg, #eef2ff 0%, var(--bg) 16%, var(--bg) 100%);
      color: var(--text);
    }

    button, input { font: inherit; }

    .shell {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      min-height: 100vh;
      gap: 24px;
      padding: 24px;
    }

    .sidebar, .detail {
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(216, 224, 236, 0.8);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      min-height: calc(100vh - 48px);
      position: sticky;
      top: 24px;
    }

    .sidebar-header, .detail-header {
      padding: 24px;
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.78);
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }

    h1, h2, h3 {
      margin: 0;
      line-height: 1.1;
    }

    h1 {
      font-size: 26px;
      margin-top: 10px;
    }

    .subtle {
      color: var(--muted);
      margin-top: 10px;
      line-height: 1.5;
    }

    .search {
      width: 100%;
      margin-top: 18px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel-alt);
      padding: 12px 14px;
      color: var(--text);
    }

    .usage-list {
      padding: 14px;
      overflow: auto;
      display: grid;
      gap: 10px;
    }

    .usage-item {
      width: 100%;
      text-align: left;
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 16px;
      padding: 16px;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .usage-item:hover, .usage-item:focus-visible {
      border-color: rgba(79, 70, 229, 0.35);
      box-shadow: 0 10px 24px rgba(79, 70, 229, 0.12);
      transform: translateY(-1px);
      outline: none;
    }

    .usage-item.active {
      border-color: var(--accent);
      background: linear-gradient(180deg, #ffffff 0%, var(--accent-soft) 100%);
    }

    .usage-path {
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1.55;
      word-break: break-word;
      margin-top: 10px;
      color: var(--muted);
    }

    .usage-context {
      font-size: 15px;
      font-weight: 700;
      line-height: 1.35;
    }

    .usage-subtle {
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
    }

    .usage-meta, .chip-row, .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    .chip, .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      line-height: 1;
      border: 1px solid transparent;
      background: var(--panel-alt);
      color: var(--muted);
      white-space: nowrap;
    }

    .chip.accent, .badge.accent { background: var(--accent-soft); color: var(--accent); }
    .chip.success, .badge.success { background: var(--success-soft); color: var(--success); }
    .chip.danger, .badge.danger { background: var(--danger-soft); color: var(--danger); }

    .detail {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .detail-header {
      position: sticky;
      top: 24px;
      z-index: 2;
    }

    .detail-body {
      padding: 24px;
      display: grid;
      gap: 20px;
    }

    .section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 20px;
      overflow: hidden;
    }

    .section-header {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .section-title {
      font-size: 18px;
      font-weight: 700;
    }

    .section-note {
      color: var(--muted);
      line-height: 1.5;
      margin: 0 0 16px;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .toolbar button, .copy-button {
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      border-radius: 12px;
      padding: 10px 14px;
      cursor: pointer;
    }

    .toolbar button.active {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--accent-soft);
    }

    .compact-mode .section {
      padding-top: 14px;
      padding-bottom: 14px;
    }

    .compact-mode .field-card summary,
    .compact-mode .field-card-body {
      padding-top: 12px;
      padding-bottom: 12px;
    }

    .compact-mode .branch-card,
    .compact-mode .field-branch {
      padding: 12px;
    }

    .compact-mode .chip-row,
    .compact-mode .stats {
      gap: 6px;
      margin-top: 8px;
    }

    .compact-mode pre {
      font-size: 11px;
      max-height: 220px;
    }

    .pointer {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--muted);
      word-break: break-all;
      margin-top: 10px;
    }

    .table-wrap {
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 16px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }

    th, td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
      text-align: left;
    }

    th {
      background: var(--panel-alt);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }

    tbody tr:last-child td { border-bottom: 0; }

    .field-name {
      font-weight: 700;
      margin-bottom: 6px;
    }

    .field-summary, .inline-summary {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .field-card {
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      background: var(--panel-alt);
    }

    .field-card + .field-card { margin-top: 12px; }

    .field-card summary {
      list-style: none;
      cursor: pointer;
      padding: 16px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .field-card summary::-webkit-details-marker { display: none; }

    .field-card-body {
      padding: 0 16px 16px;
      display: grid;
      gap: 16px;
    }

    .branch-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 14px;
    }

    .branch-grid.side-by-side {
      grid-template-columns: repeat(var(--branch-count), minmax(280px, 1fr));
      overflow-x: auto;
    }

    .branch-card, .field-branch {
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--panel);
      padding: 16px;
      min-width: 0;
    }

    .field-branch.missing {
      background: #fff7ed;
      border-color: #fed7aa;
    }

    .field-branch-title {
      font-weight: 700;
      margin-bottom: 10px;
    }

    .path-list {
      display: grid;
      gap: 10px;
    }

    .path-row {
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--panel-alt);
      padding: 12px 14px;
    }

    .path-name {
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 700;
      line-height: 1.4;
      word-break: break-word;
    }

    .path-meta {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    details.raw {
      border-top: 1px solid var(--border);
      margin-top: 14px;
      padding-top: 14px;
    }

    details.raw summary {
      cursor: pointer;
      color: var(--muted);
      font-weight: 600;
    }

    pre {
      margin: 12px 0 0;
      padding: 14px;
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 14px;
      overflow: auto;
      font-size: 12px;
      line-height: 1.55;
      font-family: var(--mono);
    }

    .empty {
      padding: 40px 24px;
      text-align: center;
      color: var(--muted);
    }

    .nested {
      border-left: 3px solid rgba(79, 70, 229, 0.12);
      padding-left: 14px;
      margin-top: 14px;
    }

    @media (max-width: 1080px) {
      .shell {
        grid-template-columns: 1fr;
      }

      .sidebar {
        position: static;
        min-height: 0;
      }

      .detail-header {
        position: static;
      }
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
    window.__ONEOF_EXPLORER_DATA__ = ${payload};

    (function () {
      var data = window.__ONEOF_EXPLORER_DATA__;
      var app = document.getElementById("app");
      var state = {
        query: "",
        selectedPointer: null,
        layout: "side-by-side",
        compact: null,
        uniqueVariantsOnly: false
      };

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function formatJson(value) {
        return escapeHtml(JSON.stringify(value, null, 2));
      }

      function summaryText(summary) {
        if (!summary) {
          return "Unavailable";
        }

        var parts = [];
        if (summary.type) parts.push(summary.type);
        if (summary.format) parts.push(summary.format);
        if (summary.propertyCount) parts.push(String(summary.propertyCount) + " props");
        if (summary.enumValues) parts.push("enum:" + summary.enumValues.join(", "));
        if (summary.constValue !== null) parts.push("const:" + summary.constValue);
        if (summary.oneOfCount) parts.push("oneOf:" + summary.oneOfCount);
        if (summary.allOfCount) parts.push("allOf:" + summary.allOfCount);
        if (summary.anyOfCount) parts.push("anyOf:" + summary.anyOfCount);
        return parts.join(" • ") || "schema";
      }

      function branchMatchesQuery(usage, query) {
        if (!query) {
          return true;
        }

        var searchable = [
          usage.path,
          usage.pointer,
          usage.context && usage.context.primaryLabel ? usage.context.primaryLabel : "",
          usage.context && usage.context.secondaryLabel ? usage.context.secondaryLabel : "",
          usage.context && usage.context.chips ? usage.context.chips.join(" ") : "",
          usage.discriminator && usage.discriminator.propertyName ? usage.discriminator.propertyName : "",
          usage.branches.map(function (branch) { return branch.label; }).join(" ")
        ].join(" ").toLowerCase();

        return searchable.indexOf(query.toLowerCase()) !== -1;
      }

      function getFilteredUsages() {
        return data.oneOfUsages.filter(function (usage) {
          return branchMatchesQuery(usage, state.query);
        });
      }

      function getSelectedUsage(filteredUsages) {
        if (!filteredUsages.length) {
          return null;
        }

        for (var index = 0; index < filteredUsages.length; index += 1) {
          if (filteredUsages[index].pointer === state.selectedPointer) {
            return filteredUsages[index];
          }
        }

        return filteredUsages[0];
      }

      function readHashState() {
        var hash = window.location.hash.slice(1);
        var params = new URLSearchParams(hash);
        var pointer = params.get("pointer");
        var layout = params.get("layout");
        var compact = params.get("compact");
        var variants = params.get("variants");
        if (pointer) state.selectedPointer = pointer;
        if (layout === "accordion" || layout === "side-by-side") state.layout = layout;
        if (compact === "1") state.compact = true;
        if (compact === "0") state.compact = false;
        state.uniqueVariantsOnly = variants === "unique";
      }

      function writeHashState() {
        var params = new URLSearchParams();
        if (state.selectedPointer) params.set("pointer", state.selectedPointer);
        if (state.layout) params.set("layout", state.layout);
        if (state.compact !== null) params.set("compact", state.compact ? "1" : "0");
        if (state.uniqueVariantsOnly) params.set("variants", "unique");
        var nextHash = params.toString();
        if (window.location.hash.slice(1) !== nextHash) {
          window.location.hash = nextHash;
        }
      }

      function isCompactMode(selectedUsage) {
        if (state.compact !== null) {
          return state.compact;
        }

        return Boolean(selectedUsage && selectedUsage.branchCount >= 6);
      }

      function renderUsageList(filteredUsages, selectedUsage) {
        if (!filteredUsages.length) {
          return '<div class="empty">No oneOf usages match this search.</div>';
        }

        return filteredUsages.map(function (usage) {
          var active = selectedUsage && usage.pointer === selectedUsage.pointer ? " active" : "";
          var context = usage.context || {};
          var discriminator = usage.discriminator && usage.discriminator.propertyName
            ? '<span class="chip accent">discriminator: ' + escapeHtml(usage.discriminator.propertyName) + '</span>'
            : "";
          var contextChips = (context.chips || []).map(function (chip) {
            return '<span class="chip">' + escapeHtml(chip) + '</span>';
          }).join("");

          return ''
            + '<button class="usage-item' + active + '" data-pointer="' + escapeHtml(usage.pointer) + '">'
            + '  <div class="usage-context">' + escapeHtml(context.primaryLabel || usage.path) + '</div>'
            +      (context.secondaryLabel ? '<div class="usage-subtle">' + escapeHtml(context.secondaryLabel) + '</div>' : '')
            + '  <div class="usage-path">' + escapeHtml(usage.path) + '</div>'
            + '  <div class="usage-meta">'
            + '    <span class="chip success">' + usage.branchCount + ' branches</span>'
            +       contextChips
            +       discriminator
            + '  </div>'
            + '</button>';
        }).join("");
      }

      function renderPathEntry(pathEntry, mode) {
        var badges = [];
        if (pathEntry.required) {
          badges.push('<span class="badge accent">Required</span>');
        } else if (pathEntry.required === false) {
          badges.push('<span class="badge">Optional</span>');
        }
        if (pathEntry.peers && pathEntry.peers.length) {
          badges.push('<span class="badge success">Shared with ' + escapeHtml(pathEntry.peers.join(', ')) + '</span>');
        }
        if (pathEntry.missingIn && pathEntry.missingIn.length) {
          badges.push('<span class="badge danger">Missing in ' + escapeHtml(pathEntry.missingIn.join(', ')) + '</span>');
        }

        return ''
          + '<div class="path-row">'
          + '  <div class="path-name">' + escapeHtml(pathEntry.path) + '</div>'
          + '  <div class="chip-row">' + badges.join('') + '</div>'
          + '  <div class="path-meta">' + escapeHtml(summaryText(pathEntry.summary)) + '</div>'
          + '  <details class="raw">'
          + '    <summary>' + escapeHtml(mode === 'shared' ? 'Shared path schema' : 'Path schema') + '</summary>'
          + '    <pre>' + formatJson(pathEntry.schema || { summary: pathEntry.summary }) + '</pre>'
          + '  </details>'
          + '</div>';
      }

      function renderPathList(entries, mode, emptyText) {
        if (!entries.length) {
          return '<div class="empty">' + escapeHtml(emptyText) + '</div>';
        }

        return '<div class="path-list">' + entries.map(function (entry) {
          return renderPathEntry(entry, mode);
        }).join('') + '</div>';
      }

      function getDisplayedEntries(entries) {
        if (!state.uniqueVariantsOnly) {
          return entries;
        }

        var seen = new Set();
        return entries.filter(function (entry) {
          var key = entry.path + '|' + JSON.stringify(entry.schema || entry.summary || null);
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
      }

      function renderBranchSpecificSections(branchViews) {
        return branchViews.map(function (branchView) {
          return ''
            + '<div class="section">'
            + '  <div class="section-header">'
            + '    <div class="section-title">' + escapeHtml(branchView.label) + '</div>'
            + '    <div class="stats"><span class="chip danger">' + branchView.totalPathCount + ' paths</span></div>'
            + '  </div>'
            + '  <div class="section-note">Flattened branch-specific paths using dot notation and [] for arrays.</div>'
            + '  <div class="field-card">'
            + '    <summary>'
            + '      <div>'
            + '        <div class="field-name">Only in ' + escapeHtml(branchView.label) + '</div>'
            + '      </div>'
            + '    </summary>'
            + '    <div class="field-card-body">'
            +        renderPathList(getDisplayedEntries(branchView.onlyHere), 'branch', 'No paths exist only in this branch.')
            + '    </div>'
            + '  </div>'
            + '  <div class="field-card">'
            + '    <summary>'
            + '      <div>'
            + '        <div class="field-name">Different schema only in ' + escapeHtml(branchView.label) + '</div>'
            + '      </div>'
            + '    </summary>'
            + '    <div class="field-card-body">'
            +        renderPathList(getDisplayedEntries(branchView.uniqueSchema), 'branch', 'No uniquely-shaped paths in this branch.')
            + '    </div>'
            + '  </div>'
            + '  <div class="field-card">'
            + '    <summary>'
            + '      <div>'
            + '        <div class="field-name">Shared with subset</div>'
            + '      </div>'
            + '    </summary>'
            + '    <div class="field-card-body">'
            +        renderPathList(getDisplayedEntries(branchView.sharedWithSubset), 'branch', 'No subset-shared paths for this branch.')
            + '    </div>'
            + '  </div>'
            + '</div>';
        }).join('');
      }

      function renderBranches(selectedUsage, compactMode) {
        var branchCards = selectedUsage.branches.map(function (branch) {
          return ''
            + '<div class="branch-card">'
            + '  <div class="field-name">' + escapeHtml(branch.label) + '</div>'
            + '  <div class="chip-row">'
            + '    <span class="badge accent">' + escapeHtml(summaryText(branch.summary)) + '</span>'
            +      (branch.ref ? '<span class="badge">' + escapeHtml(branch.ref) + '</span>' : '')
            +      (branch.isObjectLike ? '<span class="badge success">' + branch.propertyCount + ' properties</span>' : '<span class="badge danger">raw schema summary</span>')
            + '  </div>'
            + '  <details class="raw"' + (compactMode ? '' : ' open') + '>'
            + '    <summary>Resolved schema</summary>'
            + '    <pre>' + formatJson(branch.displaySchema) + '</pre>'
            + '  </details>'
            + '  <details class="raw">'
            + '    <summary>Original branch</summary>'
            + '    <pre>' + formatJson(branch.rawDisplaySchema) + '</pre>'
            + '  </details>'
            + '</div>';
        }).join("");

        if (state.layout === "accordion") {
          return selectedUsage.branches.map(function (branch) {
            return ''
              + '<details class="field-card" open>'
              + '  <summary>'
              + '    <div>'
              + '      <div class="field-name">' + escapeHtml(branch.label) + '</div>'
              + '      <div class="field-summary">' + escapeHtml(summaryText(branch.summary)) + '</div>'
              + '    </div>'
              + '  </summary>'
              + '  <div class="field-card-body">'
              + '    <div class="branch-card">'
              + '      <div class="chip-row">'
              +          (branch.ref ? '<span class="badge">' + escapeHtml(branch.ref) + '</span>' : '')
              +          (branch.isObjectLike ? '<span class="badge success">' + branch.propertyCount + ' properties</span>' : '<span class="badge danger">raw schema summary</span>')
              + '      </div>'
              + '      <details class="raw"' + (compactMode ? '' : ' open') + '>'
              + '        <summary>Resolved schema</summary>'
              + '        <pre>' + formatJson(branch.displaySchema) + '</pre>'
              + '      </details>'
              + '      <details class="raw">'
              + '        <summary>Original branch</summary>'
              + '        <pre>' + formatJson(branch.rawDisplaySchema) + '</pre>'
              + '      </details>'
              + '    </div>'
              + '  </div>'
              + '</details>';
          }).join("");
        }

        return '<div class="branch-grid side-by-side" style="--branch-count: ' + selectedUsage.branches.length + ';">' + branchCards + '</div>';
      }

      function renderDetail(selectedUsage) {
        if (!selectedUsage) {
          return ''
            + '<div class="detail">'
            + '  <div class="detail-header"><h2>No oneOf usage found</h2></div>'
            + '  <div class="detail-body"><div class="section"><div class="empty">This specification does not contain any oneOf nodes.</div></div></div>'
            + '</div>';
        }

        var context = selectedUsage.context || {};
        var compactMode = isCompactMode(selectedUsage);
        var comparisonTitle = selectedUsage.fieldComparison.scope.skippedBranchLabels.length
          ? 'Flattened path comparison covers ' + selectedUsage.fieldComparison.scope.objectBranchCount + ' object-like branches. '
              + selectedUsage.fieldComparison.scope.skippedBranchLabels.length + ' branch' + (selectedUsage.fieldComparison.scope.skippedBranchLabels.length === 1 ? ' is' : 'es are') + ' shown as raw schema summaries.'
          : 'Flattened path comparison covers every branch in this oneOf.';

        var discriminator = selectedUsage.discriminator && selectedUsage.discriminator.propertyName
          ? '<span class="chip accent">discriminator: ' + escapeHtml(selectedUsage.discriminator.propertyName) + '</span>'
          : '';

        return ''
          + '<div class="detail">'
          + '  <div class="detail-header">'
          + '    <div class="eyebrow">oneOf usage</div>'
          + '    <h1>' + escapeHtml(context.primaryLabel || selectedUsage.path) + '</h1>'
          +      (context.secondaryLabel ? '<div class="subtle">' + escapeHtml(context.secondaryLabel) + '</div>' : '')
          + '    <div class="subtle">Inspect shared fields, branch-specific fields, and the raw schemas behind this oneOf.</div>'
          + '    <div class="stats">'
          + '      <span class="chip success">' + selectedUsage.branchCount + ' branches</span>'
          +      (compactMode ? '<span class="chip">compact mode</span>' : '')
          +      (context.chips || []).map(function (chip) { return '<span class="chip">' + escapeHtml(chip) + '</span>'; }).join('')
          +        discriminator
          + '      <button class="copy-button" data-copy-pointer="' + escapeHtml(selectedUsage.pointer) + '">Copy pointer</button>'
          + '    </div>'
          + '    <div class="pointer">' + escapeHtml(selectedUsage.pointer) + '</div>'
          + '  </div>'
          + '  <div class="detail-body' + (compactMode ? ' compact-mode' : '') + '">'
          + '    <div class="section">'
          + '      <div class="section-header">'
          + '        <div class="section-title">Comparison scope</div>'
          + '      </div>'
          + '      <p class="section-note">' + escapeHtml(comparisonTitle) + '</p>'
          + '      <div class="chip-row">'
          + '        <span class="chip success">' + selectedUsage.fieldComparison.sharedPaths.length + ' shared paths</span>'
          + '        <span class="chip danger">' + selectedUsage.fieldComparison.nonSharedPathCount + ' branch-specific paths</span>'
          + '        <span class="chip">' + (state.uniqueVariantsOnly ? 'unique variants only' : 'all branches') + '</span>'
          + '      </div>'
          + '    </div>'
          + '    <div class="section">'
          + '      <div class="section-header">'
          + '        <div class="section-title">Shared across all branches</div>'
          + '      </div>'
          +        renderPathList(selectedUsage.fieldComparison.sharedPaths, 'shared', 'No shared flattened paths across every branch.')
          + '    </div>'
          +      renderBranchSpecificSections(selectedUsage.fieldComparison.branchViews)
          + '    <div class="section">'
          + '      <div class="section-header">'
          + '        <div class="section-title">Branches</div>'
          + '        <div class="toolbar">'
          + '          <button data-layout="side-by-side" class="' + (state.layout === 'side-by-side' ? 'active' : '') + '">Side by side</button>'
          + '          <button data-layout="accordion" class="' + (state.layout === 'accordion' ? 'active' : '') + '">Accordion</button>'
          + '          <button data-compact="toggle" class="' + (compactMode ? 'active' : '') + '">Compact</button>'
          + '          <button data-variants="toggle" class="' + (state.uniqueVariantsOnly ? 'active' : '') + '">Show only unique variants</button>'
          + '        </div>'
          + '      </div>'
          +        renderBranches(selectedUsage, compactMode)
          + '    </div>'
          + '    <div class="section">'
          + '      <div class="section-header">'
          + '        <div class="section-title">Raw oneOf definition</div>'
          + '      </div>'
          + '      <pre>' + formatJson(selectedUsage.rawOneOf) + '</pre>'
          + '    </div>'
          + '  </div>'
          + '</div>';
      }

      function render() {
        var filteredUsages = getFilteredUsages();
        var selectedUsage = getSelectedUsage(filteredUsages);

        if (selectedUsage && state.selectedPointer !== selectedUsage.pointer) {
          state.selectedPointer = selectedUsage.pointer;
          writeHashState();
        }

        app.innerHTML = ''
          + '<div class="shell">'
          + '  <aside class="sidebar">'
          + '    <div class="sidebar-header">'
          + '      <div class="eyebrow">OpenAPI explorer</div>'
          + '      <h2>' + escapeHtml(data.specTitle) + '</h2>'
          + '      <div class="subtle">Detected ' + data.totalOneOfCount + ' oneOf usage' + (data.totalOneOfCount === 1 ? '' : 's') + ' across the specification.</div>'
          + '      <input class="search" type="search" placeholder="Search oneOf usage" value="' + escapeHtml(state.query) + '" data-search-input="true" />'
          + '    </div>'
          + '    <div class="usage-list">' + renderUsageList(filteredUsages, selectedUsage) + '</div>'
          + '  </aside>'
          +      renderDetail(selectedUsage)
          + '</div>';
      }

      app.addEventListener('click', function (event) {
        var usageButton = event.target.closest('[data-pointer]');
        if (usageButton) {
          state.selectedPointer = usageButton.getAttribute('data-pointer');
          writeHashState();
          render();
          return;
        }

        var layoutButton = event.target.closest('[data-layout]');
        if (layoutButton) {
          state.layout = layoutButton.getAttribute('data-layout');
          writeHashState();
          render();
          return;
        }

        var compactButton = event.target.closest('[data-compact]');
        if (compactButton) {
          state.compact = !isCompactMode(getSelectedUsage(getFilteredUsages()));
          writeHashState();
          render();
          return;
        }

        var variantsButton = event.target.closest('[data-variants]');
        if (variantsButton) {
          state.uniqueVariantsOnly = !state.uniqueVariantsOnly;
          writeHashState();
          render();
          return;
        }

        var copyButton = event.target.closest('[data-copy-pointer]');
        if (copyButton && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(copyButton.getAttribute('data-copy-pointer'));
        }
      });

      app.addEventListener('input', function (event) {
        if (event.target.matches('[data-search-input]')) {
          state.query = event.target.value;
          render();
        }
      });

      window.addEventListener('hashchange', function () {
        readHashState();
        render();
      });

      readHashState();
      render();
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  buildOneOfExplorerModel,
  generateOneOfExplorerHtml,
};
