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
    const shortLabel = getShortBranchLabel(
      rawBranch,
      resolvedBranch,
      index,
      rawNode.discriminator || dereferencedNode.discriminator
    );
    const label = getBranchLabel(
      rawBranch,
      resolvedBranch,
      index,
      rawNode.discriminator || dereferencedNode.discriminator
    );

    return {
      index,
      label,
      shortLabel,
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
  const labelSeen = new Map();
  const shortSeen = new Map();

  return branches.map((branch) => {
    const labelCount = labelSeen.get(branch.label) || 0;
    labelSeen.set(branch.label, labelCount + 1);

    const shortCount = shortSeen.get(branch.shortLabel) || 0;
    shortSeen.set(branch.shortLabel, shortCount + 1);

    const nextBranch = {
      ...branch,
    };

    if (labelCount > 0) {
      nextBranch.label = `${branch.label} (${labelCount + 1})`;
    }

    if (shortCount > 0) {
      nextBranch.shortLabel = `${branch.shortLabel} (${shortCount + 1})`;
    }

    return nextBranch;
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

  const comparison = compareObjectBranches(objectBranches, discriminator, branches.length);

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

function compareObjectBranches(branches, discriminator, totalBranchCount) {
  const flattenedBranches = branches.map((branch) => ({
    label: branch.label,
    shortLabel: branch.shortLabel,
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
    shortLabel: branch.shortLabel,
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
        shortLabel: branch.shortLabel,
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
    const deFactoVariant = schemaVariants.find((variant) => variant.memberCount > totalBranchCount / 2) || null;
    const presentIn = presentSchemas.map((entry) => entry.label);
    const missingIn = branchSchemas.filter((entry) => !entry.present).map((entry) => entry.shortLabel);
    const requiredIn = branchSchemas.filter((entry) => entry.required).map((entry) => entry.label);
    const optionalIn = branchSchemas.filter((entry) => entry.present && !entry.required).map((entry) => entry.label);

    if (presentSchemas.length === branches.length && schemaMatchesWherePresent) {
      sharedPaths.push({
        path,
        summary: presentSchemas[0].schemaSummary,
        schema: presentSchemas[0].schema,
        deFactoSchema: null,
        deFactoMembers: [],
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
        isDeFactoDefault: Boolean(
          category === "sharedWithSubset"
          && variant
          && deFactoVariant
          && variant.fingerprint === deFactoVariant.fingerprint
        ),
        deFactoSchema: deFactoVariant ? deFactoVariant.schema : null,
        deFactoMembers: deFactoVariant ? deFactoVariant.members : [],
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
    ).sort(sortSharedWithSubsetEntries);
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

function sortSharedWithSubsetEntries(left, right) {
  if (Boolean(left.isDeFactoDefault) !== Boolean(right.isDeFactoDefault)) {
    return left.isDeFactoDefault ? -1 : 1;
  }

  return sortPathEntries(left, right);
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
    return normalizeObjectContainerSchema(schema);
  }

  const normalizedSchema = normalizeObjectContainerSchema(schema);

  if (path !== discriminator.propertyName) {
    return normalizedSchema;
  }

  const normalized = { ...normalizedSchema };

  if (Object.prototype.hasOwnProperty.call(normalized, "const")) {
    normalized.const = "__discriminator__";
  }

  if (Array.isArray(normalized.enum)) {
    normalized.enum = ["__discriminator__"];
  }

  return normalized;
}

function normalizeObjectContainerSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }

  if (!(schema.type === "object" || schema.properties)) {
    return schema;
  }

  return {
    type: schema.type || "object",
    additionalProperties: Object.prototype.hasOwnProperty.call(schema, "additionalProperties")
      ? schema.additionalProperties
      : undefined,
    required: Array.isArray(schema.required) ? schema.required.slice().sort() : [],
    propertyNames: Object.keys(schema.properties || {}).sort(),
  };
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

function getShortBranchLabel(rawBranch, resolvedBranch, index, discriminator) {
  const refLabel = rawBranch && rawBranch.$ref ? rawBranch.$ref.split("/").pop() : null;
  const titleLabel = resolvedBranch && resolvedBranch.title ? resolvedBranch.title : null;
  const discriminatorLabel = getDiscriminatorLabel(resolvedBranch, discriminator);
  const heuristicLabel = getHeuristicBranchLabel(resolvedBranch);

  return discriminatorLabel || heuristicLabel || refLabel || titleLabel || `Option ${index + 1}`;
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
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-100 text-slate-900 antialiased">
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
        uniqueVariantsOnly: false,
        selectedPath: null,
        selectedPathOwnerLabel: null,
        selectedSchemaView: null,
        selectedBranchLabel: null
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

      function joinClasses(parts) {
        return parts.filter(Boolean).join(" ");
      }

      function chip(text, tone) {
        var styles = {
          neutral: "border border-slate-300 bg-white text-slate-600",
          success: "border border-emerald-300 bg-emerald-50 text-emerald-700",
          danger: "border border-rose-300 bg-rose-50 text-rose-700",
          accent: "border border-sky-300 bg-sky-50 text-sky-700",
          warning: "border border-amber-300 bg-amber-50 text-amber-700"
        };
        return '<span class="inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ' + (styles[tone || "neutral"] || styles.neutral) + '">' + escapeHtml(text) + '</span>';
      }

      function outlineButton(label, active, attrs) {
        return '<button ' + attrs + ' class="border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] transition ' + (active ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900') + '">' + escapeHtml(label) + '</button>';
      }

      function linkButton(label, attrs, extraClasses) {
        return '<button ' + attrs + ' class="cursor-pointer text-left text-sky-700 underline underline-offset-2 hover:text-sky-800 ' + (extraClasses || '') + '">' + escapeHtml(label) + '</button>';
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
        var selectedPath = params.get("path");
        var selectedPathOwnerLabel = params.get("pathOwner");
        var selectedSchemaView = params.get("schemaView");
        var selectedBranchLabel = params.get("branch");
        if (pointer) state.selectedPointer = pointer;
        if (layout === "accordion" || layout === "side-by-side") state.layout = layout;
        if (compact === "1") state.compact = true;
        if (compact === "0") state.compact = false;
        state.uniqueVariantsOnly = variants === "unique";
        state.selectedPath = selectedPath;
        state.selectedPathOwnerLabel = selectedPathOwnerLabel;
        state.selectedSchemaView = selectedSchemaView;
        state.selectedBranchLabel = selectedBranchLabel;
      }

      function writeHashState() {
        var params = new URLSearchParams();
        if (state.selectedPointer) params.set("pointer", state.selectedPointer);
        if (state.layout) params.set("layout", state.layout);
        if (state.compact !== null) params.set("compact", state.compact ? "1" : "0");
        if (state.uniqueVariantsOnly) params.set("variants", "unique");
        if (state.selectedPath) params.set("path", state.selectedPath);
        if (state.selectedPathOwnerLabel) params.set("pathOwner", state.selectedPathOwnerLabel);
        if (state.selectedSchemaView) params.set("schemaView", state.selectedSchemaView);
        if (state.selectedBranchLabel) params.set("branch", state.selectedBranchLabel);
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
          return '<div class="border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">No oneOf usages match this search.</div>';
        }

        return filteredUsages.map(function (usage) {
          var active = selectedUsage && usage.pointer === selectedUsage.pointer;
          var context = usage.context || {};
          var chips = [chip(usage.branchCount + ' branches', 'success')];

          (context.chips || []).forEach(function (item) {
            chips.push(chip(item, 'neutral'));
          });

          if (usage.discriminator && usage.discriminator.propertyName) {
            chips.push(chip('discriminator: ' + usage.discriminator.propertyName, 'accent'));
          }

          return ''
            + '<button class="w-full border px-3 py-2 text-left transition ' + (active ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50') + '" data-pointer="' + escapeHtml(usage.pointer) + '">'
            + '  <div class="text-sm font-semibold leading-5 text-slate-900">' + escapeHtml(context.primaryLabel || usage.path) + '</div>'
            +      (context.secondaryLabel ? '<div class="usage-context mt-1 text-[11px] text-slate-500">' + escapeHtml(context.secondaryLabel) + '</div>' : '')
            + '  <div class="mt-1 break-words font-mono text-[11px] leading-4 text-slate-500">' + escapeHtml(usage.path) + '</div>'
            + '  <div class="mt-2 flex flex-wrap gap-1">' + chips.join('') + '</div>'
            + '</button>';
        }).join('');
      }

      function renderPathEntry(pathEntry, mode, ownerLabel) {
        var badges = [];
        if (pathEntry.isDeFactoDefault) {
          badges.push(chip('Defacto default', 'warning'));
        }
        if (pathEntry.required) {
          badges.push(chip('Required', 'accent'));
        } else if (pathEntry.required === false) {
          badges.push(chip('Optional', 'neutral'));
        }
        if (mode !== 'branch-only' && pathEntry.missingIn && pathEntry.missingIn.length) {
          badges.push(chip('Missing in ' + pathEntry.missingIn.join(', '), 'danger'));
        }

        var isSelected = state.selectedPath === pathEntry.path;
        var cardClass = joinClasses([
          'border',
          'px-3',
          'py-2',
          isSelected ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-white'
        ]);
        var schemaLabel = escapeHtml(mode === 'shared' ? 'Shared path schema' : 'Path schema');
        var schemaBlock = '<details class="mt-3 border-t border-slate-300 pt-3">'
          + '  <summary class="cursor-pointer text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">' + schemaLabel + '</summary>'
          + '  <pre class="mt-2 overflow-auto border border-slate-300 bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">' + formatJson(pathEntry.schema || { summary: pathEntry.summary }) + '</pre>'
          + '</details>';
        var pathAttrs = 'data-path="' + escapeHtml(pathEntry.path) + '"'
          + (ownerLabel ? ' data-path-branch="' + escapeHtml(ownerLabel) + '"' : '');

        if (pathEntry.isDeFactoDefault && mode === 'branch') {
          return ''
            + '<details class="' + cardClass + '">'
            + '  <summary class="cursor-pointer list-none">'
            + '    <div class="flex items-start justify-between gap-3">'
            + '      <div class="min-w-0">'
            + '        <div class="font-mono text-[12px] font-semibold leading-5 text-slate-900">' + linkButton(pathEntry.path, pathAttrs, 'w-full') + '</div>'
            + '        <div class="mt-1 text-[12px] leading-5 text-slate-500">' + escapeHtml(summaryText(pathEntry.summary)) + '</div>'
            + '      </div>'
            + '      <div class="shrink-0 text-[10px] uppercase tracking-[0.14em] text-slate-400">collapsed</div>'
            + '    </div>'
            + '    <div class="mt-2 flex flex-wrap gap-1">' + badges.join('') + '</div>'
            + '  </summary>'
            +      schemaBlock
            + '</details>';
        }

        return ''
          + '<div class="' + cardClass + '">'
          + '  <div class="font-mono text-[12px] font-semibold leading-5 text-slate-900">' + linkButton(pathEntry.path, pathAttrs, 'w-full') + '</div>'
          + '  <div class="mt-2 flex flex-wrap gap-1">' + badges.join('') + '</div>'
          + '  <div class="mt-1 text-[12px] leading-5 text-slate-500">' + escapeHtml(summaryText(pathEntry.summary)) + '</div>'
          +      schemaBlock
          + '</div>';
      }

      function renderPathList(entries, mode, emptyText, ownerLabel) {
        if (!entries.length) {
          return '<div class="empty-inline border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">' + escapeHtml(emptyText) + '</div>';
        }

        return '<div class="grid gap-2">' + entries.map(function (entry) {
          return renderPathEntry(entry, mode, ownerLabel);
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

      function renderBranchBucket(title, entries, emptyText, mode, ownerLabel) {
        if (!entries.length) {
          return '';
        }

        return ''
          + '<section class="border border-slate-300 bg-slate-50">'
          + '  <div class="border-b border-slate-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">' + escapeHtml(title) + '</div>'
          + '  <div class="grid gap-2 p-3">' + renderPathList(entries, mode || 'branch', emptyText, ownerLabel) + '</div>'
          + '</section>';
      }

      function renderBranchSpecificSections(branchViews) {
        return branchViews.map(function (branchView) {
          var onlyHere = getDisplayedEntries(branchView.onlyHere);
          var uniqueSchema = getDisplayedEntries(branchView.uniqueSchema);
          var sharedWithSubset = getDisplayedEntries(branchView.sharedWithSubset);
          var deFactoDefaults = sharedWithSubset.filter(function (entry) {
            return entry.isDeFactoDefault;
          }).length;
          var emptyMessages = [];

          if (!onlyHere.length) {
            emptyMessages.push('No ' + branchView.shortLabel + ' only properties');
          }

          if (!uniqueSchema.length) {
            emptyMessages.push('No properties with a different schema');
          }

          return ''
            + '<details class="border border-slate-300 bg-white p-4"' + ((state.selectedPathOwnerLabel === branchView.label || state.selectedBranchLabel === branchView.label) ? ' open' : '') + '>'
            + '  <summary class="cursor-pointer list-none">'
            + '    <div class="flex flex-wrap items-start justify-between gap-2">'
            + '      <div class="text-base font-semibold text-slate-900">' + escapeHtml(branchView.label) + '</div>'
            + '      <div class="flex flex-wrap gap-1">' + chip(branchView.totalPathCount + ' paths', 'danger') + (deFactoDefaults ? chip(deFactoDefaults + ' Defacto default', 'warning') : '') + '</div>'
            + '    </div>'
            + '  </summary>'
            + '  <div class="mt-4 grid gap-3">'
            +      (emptyMessages.length ? '<ul class="ml-5 list-disc text-sm text-slate-500">' + emptyMessages.map(function (message) {
                     return '<li>' + escapeHtml(message) + '</li>';
                   }).join('') + '</ul>' : '')
            +        renderBranchBucket('Only in ' + branchView.shortLabel, onlyHere, 'No ' + branchView.shortLabel + ' only properties', 'branch-only', branchView.label)
            +        renderBranchBucket('Different schema only in ' + branchView.shortLabel, uniqueSchema, 'No properties with a different schema', 'branch-different', branchView.label)
            +        renderBranchBucket('Shared with subset', sharedWithSubset, 'No subset-shared paths for this branch.', 'branch-subset', branchView.label)
            + '  </div>'
            + '</details>';
        }).join('');
      }

      function getBranchShortLabel(selectedUsage, label) {
        var branch = selectedUsage.branches.find(function (candidate) {
          return candidate.label === label;
        });

        return branch ? (branch.shortLabel || branch.label) : label;
      }

      function getPathEntriesForPath(selectedUsage, path) {
        var entries = [];

        (selectedUsage.fieldComparison.sharedPaths || []).forEach(function (entry) {
          if (entry.path === path) {
            entries.push({
              source: 'shared',
              entry: entry,
            });
          }
        });

        (selectedUsage.fieldComparison.branchViews || []).forEach(function (branchView) {
          ([])
            .concat(branchView.onlyHere || [])
            .concat(branchView.uniqueSchema || [])
            .concat(branchView.sharedWithSubset || [])
            .forEach(function (entry) {
              if (entry.path === path) {
                entries.push({
                  source: branchView.label,
                  entry: entry,
                });
              }
            });
        });

        return entries;
      }

      function findPathImplementations(selectedUsage, path) {
        var implementations = [];

        selectedUsage.branches.forEach(function (branch) {
          var branchView = selectedUsage.fieldComparison.branchViews.find(function (view) {
            return view.label === branch.label;
          });
          var bucketEntries = [];

          if (branchView) {
            bucketEntries = bucketEntries
              .concat(branchView.onlyHere || [])
              .concat(branchView.uniqueSchema || [])
              .concat(branchView.sharedWithSubset || []);
          }

          var sharedEntry = (selectedUsage.fieldComparison.sharedPaths || []).find(function (entry) {
            return entry.path === path;
          });
          var branchEntry = bucketEntries.find(function (entry) {
            return entry.path === path;
          });
          var implementation = branchEntry || sharedEntry || null;

          implementations.push({
            label: branch.label,
            ref: branch.ref,
            summary: implementation ? implementation.summary : null,
            schema: implementation ? implementation.schema : null,
            present: Boolean(implementation),
            required: implementation ? implementation.required : false,
            peers: implementation
              ? implementation.peers || (sharedEntry ? selectedUsage.branches
                .filter(function (candidate) { return candidate.label !== branch.label; })
                .map(function (candidate) { return candidate.shortLabel || candidate.label; }) : [])
              : [],
          });
        });

        return implementations;
      }

      function getSelectedPath(selectedUsage) {
        if (!selectedUsage || !state.selectedPath) {
          return null;
        }

        if (state.selectedPathOwnerLabel) {
          var branchView = (selectedUsage.fieldComparison.branchViews || []).find(function (candidate) {
            return candidate.label === state.selectedPathOwnerLabel;
          });

          if (branchView) {
            var branchEntries = []
              .concat(branchView.onlyHere || [])
              .concat(branchView.uniqueSchema || [])
              .concat(branchView.sharedWithSubset || []);
            var ownedEntry = branchEntries.find(function (entry) {
              return entry.path === state.selectedPath;
            });

            if (ownedEntry) {
              return ownedEntry;
            }
          }
        }

        var allEntries = (selectedUsage.fieldComparison.sharedPaths || []).slice();
        (selectedUsage.fieldComparison.branchViews || []).forEach(function (branchView) {
          allEntries = allEntries
            .concat(branchView.onlyHere || [])
            .concat(branchView.uniqueSchema || [])
            .concat(branchView.sharedWithSubset || []);
        });

        return allEntries.find(function (entry) {
          return entry.path === state.selectedPath;
        }) || null;
      }

      function renderSelectedPath(selectedUsage) {
        var selectedPathEntry = getSelectedPath(selectedUsage);
        if (!selectedUsage || !selectedPathEntry) {
          return '';
        }

        var ownerLabel = state.selectedPathOwnerLabel;
        var ownerShortLabel = ownerLabel ? getBranchShortLabel(selectedUsage, ownerLabel) : null;
        var peers = (selectedPathEntry.peers || []).map(function (label) {
          return getBranchShortLabel(selectedUsage, label);
        }).filter(function (label) {
          return label !== ownerShortLabel;
        });
        var presentIn = (selectedPathEntry.presentIn || []).map(function (label) {
          return getBranchShortLabel(selectedUsage, label);
        });
        var branchSchemas = selectedPathEntry.branchSchemas || [];
        var summaryItems = [];
        var sharedWith = [];
        var missingFrom = selectedPathEntry.missingIn || [];
        var differentSchema = [];
        var deFactoMembers = (selectedPathEntry.deFactoMembers || []).map(function (label) {
          return getBranchShortLabel(selectedUsage, label);
        }).filter(function (label) {
          return label !== ownerShortLabel;
        });

        if (branchSchemas.length) {
          sharedWith = branchSchemas.filter(function (entry) {
            return entry.present;
          }).map(function (entry) {
            return entry.shortLabel || getBranchShortLabel(selectedUsage, entry.label);
          });
        } else if (deFactoMembers.length) {
          sharedWith = deFactoMembers;
          differentSchema = presentIn.filter(function (label) {
            return label !== ownerShortLabel && sharedWith.indexOf(label) === -1;
          });
        } else {
          sharedWith = peers;
          differentSchema = presentIn.filter(function (label) {
            return label !== ownerShortLabel && sharedWith.indexOf(label) === -1;
          });
        }

        if (sharedWith.length) {
          summaryItems.push({
            label: 'Shared with',
            values: sharedWith,
          });
        }

        if (missingFrom.length) {
          summaryItems.push({
            label: 'Missing from',
            values: missingFrom,
          });
        }

        if (differentSchema.length) {
          summaryItems.push({
            label: 'Different schema',
            values: differentSchema,
          });
        }

        var hasDefactoSchema = Boolean(
          selectedPathEntry.deFactoSchema
          && JSON.stringify(selectedPathEntry.deFactoSchema) !== JSON.stringify(selectedPathEntry.schema)
        );
        var schemaView = state.selectedSchemaView;
        if (schemaView !== 'path' && schemaView !== 'defacto') {
          schemaView = hasDefactoSchema ? 'defacto' : 'path';
        }
        if (schemaView === 'defacto' && !hasDefactoSchema) {
          schemaView = 'path';
        }

        var displayedSchema = schemaView === 'defacto' && selectedPathEntry.deFactoSchema
          ? selectedPathEntry.deFactoSchema
          : selectedPathEntry.schema;
        var displayedTitle = schemaView === 'defacto' ? 'Defacto schema' : 'Path schema';

        return ''
          + '<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-500/60 p-4" data-path-modal="true">'
          + '  <div class="h-[95vh] w-[95vw] overflow-hidden border border-slate-300 bg-white shadow-2xl">'
          + '    <div class="flex h-full flex-col">'
          + '      <div class="flex items-start justify-between gap-4 border-b border-slate-300 px-5 py-4">'
          + '        <div class="min-w-0">'
          + '          <div class="text-base font-semibold text-slate-900">Path comparison: ' + escapeHtml(selectedPathEntry.path) + '</div>'
          + '        </div>'
          + '        <button class="border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-600 hover:border-slate-400 hover:text-slate-900" data-close-path-modal="true">Close</button>'
          + '      </div>'
          + '      <div class="grid min-h-0 flex-1 gap-4 overflow-auto p-5">'
          + '        <ul class="ml-5 list-disc text-sm leading-6 text-slate-600">'
          +      summaryItems.map(function (item) {
                   return '<li><span class="font-medium text-slate-900">' + escapeHtml(item.label) + ':</span> ' + escapeHtml(item.values.join(', ')) + '</li>';
                 }).join('')
          + '        </ul>'
          + '        <section class="flex min-h-[60vh] min-w-0 flex-1 flex-col border border-slate-300 bg-white">'
          + '          <div class="flex flex-wrap items-center gap-2 border-b border-slate-300 px-4 py-3">'
          +               (hasDefactoSchema
                            ? outlineButton('Defacto schema', schemaView === 'defacto', 'data-schema-view="defacto"')
                            : '')
          +               outlineButton('Path schema', schemaView === 'path', 'data-schema-view="path"')
          + '          </div>'
          + '          <div class="px-4 pt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">' + escapeHtml(displayedTitle) + '</div>'
          + '          <div class="min-h-0 flex-1 p-4 pt-3">'
          + '            <pre class="h-full overflow-auto border border-slate-300 bg-slate-950 p-4 text-[11px] leading-5 text-slate-100">' + formatJson(displayedSchema || { summary: selectedPathEntry.summary }) + '</pre>'
          + '          </div>'
          + '        </section>'
          + '      </div>'
          + '    </div>'
          + '  </div>'
          + '</div>';
      }

      function renderDetail(selectedUsage) {
        if (!selectedUsage) {
          return ''
            + '<div class="min-w-0 border border-slate-300 bg-white">'
            + '  <div class="border-b border-slate-300 px-4 py-4"><h2 class="text-lg font-semibold text-slate-900">No oneOf usage found</h2></div>'
            + '  <div class="grid gap-3 p-4"><div class="border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">This specification does not contain any oneOf nodes.</div></div>'
            + '</div>';
        }

        var context = selectedUsage.context || {};
        var comparisonTitle = selectedUsage.fieldComparison.scope.skippedBranchLabels.length
          ? 'Flattened path comparison covers ' + selectedUsage.fieldComparison.scope.objectBranchCount + ' object-like branches. '
              + selectedUsage.fieldComparison.scope.skippedBranchLabels.length + ' branch' + (selectedUsage.fieldComparison.scope.skippedBranchLabels.length === 1 ? ' is' : 'es are') + ' shown as raw schema summaries.'
          : 'Flattened path comparison covers every branch in this oneOf.';

        var chips = [chip(selectedUsage.branchCount + ' branches', 'success')];
        (context.chips || []).forEach(function (item) { chips.push(chip(item, 'neutral')); });
        if (selectedUsage.discriminator && selectedUsage.discriminator.propertyName) {
          chips.push(chip('discriminator: ' + selectedUsage.discriminator.propertyName, 'accent'));
        }

        return ''
          + '<div class="min-w-0 border border-slate-300 bg-white">'
          + '  <div class="sticky top-0 z-10 border-b border-slate-300 bg-white/95 px-4 py-4 backdrop-blur">'
          + '    <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">oneOf usage</div>'
          + '    <h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">' + escapeHtml(context.primaryLabel || selectedUsage.path) + '</h1>'
          +      (context.secondaryLabel ? '<div class="mt-1 text-sm text-slate-500">' + escapeHtml(context.secondaryLabel) + '</div>' : '')
          + '    <div class="mt-2 text-sm leading-5 text-slate-500">Inspect shared fields, branch-specific fields, and the raw schemas behind this oneOf.</div>'
          + '    <div class="mt-3 flex flex-wrap gap-1">' + chips.join('') + outlineButton('Copy pointer', false, 'data-copy-pointer="' + escapeHtml(selectedUsage.pointer) + '"') + '</div>'
          + '    <div class="mt-2 break-all font-mono text-[11px] leading-5 text-slate-500">' + escapeHtml(selectedUsage.pointer) + '</div>'
          + '  </div>'
          + '  <div class="grid gap-3 p-4">'
          + '    <section class="border border-slate-300 bg-slate-50 p-4">'
          + '      <div class="text-base font-semibold text-slate-900">Comparison scope</div>'
          + '      <p class="mt-2 text-sm leading-5 text-slate-500">' + escapeHtml(comparisonTitle) + '</p>'
          + '      <div class="mt-3 flex flex-wrap gap-1">'
          + '        ' + chip(selectedUsage.fieldComparison.sharedPaths.length + ' shared paths', 'success')
          + '        ' + chip(selectedUsage.fieldComparison.nonSharedPathCount + ' branch-specific paths', 'danger')
          + '        ' + chip(state.uniqueVariantsOnly ? 'unique variants only' : 'all branches', 'neutral')
          + '      </div>'
          + '    </section>'
          + '    <section class="border border-slate-300 bg-white p-4">'
          + '      <div class="mb-3 text-base font-semibold text-slate-900">Shared across all branches</div>'
          +        renderPathList(selectedUsage.fieldComparison.sharedPaths, 'shared', 'No shared flattened paths across every branch.', null)
          + '    </section>'
          +      renderBranchSpecificSections(selectedUsage.fieldComparison.branchViews)
          +      renderSelectedPath(selectedUsage)
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
          + '<div class="grid min-h-screen gap-3 p-3 lg:grid-cols-[320px_minmax(0,1fr)]">'
          + '  <aside class="top-3 flex min-h-0 flex-col overflow-hidden border border-slate-300 bg-white lg:sticky lg:h-[calc(100vh-1.5rem)]">'
          + '    <div class="border-b border-slate-300 px-4 py-4">'
          + '      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">OpenAPI explorer</div>'
          + '      <h2 class="mt-2 text-xl font-semibold tracking-tight text-slate-900">' + escapeHtml(data.specTitle) + '</h2>'
          + '      <div class="mt-1 text-sm leading-5 text-slate-500">Detected ' + data.totalOneOfCount + ' oneOf usage' + (data.totalOneOfCount === 1 ? '' : 's') + ' across the specification.</div>'
          + '      <input class="mt-3 w-full border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none" type="search" placeholder="Search oneOf usage" value="' + escapeHtml(state.query) + '" data-search-input="true" />'
          + '    </div>'
          + '    <div class="grid gap-2 overflow-auto p-3">' + renderUsageList(filteredUsages, selectedUsage) + '</div>'
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

        var pathButton = event.target.closest('[data-path]');
        if (pathButton) {
          state.selectedPath = pathButton.getAttribute('data-path');
          state.selectedPathOwnerLabel = pathButton.getAttribute('data-path-branch');
          state.selectedBranchLabel = pathButton.getAttribute('data-path-branch');
          state.selectedSchemaView = null;
          writeHashState();
          render();
          return;
        }

        var schemaViewButton = event.target.closest('[data-schema-view]');
        if (schemaViewButton) {
          state.selectedSchemaView = schemaViewButton.getAttribute('data-schema-view');
          writeHashState();
          render();
          return;
        }

        var closePathModalButton = event.target.closest('[data-close-path-modal]');
        if (closePathModalButton) {
          state.selectedPath = null;
          state.selectedPathOwnerLabel = null;
          state.selectedSchemaView = null;
          writeHashState();
          render();
          return;
        }

        var pathModalBackdrop = event.target.closest('[data-path-modal]');
        if (pathModalBackdrop && event.target === pathModalBackdrop) {
          state.selectedPath = null;
          state.selectedPathOwnerLabel = null;
          state.selectedSchemaView = null;
          writeHashState();
          render();
        }

        var branchLink = event.target.closest('[data-branch-link]');
        if (branchLink) {
          state.selectedBranchLabel = branchLink.getAttribute('data-branch-link');
          state.layout = 'accordion';
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

      window.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || !state.selectedPath) {
          return;
        }

        state.selectedPath = null;
        state.selectedPathOwnerLabel = null;
        state.selectedSchemaView = null;
        writeHashState();
        render();
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
