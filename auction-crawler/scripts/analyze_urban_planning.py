
import json
import logging
import os
import re
import sys
from pathlib import Path

# Add parent directory to path to import config
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import AI_CONFIG

logger = logging.getLogger(__name__)

class UrbanPlanningAnalyzer:
    def __init__(self):
        self.data_dir = Path(__file__).parent.parent / "data" / "council" / "raw"
        self.gemini_client = None
        self.model_name = AI_CONFIG.get('model', 'gemini-2.0-flash-exp')
        self.embed_model = "text-embedding-004"

        # If config still has a GPT default, switch to Gemini
        if 'gpt' in self.model_name.lower():
             self.model_name = 'gemini-2.0-flash-exp'

        api_key = AI_CONFIG.get('api_key')
        if api_key:
            try:
                from google import genai
                self.gemini_client = genai.Client(api_key=api_key)
                logger.info(f"Initialized Gemini RAG with model: {self.model_name}")
            except ImportError:
                print("google-genai package not found. pip install google-genai")
            except Exception as e:
                print(f"Failed to initialize Gemini: {e}")
        else:
            print("Warning: AI_API_KEY not found in config. AI features will skip.")

        self._all_chunks = [] # List of {text, doc_info}
        self._chunk_embeddings = None

    def _split_into_chunks(self, text: str, doc_info: dict, chunk_size: int = 2000) -> list[dict]:
        """
        Split a long text into overlapping chunks, prefixing each with document context.
        """
        # Clean HTML
        clean_text = re.sub('<[^<]+?>', ' ', text)
        clean_text = ' '.join(clean_text.split())

        # Context prefix
        prefix = f"[문서: {doc_info['title']}, 날짜: {doc_info['date']}] "

        chunks = []
        if len(clean_text) <= chunk_size:
            chunks.append({"text": prefix + clean_text, "info": doc_info})
        else:
            # Simple overlap chunking
            overlap = 300
            start = 0
            while start < len(clean_text):
                end = start + chunk_size
                chunk_content = clean_text[start:end]
                chunks.append({
                    "text": prefix + chunk_content,
                    "info": doc_info
                })
                start += (chunk_size - overlap)
        return chunks

    def _prepare_knowledge_base(self):
        """
        Load all documents and split them into chunks.
        """
        if self._all_chunks:
            return

        import glob
        files = glob.glob(str(self.data_dir / "*.json"))

        all_doc_chunks = []
        for file_path in files:
            try:
                with open(file_path, encoding='utf-8') as f:
                    data = json.load(f)

                for minute in data:
                    content = minute.get('MINTS_CN', '') + " " + minute.get('MINTS_HTML', '') + " " + minute.get('MTR_SJ', '')
                    doc_info = {
                        "doc_id": minute.get('DOCID'),
                        "date": minute.get('MTG_DE'),
                        "title": minute.get('MTR_SJ')
                    }
                    all_doc_chunks.extend(self._split_into_chunks(content, doc_info))
            except Exception as e:
                print(f"Error loading {file_path}: {e}")

        self._all_chunks = all_doc_chunks
        print(f"Prepared {len(self._all_chunks)} chunks from local documents.")

    def search_semantic(self, query: str, top_k: int = 5) -> list[dict]:
        """
        Search for relevant chunks using Gemini Embeddings.
        """
        self._prepare_knowledge_base()
        if not self._all_chunks or not self.gemini_client:
            return []

        import numpy as np
        from sklearn.metrics.pairwise import cosine_similarity

        try:
            # 1. Get Query Embedding
            query_resp = self.gemini_client.models.embed_content(
                model=self.embed_model,
                contents=query
            )
            query_vec = np.array(query_resp.embeddings[0].values).reshape(1, -1)

            # 2. Get/Compute Chunk Embeddings (Simple lazy calculation for demo, usually we cache this)
            if self._chunk_embeddings is None:
                print(f"Generating embeddings for {len(self._all_chunks)} chunks... (this may take a moment)")

                # Batch process to be efficient
                batch_size = 50
                all_vecs = []
                for i in range(0, len(self._all_chunks), batch_size):
                    batch = [c['text'] for c in self._all_chunks[i:i+batch_size]]
                    resp = self.gemini_client.models.embed_content(
                        model=self.embed_model,
                        contents=batch
                    )
                    all_vecs.extend([e.values for e in resp.embeddings])

                self._chunk_embeddings = np.array(all_vecs)

            # 3. Calculate Similarity
            similarities = cosine_similarity(query_vec, self._chunk_embeddings)[0]
            top_indices = similarities.argsort()[-top_k:][::-1]

            results = []
            for idx in top_indices:
                if similarities[idx] > 0.3: # Minimum similarity threshold
                    results.append({
                        "text": self._all_chunks[idx]['text'],
                        "score": float(similarities[idx]),
                        "info": self._all_chunks[idx]['info']
                    })
            return results

        except Exception as e:
            print(f"Semantic search failed: {e}")
            return []

    def analyze_compensation_risk(self, query: str, question: str = None) -> dict:
        """
        Perform RAG-based analysis.
        """
        print(f"Performing semantic search for: {query}...")
        relevant_chunks = self.search_semantic(query, top_k=10)

        if not relevant_chunks:
            return {
                "query": query,
                "risk_level": "Unknown",
                "analysis": "No relevant context found in local documents."
            }

        # Construct Context from chunks
        context_text = ""
        for i, chunk in enumerate(relevant_chunks):
            info = chunk['info']
            context_text += f"--- Context {i+1} (Date: {info['date']}, Title: {info['title']}) ---\n"
            context_text += f"{chunk['text']}\n\n"

        if question:
            prompt = f"""
You are a helpful assistant specialized in analyzing Korean council minutes.
Use the provided Context chunks to answer the User Question.

Context:
{context_text}

User Question: {question}

Please provide a detailed answer based on the context above. If the exact answer isn't there, summarize what IS there related to the query.
"""
        else:
            prompt = f"""
You are an expert real estate investment analyst specializing in Korean urban planning and land compensation (토지보상).
Review the following excerpts from local council meeting minutes.

Determine if there is any indication of:
1. Imminent urban planning execution (도시계획시설 집행).
2. budget allocation for compensation (보상 예산 편성).
3. Complaints or discussions about delayed compensation (장기미집행 보상 논의).

Output your analysis in JSON format with these keys:
- "probability_score": 0 to 100 (integer), where 0 is no chance and 100 is certain/ongoing compensation.
- "risk_level": "Low", "Medium", "High", or "Imminent".
- "key_evidence": A brief summary that specifically cites dates and project names from the context.
- "reasoning": Detailed explanation of your conclusion.

Context:
{context_text}
"""
        # Call Gemini API
        try:
            if not self.gemini_client:
                 return {"error": "Gemini Client not initialized"}

            response = self.gemini_client.models.generate_content(
                model=self.model_name,
                contents=prompt
            )
            result_text = response.text

            if question:
                return {
                    "query": query,
                    "question": question,
                    "analysis": result_text
                }

            # JSON Parsing for standard analysis
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0]
            elif "```" in result_text:
                 result_text = result_text.split("```")[1].split("```")[0]

            try:
                return json.loads(result_text)
            except Exception:
                  return {
                    "query": query,
                    "risk_level": "Error",
                    "analysis": f"Failed to parse JSON response: {result_text}"
                }

        except Exception as e:
            return {
                "query": query,
                "risk_level": "Error",
                "analysis": f"AI Analysis failed: {str(e)}"
            }

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Analyze Urban Planning Risks with RAG')
    parser.add_argument('--query', type=str, required=True, help='Core topic or address (e.g. "옥포")')
    parser.add_argument('--question', type=str, help='Specific question to ask AI')
    args = parser.parse_args()

    analyzer = UrbanPlanningAnalyzer()

    print("Initializing AI Analysis...")
    result = analyzer.analyze_compensation_risk(args.query, args.question)
    print("\n" + "="*50)
    print("ANALYSIS RESULT")
    print("="*50)
    print(json.dumps(result, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
