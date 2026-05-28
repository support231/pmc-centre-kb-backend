import "dotenv/config";
import { initKB, searchKB } from "./kb.js";

console.log("[TEST] Starting RAG test...\n");

await initKB();

console.log("\n=== TEST 1: Press Felt ===");
const ctx1 = await searchKB("What is the difference between batt-on-base and laminated press felt?");
console.log(ctx1 ? ctx1.slice(0, 500) : "(empty - no relevant context)");

console.log("\n=== TEST 2: Forming Fabric ===");
const ctx2 = await searchKB("What types of forming fabrics are used in paper machines?");
console.log(ctx2 ? ctx2.slice(0, 500) : "(empty - no relevant context)");

console.log("\n=== TEST 3: Dryer Fabric ===");
const ctx3 = await searchKB("How to select the right dryer fabric?");
console.log(ctx3 ? ctx3.slice(0, 500) : "(empty - no relevant context)");

console.log("\n[TEST] Done!");
process.exit(0);
