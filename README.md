## oas-toolkit

`oas-toolkit` is a library and CLI for working with OpenAPI documents.

> The CLI only supports YAML OpenAPI specifications currently

The project provides the following functionality:

- Merge multiple OAS documents into a single file
- Add/patch values in place
- Remove arbritary keys from the specification
- Remove unused components

## Merge

Usage:

```bash
oas-toolkit merge <one> <two> <three> > openapi.yml
```

Combining multiple OpenAPI specs has unspecified behaviour. This tool merges using the following algorithm:

Take the latest specified value for the following blocks:

- openapi
- info
- servers
- externalDocs

Merge the following lists/objects recursively. If you encounter a list, concatenate them together:

- security
- tags
- components
- paths
