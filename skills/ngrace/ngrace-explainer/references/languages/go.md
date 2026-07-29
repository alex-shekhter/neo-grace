# GRACE semantic markup for Go

## Markup placement and godoc

Put GRACE markers **above** the package clause, or above a godoc block — never between a godoc comment and the declaration it documents. Inserting markers between godoc and its target breaks `go doc`.

```go
// START_MODULE_CONTRACT
// PURPOSE: Route gateway requests.
// SCOPE: Dispatch inbound traffic.
// DEPENDS: none
// LINKS: M-GATEWAY-ROUTER
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// Route - Dispatch a gateway request.
// END_MODULE_MAP

// Package router dispatches gateway requests.
package router

// Route dispatches a gateway request.
func Route(path string) error {
	// START_BLOCK_DISPATCH
	slog.Info("[GatewayRouter][Route][BLOCK_DISPATCH] dispatch")
	// END_BLOCK_DISPATCH
	return nil
}
```

## Package convention (per-file parity)

A Go **package** spans many files. GRACE export parity is computed **per file**, not per package.

- Put the package-wide surface summary in `doc.go` with `MAP_MODE: SUMMARY`.
- Use `ROLE: RUNTIME` + `MAP_MODE: EXPORTS` only on files whose own exported identifiers are the module surface you want checked.
- Every file in the package should declare the same `LINKS: M-*`.

## Methods are not package exports

Go's export unit is the package-level identifier. Methods (`func (s *Server) Serve()`) are attached to a receiver type and are **not** listed in an `EXPORTS` `MODULE_MAP`. They appear as locals under `MAP_MODE: LOCALS` for implementer navigation only.

## Build tags and cgo

Files with `//go:build` / `// +build` constraints or `import "C"` report `exportConfidence: heuristic` by design: the declaration set can change under another build configuration. Prefer `MustPassCommand` evidence (`go test`, `go vet`) as the structural truth for those files.

## Interface satisfaction

Interface satisfaction is implicit in Go. Document intended implementations in `MODULE_CONTRACT` prose and pin them with:

```go
var _ io.Reader = (*MyReader)(nil)
```

## Tests and evidence

Table-driven tests are good `TraceAssertion` material. Prefer stable log markers from production paths (`slog`, `zap`, `zerolog`) over test-only emission when verifying runtime trajectory.
