const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
// Render provides the PORT environment variable
const port = process.env.PORT || 3000;

// The API key will be set as an environment variable on the Render dashboard
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(express.json());
app.use(cors());

// A simple health check endpoint to make sure the server is running
app.get('/', (req, res) => {
    res.send('Sakis Athan AI Chatbot Server is running!');
});

// *** FIX #1: Changed route from '/api/chat' to '/chat' to match the frontend ***
app.post('/chat', async (req, res) => {
    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OpenAI API key is not configured on the server.' });
    }

    // *** FIX #2: Changed to expect a single "message" to match the frontend ***
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Request body must contain a "message" field.' });
    }

    const systemInstruction = {
        role: "system",
        content: "You are 'Sakis Bot', a friendly and professional AI assistant for Sakis Athan, an AI & Automation Engineer. Your purpose is to answer questions about his services and encourage potential clients to get in touch. Keep your answers concise and helpful. Services include: Business Process Automation, AI-Powered Solutions, and Custom System Integrations. Contact info: sakissystems@gmail.com. Always guide users to the contact form or direct contact for detailed project discussions."
    };

    // The frontend does not send history, so we build a simple message array
    const messages = [
        systemInstruction,
        { role: "user", content: message }
    ];

    try {
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

        if (!response.ok) {
            // Log the error response from OpenAI for better debugging
            const errorBody = await response.text();
            console.error('OpenAI API Error:', response.status, errorBody);
            throw new Error(`OpenAI API request failed with status ${response.status}`);
        }

        const data = await response.json();
        
        // *** FIX #3: Extract only the message content and send it back in the format the frontend expects ***
        const replyContent = data.choices[0]?.message?.content || "Sorry, I couldn't get a proper response. Please try again.";
        
        res.json({ reply: replyContent });

    } catch (error) {
        console.error('Error calling OpenAI API:', error.message);
        res.status(500).json({ error: 'Failed to fetch response from AI.' });
    }
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
