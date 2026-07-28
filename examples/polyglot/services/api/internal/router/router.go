// START_MODULE_CONTRACT
//   PURPOSE: Route gateway requests to ledger services.
//   SCOPE: Dispatch inbound HTTP traffic to the posting contract.
//   DEPENDS: none
//   LINKS: M-API-ROUTER
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   Route - Dispatch a gateway request.
// END_MODULE_MAP

package router

import "log/slog"

// Route dispatches an inbound path to the ledger posting flow.
func Route(path string) error {
	// START_BLOCK_DISPATCH
	slog.Info("[ApiRouter][Route][BLOCK_DISPATCH] dispatch", "path", path)
	// END_BLOCK_DISPATCH
	return nil
}
