const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- Load the Q&A Knowledge Base from the JSON file ---
let knowledgeBase = '';
try {
    const filePath = path.join(__dirname, '400QA2.json');
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const jsonData = JSON.parse(fileContent);
    knowledgeBase = JSON.stringify(jsonData);
    console.log('Successfully loaded and parsed the Q&A knowledge base.');
} catch (error) {
    console.error('Error loading or parsing 400QA2.json:', error);
    knowledgeBase = 'No knowledge base file found.';
}

// Middleware setup
app.use(cors());
app.use(express.json());

// Health check route
app.get('/', (req, res) => {
    res.send('Sakis Athan AI Chatbot Server with Knowledge Base is running!');
});

app.post('/chat', async (req, res) => {
    console.log('--- NEW REQUEST ---');
    console.log(`[1] Received a request on /chat at ${new Date().toISOString()}`);

    if (!OPENAI_API_KEY) {
        console.error('[ERROR] Step 2 Failed: OpenAI API key is NOT configured on the server.');
        return res.status(500).json({ error: 'OpenAI API key is not configured on the server.' });
    }
    console.log('[2] API Key is present.');

    const { message } = req.body;
    console.log('[3] Request body received:', req.body);

    if (!message) {
        console.error('[ERROR] Step 3 Failed: Request body is missing the "message" field.');
        return res.status(400).json({ error: 'Request body must contain a "message" field.' });
    }
    console.log('[4] "message" field is present with content:', message);

    const systemInstruction = {
        role: "system",
        content: `You are 'Sakis Bot', a friendly and professional AI assistant for Sakis Athan, an AI & Automation Engineer. 
        
        Your primary goal is to answer questions based on the provided "Knowledge Base". You MUST prioritize the information in the Knowledge Base above all else. If the answer is in the Knowledge Base, use it directly. If the question is not covered in the Knowledge Base, you may use your general knowledge but always relate it back to Sakis's skills and services.

        Keep your answers concise and helpful. Always be professional and encourage potential clients to get in touch for detailed project discussions. Sakis's contact info is sakissystems@gmail.com.

        --- KNOWLEDGE BASE START ---
        ${knowledgeBase}
        --- KNOWLEDGE BASE END ---
        `
    };

    const messages = [
        systemInstruction,
        { role: "user", content: message }
    ];

    try {
        console.log('[5] Sending request to OpenAI API...');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                // *** FIX: Specified a model with a larger 16k context window ***
                model: 'gpt-3.5-turbo-0125',
                messages: messages,
            }),
        });
        
        console.log('[6] Received response from OpenAI.');

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[ERROR] Step 6 Failed: OpenAI API returned status ${response.status}`, errorBody);
            throw new Error(`OpenAI API request failed with status ${response.status}`);
        }

        const data = await response.json();
        const replyContent = data.choices[0]?.message?.content || "Sorry, I couldn't get a proper response. Please try again.";
        
        console.log('[7] Successfully processed reply. Sending response back to the client.');
        res.json({ reply: replyContent });

    } catch (error) {
        console.error('[FATAL ERROR] An error occurred in the try-catch block:', error.message);
        res.status(500).json({ error: 'Failed to fetch response from AI.' });
    }
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
