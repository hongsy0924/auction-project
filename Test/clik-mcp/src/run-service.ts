import "dotenv/config";
import { MinutesService } from "./workflow.js";

async function main() {
    const query = process.argv[2];
    if (!query) {
        console.error("Usage: npx tsx src/run-service.ts \"Type your query here\"");
        process.exit(1);
    }

    const clikKey = process.env.CLIK_API_KEY;
    if (!clikKey) {
        console.error("Error: CLIK_API_KEY is missing in .env");
        process.exit(1);
    }

    const service = new MinutesService(clikKey);

    try {
        console.log("--- Start Service ---");
        const result = await service.processQuery(query);
        console.log("\n--- Final Answer ---\n");
        console.log(result);
        console.log("\n--------------------");
    } catch (error) {
        console.error("An error occurred:", error);
    }
}

main();
