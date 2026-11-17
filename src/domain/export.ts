/**
 * Compatibility re-exports: the CSV and download code moved to `src/lib` (it is edge code) and
 * `ASSEMBLY_NAMES` to `assemblyNames.ts`. Importers outside Package B still use this path; point
 * them at the new homes and delete this file.
 */
export { ASSEMBLY_NAMES } from "./assemblyNames";
export { bomToCsv, shipmentToCsv } from "@/lib/csv";
export { downloadBytes, downloadText } from "@/lib/download";
