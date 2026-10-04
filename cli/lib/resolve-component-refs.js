const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const traverse = require("traverse");

function loadDocument(filePath, cache) {
    const resolvedPath = path.resolve(filePath);

    if (!cache.has(resolvedPath)) {
        cache.set(
            resolvedPath,
            yaml.load(fs.readFileSync(resolvedPath, "utf8")),
        );
    }

    return cache.get(resolvedPath);
}

function isMissingFileError(error) {
    return Boolean(
        error && (error.code === "ENOENT" || error.code === "ENOTDIR"),
    );
}

function unescapePointerSegment(segment) {
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveJsonPointer(document, pointer) {
    if (!pointer || pointer === "/") {
        return document;
    }

    const segments = pointer
        .replace(/^\//, "")
        .split("/")
        .map(unescapePointerSegment);

    let current = document;
    for (const segment of segments) {
        if (current == null) {
            return undefined;
        }
        current = current[segment];
    }

    return current;
}

function collectRefs(document) {
    const refs = new Set();

    traverse(document).forEach(function () {
        if (this.key === "$ref" && typeof this.node === "string") {
            refs.add(this.node);
        }
    });

    return refs;
}

function isRefOnly(definition) {
    return Boolean(
        definition &&
        typeof definition === "object" &&
        typeof definition.$ref === "string" &&
        Object.keys(definition).length === 1,
    );
}

function resolveRefChain(fromFile, ref, cache) {
    const seen = new Set();
    let currentFile = fromFile;
    let currentRef = ref;

    while (true) {
        const [filePart, pointer = ""] = currentRef.split("#");
        const targetPath = filePart
            ? path.resolve(path.dirname(currentFile), filePart)
            : currentFile;
        const key = `${targetPath}#${pointer}`;
        if (seen.has(key)) {
            return undefined;
        }
        seen.add(key);

        let definition;
        try {
            definition = resolveJsonPointer(
                loadDocument(targetPath, cache),
                pointer,
            );
        } catch (e) {
            // Remote (http/https) refs also land here as ENOENT and are skipped;
            // only local files are resolved.
            if (isMissingFileError(e)) {
                return undefined;
            }
            throw e;
        }

        if (definition === undefined) {
            return undefined;
        }
        if (!isRefOnly(definition)) {
            return { definition, filePath: targetPath };
        }

        currentFile = targetPath;
        currentRef = definition.$ref;
    }
}

// Resolves external `$ref`s, returning { type, name, definition, source } entries.
// Bundlers inline these and rename on collision; this detects those collisions.
// Internal refs in input are ignored; those in loaded definitions are followed.
function collectResolvedComponents(filePath, document, cache) {
    cache = cache || new Map();

    const rootPath = path.resolve(filePath);
    if (!cache.has(rootPath)) {
        cache.set(rootPath, document);
    }

    const resolved = [];
    const visited = new Set();

    const walk = (doc, currentFile) => {
        for (const ref of collectRefs(doc)) {
            if (ref.startsWith("#") && currentFile === rootPath) {
                continue;
            }

            const [filePart, pointer = ""] = ref.split("#");
            const match = pointer.match(/^\/components\/([^/]+)\/([^/]+)$/);
            if (!match) {
                continue;
            }

            const targetPath = filePart
                ? path.resolve(path.dirname(currentFile), filePart)
                : currentFile;
            const key = `${targetPath}#${pointer}`;
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);

            const target = resolveRefChain(currentFile, ref, cache);
            if (!target) {
                continue;
            }

            resolved.push({
                type: unescapePointerSegment(match[1]),
                name: unescapePointerSegment(match[2]),
                definition: target.definition,
                source: ref,
            });

            // Bundlers resolve transitively, so keep walking the definition we just
            // pulled in for refs of its own, relative to the file it lives in.
            walk(target.definition, target.filePath);
        }
    };

    walk(document, rootPath);

    return resolved;
}

// Replaces `$ref`-only components with their definitions to prevent
// re-exported components from being reported as self-duplicates.
function inlineComponentRefs(filePath, document, cache) {
    cache = cache || new Map();

    if (!document || !document.components) {
        return document;
    }

    const rootPath = path.resolve(filePath);
    if (!cache.has(rootPath)) {
        cache.set(rootPath, document);
    }

    const components = {};

    for (const [type, entries] of Object.entries(document.components)) {
        if (!entries || typeof entries !== "object") {
            components[type] = entries;
            continue;
        }

        components[type] = {};
        for (const [name, definition] of Object.entries(entries)) {
            const target = isRefOnly(definition)
                ? resolveRefChain(rootPath, definition.$ref, cache)
                : undefined;
            components[type][name] = target ? target.definition : definition;
        }
    }

    return { ...document, components };
}

module.exports = {
    collectResolvedComponents,
    inlineComponentRefs,
    resolveJsonPointer,
};
