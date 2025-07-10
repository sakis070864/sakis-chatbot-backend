const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- NEW: Load the Q&A data into an array for searching ---
let qaData = [];
try {
    const filePath = path.join(__dirname, '400QA2.json');
    const fileContent = fs.readFileSync(filePath, 'utf8');
    qaData = JSON.parse(fileContent);
    console.log(`Successfully loaded ${qaData.length} Q&A items into the knowledge base.`);
} catch (error) {
    console.error('CRITICAL ERROR: Could not load or parse 400QA2.json. The chatbot will not have custom knowledge.', error);
}
// --- END NEW SECTION ---

// Middleware setup
app.use(cors());
app.use(express.json());

// Health check route
app.get('/', (req, res) => {
    res.send('Sakis Athan AI Chatbot Server with RAG is running!');
});

app.post('/chat', async (req, res) => {
    console.log('--- NEW REQUEST ---');
    
    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OpenAI API key is not configured on the server.' });
    }

    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Request body must contain a "message" field.' });
    }
    console.log(`[1] Received user message: "${message}"`);

    // --- NEW: Intelligent Search (Simplified RAG) ---
    // Find the most relevant Q&A pairs from the knowledge base.
    const getRelevantSnippets = (query, data, count = 7) => {
        const queryWords = query.toLowerCase().split(/\s+/);
        const scoredItems = data
            .filter(item => item.Q && item.A) // Ensure item has both Q and A
            .map(item => {
                const questionWords = item.Q.toLowerCase();
                let score = 0;
                queryWords.forEach(word => {
                    if (questionWords.includes(word)) {
                        score++;
                    }
                });
                return { ...item, score };
            })
            .filter(item => item.score > 0) // Only include items with at least one match
            .sort((a, b) => b.score - a.score); // Sort by score descending

        return scoredItems.slice(0, count);
    };

    const relevantSnippets = getRelevantSnippets(message, qaData);
    const knowledgeBase = relevantSnippets.length > 0
        ? relevantSnippets.map(item => `Q: ${item.Q}\nA: ${item.A}`).join('\n\n')
        : 'No specific information found in the knowledge base for this query.';
    
    console.log(`[2] Found ${relevantSnippets.length} relevant snippets to inject into the prompt.`);
    // --- END NEW SECTION ---

    const systemInstruction = {
        role: "system",
        content: `You are 'Sakis Bot', a friendly and professional AI assistant for Sakis Athan, an AI & Automation Engineer. 
        
        Your primary goal is to answer the user's question based on the provided "Relevant Information" below. You MUST prioritize this information. If the information provides a good answer, use it directly. If the information is not sufficient, you may use your general knowledge but you must relate it back to Sakis's skills and services.

        Keep your answers concise and helpful. Always be professional and encourage potential clients to get in touch for detailed project discussions. Sakis's contact info is sakissystems@gmail.com.

        --- RELEVANT INFORMATION START ---
        ${knowledgeBase}
        --- RELEVANT INFORMATION END ---
        `
    };

    const messages = [
        systemInstruction,
        { role: "user", content: message }
    ];

    try {
        console.log('[3] Sending request to OpenAI API...');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo-0125', // This model is fine now that the context is small
                messages: messages,
            }),
        });
        
        console.log('[4] Received response from OpenAI.');

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[ERROR] OpenAI API returned status ${response.status}`, errorBody);
            throw new Error(`OpenAI API request failed with status ${response.status}`);
        }

        const data = await response.json();
        const replyContent = data.choices[0]?.message?.content || "Sorry, I couldn't get a proper response. Please try again.";
        
        console.log('[5] Successfully processed reply. Sending response back to the client.');
        res.json({ reply: replyContent });

    } catch (error) {
        console.error('[FATAL ERROR] An error occurred in the try-catch block:', error.message);
        res.status(500).json({ error: 'Failed to fetch response from AI.' });
    }
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
