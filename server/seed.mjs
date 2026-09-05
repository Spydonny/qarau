import { QarauService } from "./qarau-service.mjs";

const qarau = new QarauService();
await qarau.init();
const result = await qarau.discover({ provider: "PUBLIC_CATALOG" });
process.stdout.write(`QARAU public catalog ready: ${result.discovered} new, ${qarau.list({ pageSize: "100" }).pagination.total} total active sources.\n`);
