const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// --- This server is self-contained and does NOT read any local files. ---
// --- Its only external dependency is the OPENAI_API_KEY environment variable. ---

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Middleware setup
app.use(cors());
app.use(express.json());

// Health check route
app.get('/', (req, res) => {
    res.send('Sakis Athan AI Chatbot Server is running!');
});

// The only active route for the chatbot
app.post('/chat', async (req, res) => {
    console.log('--- NEW REQUEST ---');
    console.log(`[1] Received a request on /chat at ${new Date().toISOString()}`);

    // Check for the API Key first
    if (!OPENAI_API_KEY) {
        console.error('[ERROR] Step 2 Failed: OpenAI API key is NOT configured on the server.');
        return res.status(500).json({ error: 'OpenAI API key is not configured on the server.' });
    }
    console.log('[2] API Key is present.');

    // Check the request body
    const { message } = req.body;
    console.log('[3] Request body received:', req.body);

    if (!message) {
        console.error('[ERROR] Step 3 Failed: Request body is missing the "message" field.');
        return res.status(400).json({ error: 'Request body must contain a "message" field.' });
    }
    console.log('[4] "message" field is present with content:', message);

    const systemInstruction = {
        role: "system",
        content: "You are 'Sakis Bot', a friendly and professional AI assistant for Sakis Athan, an AI & Automation Engineer. Your purpose is to answer questions about his services and encourage potential clients to get in touch. Keep your answers concise and helpful. Services include: Business Process Automation, AI-Powered Solutions, and Custom System Integrations. Contact info: sakissystems@gmail.com. Always guide users to the contact form or direct contact for detailed project discussions."
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
                model: 'gpt-3.5-turbo',
                messages: messages,
            }),
        });
        
        console.log('[6] Received response from OpenAI.');

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[ERROR] Step 6 Failed: OpenAI API returned status ${response.status}`, errorBody);
            // This error is often caused by an invalid API key or billing issues.
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
