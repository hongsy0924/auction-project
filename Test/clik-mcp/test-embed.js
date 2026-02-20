const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

async function main() {
    try {
        const response = await ai.models.embedContent({
            model: 'text-embedding-004',
            contents: "hello world"
        });
        console.log("Success with text-embedding-004!", response.embeddings[0].values.length);
    } catch (e) {
        console.error("Failed text-embedding-004:", e.message);
    }

    try {
        const response = await ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: "hello world"
        });
        console.log("Success with gemini-embedding-001!", response.embeddings[0].values.length);
    } catch (e) {
        console.error("Failed gemini-embedding-001:", e.message);
    }
}
main();
