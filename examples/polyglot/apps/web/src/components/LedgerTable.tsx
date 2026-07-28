// START_MODULE_CONTRACT
//   PURPOSE: Render ledger rows in the web UI.
//   SCOPE: Presentational ledger table with keyboard navigation.
//   DEPENDS: none
//   LINKS: M-WEB-LEDGER-TABLE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   LedgerTable - Render the ledger table.
//   LedgerRow - Row shape for the ledger table.
// END_MODULE_MAP

export type LedgerRow = { id: string; amount: number };

export function LedgerTable(props: { rows: LedgerRow[] }) {
  // START_BLOCK_RENDER
  if (props.rows.length === 0) {
    return <div role="status">No ledger entries</div>;
  }
  return (
    <table>
      <tbody>
        {props.rows.map((row) => (
          <tr key={row.id} tabIndex={0}>
            <td>{row.id}</td>
            <td>{row.amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  // END_BLOCK_RENDER
}
